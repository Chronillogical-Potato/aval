import { defineAvalElement } from "@pixel-point/aval-element";
import {
  createAvalAdapterBinding,
  createAvalAdapterConfiguration,
  type AvalAdapterBinding
} from "@pixel-point/aval-element/adapter";

import type {
  AvalSvelteInstance,
  CreateAvalOptions
} from "./types.js";

interface ControllerRecord {
  readonly binding: AvalAdapterBinding;
  readonly readOptions: () => Readonly<CreateAvalOptions>;
}

const CONTROLLER_RECORDS = new WeakMap<object, ControllerRecord>();

export function createAval(
  readOptions: () => Readonly<CreateAvalOptions>
): AvalSvelteInstance {
  if (typeof readOptions !== "function") {
    throw new TypeError("createAval requires an option getter");
  }
  // svelte clones hosts from templates, and webkit never upgrades template
  // nodes created before the first customElements access
  if (typeof globalThis.customElements !== "undefined") defineAvalElement();

  const configuration = createAvalAdapterConfiguration(readOptions());
  const binding = createAvalAdapterBinding(configuration);
  const subscribe: AvalSvelteInstance["subscribe"] = (run) => {
    run(binding.getStatus());
    return binding.subscribeStatus(() => run(binding.getStatus()));
  };
  const aval: AvalSvelteInstance = Object.freeze({
    subscribe,
    ...binding.commands
  });

  CONTROLLER_RECORDS.set(aval, Object.freeze({ binding, readOptions }));
  return aval;
}

export function getControllerRecord(instance: unknown): ControllerRecord {
  const record = isObject(instance)
    ? CONTROLLER_RECORDS.get(instance)
    : undefined;
  if (record === undefined) {
    throw new TypeError(
      "AvalComponent requires an aval controller created by createAval"
    );
  }
  return record;
}

function isObject(value: unknown): value is object {
  return (typeof value === "object" && value !== null) ||
    typeof value === "function";
}
