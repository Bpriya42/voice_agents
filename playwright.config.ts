import { defineConfig, devices } from "@playwright/test";
import { writeFakeSpeechWav } from "./web/e2e/fakeSpeech.js";

// Fake mic so mic-check flows run without hardware or a permission prompt. The fed file is
// speech-like so the 300 ms speech detector can pass.
const fakeMedia = [
  "--use-fake-ui-for-media-stream",
  "--use-fake-device-for-media-stream",
  `--use-file-for-fake-audio-capture=${writeFakeSpeechWav()}`,
  "--autoplay-policy=no-user-gesture-required",
];

// e2e uses its own ports so a running `npm run dev` (fake adapter off) is never reused by mistake.
const webPort = 5174;
const apiPort = 8788;

export default defineConfig({
  testDir: "web/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"] ? "github" : "list",
  use: { baseURL: `http://localhost:${webPort}`, trace: "retain-on-failure" },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: { args: fakeMedia },
        permissions: ["microphone"],
      },
    },
  ],
  webServer: {
    command: "npm run dev:e2e",
    // Wait for the API through the proxy, not just Vite: the server starts a little later.
    url: `http://localhost:${webPort}/api/health`,
    reuseExistingServer: !process.env["CI"],
    timeout: 60_000,
    // e2e never uses a real key or the network: an empty value wins over .env (Node does not override set vars).
    env: { OPENAI_API_KEY: "", WEB_PORT: String(webPort), PORT: String(apiPort) },
  },
});
