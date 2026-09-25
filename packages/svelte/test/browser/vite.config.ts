import { fileURLToPath } from "node:url";

import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  build: {
    outDir: fileURLToPath(
      new URL("../../../../.cache/svelte-browser", import.meta.url)
    ),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: `${root}/index.html`,
        lateDefinition: `${root}/late-definition.html`,
        lateComponent: `${root}/late-component.html`,
        disconnectedHost: `${root}/disconnected-host.html`
      }
    }
  },
  plugins: [svelte({
    configFile: fileURLToPath(new URL("../../svelte.config.js", import.meta.url))
  })],
  resolve: {
    alias: [
      {
        find: "@pixel-point/aval-element/adapter",
        replacement: fileURLToPath(new URL("../../../element/src/adapter.ts", import.meta.url))
      },
      {
        find: "@pixel-point/aval-element",
        replacement: fileURLToPath(new URL("../../../element/src/index.ts", import.meta.url))
      }
    ]
  }
});
