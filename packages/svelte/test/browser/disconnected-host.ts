import { getControllerRecord } from "../../src/controller.js";
import { createAval } from "../../src/index.js";

// touch the registry first so webkit gives template nodes the global one;
// define() still skips this host because it is disconnected
customElements.get("aval-player");
const template = document.createElement("template");
template.innerHTML = "<aval-player></aval-player>";
const node = document.importNode(template.content, true).firstElementChild;
if (!(node instanceof HTMLElement)) throw new Error("Expected an imported host");

const aval = createAval(() => ({
  sources: { h264: "/missing-motion.avl" },
  autoplay: false,
  autoBind: false
}));
const result = document.createElement("output");
result.dataset.testid = "disconnected-attach";
try {
  getControllerRecord(aval).binding.attach(node);
  result.textContent = typeof Reflect.get(node, "getSnapshot") === "function"
    ? "attached"
    : "missing snapshot API";
} catch (error) {
  result.textContent = error instanceof Error ? error.message : String(error);
}
document.body.append(result);
