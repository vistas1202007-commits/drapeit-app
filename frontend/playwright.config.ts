import { defineConfig, devices } from "@playwright/test";

// Browser tests for the whole app (see e2e/README.md). They run against a website and backend that are
// already running (npm run build && npm start, plus the backend), using the Chrome installed on this computer.
export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/.results/artifacts",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["json", { outputFile: "e2e/.results/report.json" }]],
  globalSetup: "./e2e/support/global-setup.ts",
  globalTeardown: "./e2e/support/global-teardown.ts",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    channel: "chrome",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 15_000,
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "desktop",
      dependencies: ["setup"],
      testMatch: /(flows|pages)\/.*\.e2e\.ts/,
      use: { viewport: { width: 1280, height: 800 } },
    },
    {
      name: "mobile",
      dependencies: ["setup"],
      testMatch: /pages\/.*\.e2e\.ts/,
      use: { ...devices["Pixel 7"], channel: "chrome", viewport: { width: 390, height: 844 } },
    },
  ],
});
