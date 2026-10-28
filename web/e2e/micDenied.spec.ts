import { expect, test } from "@playwright/test";
import { deck } from "@ava/shared";
import { mockHealth, status } from "./helpers.js";

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

test("check 7: deny the mic, continue by typing, typed questions get answers and slide changes", async ({
  page,
}) => {
  await mockHealth(page);
  await page.goto("/?fake=1");
  await page.getByRole("button", { name: "Check microphone" }).click();
  await expect(page.getByText("Microphone access is blocked.")).toBeVisible();
  await page.getByRole("button", { name: "Continue by typing" }).click();
  await page.getByRole("button", { name: "Start presentation" }).click();

  // Text mode is a full experience: Ava still speaks, and a way back to voice is on offer.
  await expect(page.getByTestId("slide-title")).toHaveText("What is GLP-1?");
  await expect(page.getByText("Text mode — Ava still speaks")).toBeVisible();
  await expect(page.getByRole("button", { name: "Try microphone again" })).toBeVisible();
  await expect(page.getByTestId("captions")).toContainText(deck[0]!.segments[0]!.text, {
    timeout: 10_000,
  });
  await expect(status(page)).not.toContainText("Space");

  await page.getByRole("textbox", { name: "Your question" }).fill("What are the side effects?");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("slide-title")).toHaveText("Side effects and safety");
  await expect(page.getByTestId("captions")).toContainText(deck[4]!.segments[0]!.text);
});

test("Try microphone again with the mic still blocked explains what to do and stays in text mode", async ({
  page,
}) => {
  await mockHealth(page);
  await page.goto("/?fake=1");
  await page.getByRole("button", { name: "Check microphone" }).click();
  await page.getByRole("button", { name: "Continue by typing" }).click();
  await page.getByRole("button", { name: "Start presentation" }).click();
  await expect(page.getByTestId("slide-title")).toHaveText("What is GLP-1?");
  await page.getByRole("button", { name: "Try microphone again" }).click();
  await expect(page.getByText("lock icon in the address bar")).toBeVisible();
  await expect(page.getByText("Text mode — Ava still speaks")).toBeVisible();
});
