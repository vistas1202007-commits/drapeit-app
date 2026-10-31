import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e/offline", testMatch: "*.e2e.ts", outputDir: "./e2e/.results/offline",
  timeout: 30000, workers: 1, reporter: "list",
  webServer: { command: "node e2e/offline/server.mjs", url: "http://127.0.0.1:3107", reuseExistingServer: false },
  use: {
    baseURL: "http://127.0.0.1:3107", screenshot: "only-on-failure",
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
});
