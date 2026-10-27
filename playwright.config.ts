import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "web/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"] ? "github" : "list",
  use: { baseURL: "http://localhost:5173", trace: "retain-on-failure" },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Fake mic so mic-check flows run without hardware or a permission prompt.
        launchOptions: {
          args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
        },
        permissions: ["microphone"],
      },
    },
  ],
  webServer: {
    command: "npm run dev:e2e",
    // Wait for the API through the proxy, not just Vite: the server starts a little later.
    url: "http://localhost:5173/api/health",
    reuseExistingServer: !process.env["CI"],
    timeout: 60_000,
    // e2e never uses a real key or the network: an empty value wins over .env (Node does not override set vars).
    env: { OPENAI_API_KEY: "" },
  },
});
