import { expect, test } from "@playwright/test";
import { deck } from "@ava/shared";
import { fakeGain, startTyping, status } from "./helpers.js";

test("typing pauses at once; clearing the box restores the talk (brief §12 check 10)", async ({
  page,
}) => {
  await startTyping(page);
  const box = page.getByRole("textbox", { name: "Your question" });
  await expect(page.getByTestId("captions")).toContainText(deck[0]!.segments[0]!.text, {
    timeout: 10_000,
  });
  await box.click();
  await page.keyboard.type("Wh");
  await expect(status(page)).toHaveText("Paused while you type");
  expect(await fakeGain(page)).toBe(0);
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await expect(status(page)).not.toHaveText("Paused while you type");
  await expect(status(page)).toHaveText(/Speaking|Type your question/);
});

test("Esc in the question box clears it and resumes", async ({ page }) => {
  await startTyping(page);
  const box = page.getByRole("textbox", { name: "Your question" });
  await box.fill("draft");
  await expect(status(page)).toHaveText("Paused while you type");
  await box.press("Escape");
  await expect(box).toHaveValue("");
  await expect(status(page)).not.toHaveText("Paused while you type");
});

test("type → send → answer → resume", async ({ page }) => {
  await startTyping(page);
  const box = page.getByRole("textbox", { name: "Your question" });
  await box.fill("How long does one dose last?");
  await box.press("Enter");
  const captions = page.getByTestId("captions");
  await expect(captions).toContainText("How long does one dose last?");
  await expect(captions).toContainText("Here's the short answer from the reviewed deck.");
  await expect(page.locator(".line:not(.you)").last()).not.toContainText("short answer", {
    timeout: 6000,
  });
});
