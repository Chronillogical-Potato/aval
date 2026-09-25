import { defineConfig, devices } from "@playwright/test";

const port = process.env.AVAL_SVELTE_BROWSER_PORT ?? "4188";
const baseURL = `http://127.0.0.1:${port}`;
const previewPort = process.env.AVAL_SVELTE_PREVIEW_PORT ?? "4189";
const previewURL = `http://127.0.0.1:${previewPort}`;

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure"
  },
  webServer: [{
    command: `vite --config vite.config.ts --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000
  }, {
    // the dev client registers its own custom element first, which hides
    // webkit's null-registry upgrade failure
    command: `vite build --config vite.config.ts --logLevel error && vite preview --config vite.config.ts --host 127.0.0.1 --port ${previewPort} --strictPort`,
    url: `${previewURL}/late-definition.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000
  }],
  projects: [{
    name: "chromium",
    use: {
      ...devices["Desktop Chrome"],
      channel: "chromium"
    }
  }, {
    name: "webkit",
    testMatch: "late-definition.spec.ts",
    use: {
      ...devices["Desktop Safari"],
      baseURL: previewURL
    }
  }]
});
