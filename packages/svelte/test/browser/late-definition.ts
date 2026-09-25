import { getControllerRecord } from "../../src/controller.js";
import { createAval } from "../../src/index.js";

// webkit gives template nodes a null registry until window.customElements has
// been touched, and those nodes never upgrade. nothing here may touch it
// before createAval does.
const aval = createAval(() => ({
  sources: { h264: "/missing-motion.avl" },
  autoplay: false,
  autoBind: false
}));
const template = document.createElement("template");
template.innerHTML = '<aval-player data-testid="imported-player"></aval-player>';
const node = document.importNode(template.content, true).firstElementChild;
if (!(node instanceof HTMLElement)) throw new Error("Expected an imported host");
document.body.append(node);

const result = document.createElement("output");
result.dataset.testid = "imported-attach";
try {
  getControllerRecord(aval).binding.attach(node);
  result.textContent = "attached";
} catch (error) {
  result.textContent = error instanceof Error ? error.message : String(error);
}
document.body.append(result);
