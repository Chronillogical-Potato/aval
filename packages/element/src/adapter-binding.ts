import { defineAvalElement } from "./definition.js";
import { AvalNotReadyError } from "./errors.js";
import type {
  AvalDiagnostics,
  AvalElement,
  AvalErrorDetail,
  AvalPrepareOptions,
  AvalRequestedStateChangeDetail,
  AvalSnapshot,
  AvalTransitionDetail,
  AvalVisualStateChangeDetail,
  RuntimeReadiness,
  RuntimeReadinessResult
} from "./public-types.js";
import {
  sameAvalRenderOptions,
  type AvalAdapterCallbacks,
  type AvalAdapterConfiguration,
  type AvalAdapterRenderOptions
} from "./adapter-options.js";

export interface AvalAdapterStatus {
  readonly mounted: boolean;
  readonly readiness: RuntimeReadiness;
  readonly requestedState: string | null;
  readonly visualState: string | null;
  readonly isTransitioning: boolean;
  readonly paused: boolean;
  readonly effectivelyVisible: boolean;
  readonly stateNames: readonly string[];
  readonly eventNames: readonly string[];
  readonly lastError: Readonly<AvalErrorDetail> | null;
}

export interface AvalAdapterCommands {
  readonly prepare: (
    options?: Readonly<AvalPrepareOptions>
  ) => Promise<RuntimeReadinessResult>;
  readonly setState: (name: string) => Promise<void>;
  readonly send: (event: string) => boolean;
  readonly readyFor: (state: string) => boolean;
  readonly play: () => Promise<void>;
  readonly pause: () => void;
  readonly getDiagnostics: (
    options?: Readonly<{ readonly trace?: boolean }>
  ) => Readonly<AvalDiagnostics> | null;
}

export type AvalAdapterController =
  Readonly<AvalAdapterStatus> & Readonly<AvalAdapterCommands>;

export interface AvalAdapterBinding {
  readonly commands: Readonly<AvalAdapterCommands>;
  readonly getStatus: () => Readonly<AvalAdapterStatus>;
  readonly getServerStatus: () => Readonly<AvalAdapterStatus>;
  readonly getRenderOptions: () => Readonly<AvalAdapterRenderOptions>;
  readonly subscribeStatus: (listener: () => void) => () => void;
  readonly subscribeOptions: (listener: () => void) => () => void;
  commit(configuration: Readonly<AvalAdapterConfiguration>): void;
  readonly attach: (node: HTMLElement | null) => void;
  finalizeBindingTarget(target: Element | null | undefined): void;
  clearBindingTarget(): void;
  beginReadyPreparation(): () => void;
}

export interface AvalAdapterBindingNode {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

export type AvalAdapterBindingElementPort = Pick<
  AvalElement,
  | "interactionTarget"
  | "prepare"
  | "setState"
  | "send"
  | "readyFor"
  | "pause"
  | "resume"
  | "getSnapshot"
  | "subscribe"
  | "getDiagnostics"
>;

export interface AvalAdapterBindingEnvironment {
  upgrade(node: AvalAdapterBindingNode): AvalAdapterBindingElementPort;
}

interface Attachment {
  readonly node: AvalAdapterBindingNode;
  readonly element: AvalAdapterBindingElementPort;
  readonly unsubscribe: () => void;
  phase: AttachmentPhase;
}

type AttachmentPhase =
  | Readonly<{ readonly kind: "pending" }>
  | Readonly<{
    readonly kind: "mounted";
    readonly target: Element | null;
    readonly snapshot: Readonly<AvalSnapshot>;
  }>;

interface Preparation {
  readonly attachment: Attachment;
  readonly sourceKey: string;
  readonly controller: AbortController;
}

type StoreListener = () => void;

const EMPTY_STRINGS: readonly string[] = Object.freeze([]);
const NOOP = (): void => undefined;

const BROWSER_ENVIRONMENT: AvalAdapterBindingEnvironment = Object.freeze({
  upgrade(node: AvalAdapterBindingNode): AvalAdapterBindingElementPort {
    defineAvalElement();
    const element = node as unknown as AvalAdapterBindingElementPort;
    if (!hasSnapshotApi(element)) {
      customElements.upgrade(node as unknown as Node);
      if (!hasSnapshotApi(element)) {
        throw new TypeError(
          "Registered aval-player does not implement the required snapshot API"
        );
      }
    }
    return element;
  }
});

function hasSnapshotApi(element: AvalAdapterBindingElementPort): boolean {
  return typeof element.getSnapshot === "function" &&
    typeof element.subscribe === "function";
}

export class AvalAdapterBindingImplementation implements AvalAdapterBinding {
  public readonly commands: Readonly<AvalAdapterCommands>;
  readonly #statusListeners = new Set<StoreListener>();
  readonly #optionsListeners = new Set<StoreListener>();
  readonly #serverStatus = unmountedStatus();
  readonly #nativeListeners: readonly (readonly [string, EventListener])[];
  readonly #environment: AvalAdapterBindingEnvironment;
  #status: Readonly<AvalAdapterStatus>;
  #renderOptions: Readonly<AvalAdapterRenderOptions>;
  #callbacks: Readonly<AvalAdapterCallbacks>;
  #attachment: Attachment | null = null;
  #preparation: Preparation | null = null;

  public constructor(
    configuration: Readonly<AvalAdapterConfiguration>,
    environment: AvalAdapterBindingEnvironment = BROWSER_ENVIRONMENT
  ) {
    this.#renderOptions = configuration.render;
    this.#callbacks = configuration.callbacks;
    this.#status = this.#serverStatus;
    this.#environment = environment;
    this.commands = Object.freeze({
      prepare: this.#prepare,
      setState: this.#setState,
      send: this.#send,
      readyFor: this.#readyFor,
      play: this.#play,
      pause: this.#pause,
      getDiagnostics: this.#getDiagnostics
    });
    this.#nativeListeners = Object.freeze([
      Object.freeze([
        "requestedstatechange",
        this.#handleRequestedStateChange as EventListener
      ] as const),
      Object.freeze([
        "visualstatechange",
        this.#handleVisualStateChange as EventListener
      ] as const),
      Object.freeze([
        "transitionstart",
        this.#handleTransitionStart as EventListener
      ] as const),
      Object.freeze([
        "transitionend",
        this.#handleTransitionEnd as EventListener
      ] as const),
      Object.freeze(["error", this.#handleError as EventListener] as const)
    ]);
  }

  public readonly getStatus = (): Readonly<AvalAdapterStatus> => this.#status;
  public readonly getServerStatus = (): Readonly<AvalAdapterStatus> =>
    this.#serverStatus;
  public readonly getRenderOptions = ():
  Readonly<AvalAdapterRenderOptions> => this.#renderOptions;

  public readonly subscribeStatus = (listener: StoreListener): (() => void) =>
    this.#subscribe(this.#statusListeners, listener);

  public readonly subscribeOptions = (listener: StoreListener): (() => void) =>
    this.#subscribe(this.#optionsListeners, listener);

  public commit(configuration: Readonly<AvalAdapterConfiguration>): void {
    this.#callbacks = configuration.callbacks;
    if (sameAvalRenderOptions(this.#renderOptions, configuration.render)) return;
    if (this.#renderOptions.sourceKey !== configuration.render.sourceKey) {
      this.#cancelPreparation(this.#preparation);
    }
    this.#renderOptions = configuration.render;
    this.#notify(this.#optionsListeners);
  }

  public readonly attach = (node: AvalAdapterBindingNode | null): void => {
    const current = this.#attachment;
    if (node === current?.node) return;
    if (node === null) {
      if (current !== null) this.#closeAttachment(current);
      return;
    }
    if (current !== null) {
      throw new Error(
        "One AVAL adapter binding cannot be mounted more than once"
      );
    }

    let unsubscribe = NOOP;
    try {
      for (const [type, listener] of this.#nativeListeners) {
        node.addEventListener(type, listener);
      }
      const element = this.#environment.upgrade(node);
      unsubscribe = element.subscribe(this.#syncElementSnapshot);
      this.#attachment = {
        node,
        element,
        unsubscribe,
        phase: Object.freeze({ kind: "pending" })
      };
    } catch (error) {
      unsubscribe();
      this.#removeNativeListeners(node);
      throw error;
    }
  };

  public finalizeBindingTarget(target: Element | null | undefined): void {
    const attachment = this.#attachment;
    if (attachment === null) return;
    const resolved = target ?? null;
    const phase = attachment.phase;
    if (phase.kind === "mounted" && phase.target === resolved) return;
    attachment.element.interactionTarget = resolved;
    if (phase.kind === "mounted") {
      attachment.phase = Object.freeze({ ...phase, target: resolved });
      return;
    }
    const snapshot = attachment.element.getSnapshot();
    attachment.phase = Object.freeze({
      kind: "mounted",
      target: resolved,
      snapshot
    });
    this.#publishStatus(statusFromElement(snapshot));
  }

  public clearBindingTarget(): void {
    const attachment = this.#attachment;
    if (
      attachment === null || attachment.phase.kind !== "mounted" ||
      attachment.phase.target === null
    ) return;
    attachment.element.interactionTarget = null;
    attachment.phase = Object.freeze({ ...attachment.phase, target: null });
  }

  public beginReadyPreparation(): () => void {
    const attachment = this.#attachment;
    if (attachment === null) return NOOP;
    this.#cancelPreparation(this.#preparation);

    const operation: Preparation = {
      attachment,
      sourceKey: this.#renderOptions.sourceKey,
      controller: new AbortController()
    };
    this.#preparation = operation;
    void attachment.element.prepare({
      signal: operation.controller.signal
    }).then((result) => {
      if (!this.#isCurrentPreparation(operation)) return;
      this.#preparation = null;
      invokeReadyCallback(this.#callbacks.onReady, result);
    }, () => {
      if (this.#preparation === operation) this.#preparation = null;
    });

    return () => this.#cancelPreparation(operation);
  }

  readonly #prepare = (
    options?: Readonly<AvalPrepareOptions>
  ): Promise<RuntimeReadinessResult> => {
    const element = this.#attachment?.element;
    if (element === undefined) return Promise.reject(notMountedError());
    return options === undefined ? element.prepare() : element.prepare(options);
  };

  readonly #setState = (name: string): Promise<void> => {
    const element = this.#attachment?.element;
    return element === undefined
      ? Promise.reject(notMountedError())
      : element.setState(name);
  };

  readonly #send = (event: string): boolean =>
    this.#attachment?.element.send(event) ?? false;

  readonly #readyFor = (state: string): boolean =>
    this.#attachment?.element.readyFor(state) ?? false;

  readonly #play = (): Promise<void> => {
    const element = this.#attachment?.element;
    return element === undefined
      ? Promise.reject(notMountedError())
      : element.resume();
  };

  readonly #pause = (): void => {
    this.#attachment?.element.pause();
  };

  readonly #getDiagnostics = (
    options?: Readonly<{ readonly trace?: boolean }>
  ): Readonly<AvalDiagnostics> | null => {
    const element = this.#attachment?.element;
    if (element === undefined) return null;
    return options === undefined
      ? element.getDiagnostics()
      : element.getDiagnostics(options);
  };

  #subscribe(
    listeners: Set<StoreListener>,
    listener: StoreListener
  ): () => void {
    if (typeof listener !== "function") {
      throw new TypeError("AVAL adapter store subscriber must be a function");
    }
    listeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      listeners.delete(listener);
    };
  }

  #notify(listeners: ReadonlySet<StoreListener>): void {
    for (const listener of [...listeners]) {
      try { listener(); }
      catch { /* Observers cannot interrupt adapter ownership. */ }
    }
  }

  readonly #syncElementSnapshot = (): void => {
    const attachment = this.#attachment;
    if (attachment === null || attachment.phase.kind !== "mounted") return;
    const snapshot = attachment.element.getSnapshot();
    if (snapshot === attachment.phase.snapshot) return;
    attachment.phase = Object.freeze({ ...attachment.phase, snapshot });
    this.#publishStatus(statusFromElement(snapshot));
  };

  #publishStatus(status: Readonly<AvalAdapterStatus>): void {
    if (this.#status === status) return;
    this.#status = status;
    this.#notify(this.#statusListeners);
  }

  #closeAttachment(attachment: Attachment): void {
    if (this.#attachment !== attachment) return;
    this.#attachment = null;
    if (this.#preparation?.attachment === attachment) {
      this.#cancelPreparation(this.#preparation);
    }
    attachment.unsubscribe();
    if (
      attachment.phase.kind === "mounted" &&
      attachment.phase.target !== null
    ) {
      attachment.element.interactionTarget = null;
    }
    this.#removeNativeListeners(attachment.node);
    this.#publishStatus(this.#serverStatus);
  }

  #isCurrentPreparation(operation: Preparation): boolean {
    return this.#preparation === operation &&
      this.#attachment === operation.attachment &&
      this.#renderOptions.sourceKey === operation.sourceKey &&
      !operation.controller.signal.aborted;
  }

  #cancelPreparation(operation: Preparation | null): void {
    if (operation === null) return;
    operation.controller.abort();
    if (this.#preparation === operation) this.#preparation = null;
  }

  #removeNativeListeners(node: AvalAdapterBindingNode): void {
    for (const [type, listener] of this.#nativeListeners) {
      node.removeEventListener(type, listener);
    }
  }

  readonly #handleRequestedStateChange = (
    event: CustomEvent<Readonly<AvalRequestedStateChangeDetail>>
  ): void => {
    this.#callbacks.onRequestedStateChange?.(event.detail);
  };

  readonly #handleVisualStateChange = (
    event: CustomEvent<Readonly<AvalVisualStateChangeDetail>>
  ): void => {
    this.#callbacks.onVisualStateChange?.(event.detail);
  };

  readonly #handleTransitionStart = (
    event: CustomEvent<Readonly<AvalTransitionDetail>>
  ): void => {
    this.#callbacks.onTransitionStart?.(event.detail);
  };

  readonly #handleTransitionEnd = (
    event: CustomEvent<Readonly<AvalTransitionDetail>>
  ): void => {
    this.#callbacks.onTransitionEnd?.(event.detail);
  };

  readonly #handleError = (
    event: CustomEvent<Readonly<AvalErrorDetail>>
  ): void => {
    this.#callbacks.onError?.(event.detail);
  };
}

export function createAvalAdapterBinding(
  configuration: Readonly<AvalAdapterConfiguration>
): AvalAdapterBinding {
  return new AvalAdapterBindingImplementation(configuration);
}

function unmountedStatus(): Readonly<AvalAdapterStatus> {
  return Object.freeze({
    mounted: false,
    readiness: "unready",
    requestedState: null,
    visualState: null,
    isTransitioning: false,
    paused: true,
    effectivelyVisible: false,
    stateNames: EMPTY_STRINGS,
    eventNames: EMPTY_STRINGS,
    lastError: null
  });
}

function statusFromElement(
  snapshot: Readonly<AvalSnapshot>
): Readonly<AvalAdapterStatus> {
  return Object.freeze({
    mounted: true,
    readiness: snapshot.readiness,
    requestedState: snapshot.requestedState,
    visualState: snapshot.visualState,
    isTransitioning: snapshot.isTransitioning,
    paused: snapshot.paused,
    effectivelyVisible: snapshot.effectivelyVisible,
    stateNames: snapshot.stateNames,
    eventNames: snapshot.eventNames,
    lastError: snapshot.lastError
  });
}

function invokeReadyCallback(
  callback: AvalAdapterCallbacks["onReady"],
  result: Readonly<RuntimeReadinessResult>
): void {
  try { callback?.(result); }
  catch (error) {
    queueMicrotask(() => { throw error; });
  }
}

function notMountedError(): AvalNotReadyError {
  return new AvalNotReadyError("AvalComponent is not mounted");
}
