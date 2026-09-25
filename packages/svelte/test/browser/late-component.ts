import { mount } from "svelte";

import LateDefinition from "./LateDefinition.svelte";

const target = document.querySelector<HTMLElement>("#app");
if (target === null) throw new Error("Svelte browser test mount is missing");
mount(LateDefinition, { target });
