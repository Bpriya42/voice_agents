import { expect, test } from "@playwright/test";
import { mockHealth } from "./helpers.js";

// Headless Chromium has no permission prompt to deny (getUserMedia fails with NotSupportedError),
// so the browser's denial is simulated with the exact error a blocked site gets.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
  });
});

test("a denied mic shows the blocked message, Retry and Continue by typing", async ({ page }) => {
  await mockHealth(page);
  await page.goto("/?fake=1");
  await page.getByRole("button", { name: "Check microphone" }).click();
  await expect(page.getByText("Microphone access is blocked.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start presentation" })).toBeDisabled();
  await page.getByRole("button", { name: "Continue by typing" }).click();
  await expect(page.getByRole("heading", { name: "Ready when you are" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start presentation" })).toBeEnabled();
});
