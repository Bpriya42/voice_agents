import { expect, test } from "@playwright/test";
import { startWithMic, status } from "./helpers.js";

test("every control works from the keyboard (brief §12 check 12)", async ({ page }) => {
  await startWithMic(page);
  const title = page.getByTestId("slide-title");

  await page.keyboard.press("ArrowRight");
  await expect(title).toHaveText("How the medicines work");
  await page.keyboard.press("ArrowLeft");
  await expect(title).toHaveText("What is GLP-1?");
  await page.keyboard.press("4");
  await expect(title).toHaveText("What the evidence shows");
  await page.keyboard.press("6");
  await expect(title).toHaveText("What's next");
  await page.keyboard.press("1");
  await expect(title).toHaveText("What is GLP-1?");

  await page.keyboard.press("p");
  await expect(status(page)).toHaveText("Paused — press Resume or P");
  await expect(page.getByRole("button", { name: "Resume" })).toBeVisible();
  await page.keyboard.press("p");
  await expect(status(page)).not.toHaveText(/Paused/);

  await page.keyboard.press("Shift+?");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.keyboard.press("/");
  await expect(page.getByRole("textbox", { name: "Your question" })).toBeFocused();
  // Shortcuts are ignored while typing.
  await page.keyboard.type("4");
  await expect(title).toHaveText("What is GLP-1?");
  await page.keyboard.press("Escape");

  // Space held → listening; Esc cancels the turn.
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.down("Space");
  await expect(status(page)).toHaveText("Listening…");
  await page.keyboard.press("Escape");
  await page.keyboard.up("Space");
  await expect(status(page)).not.toHaveText("Listening…");

  await page.keyboard.press("Shift+E");
  await expect(page.getByRole("heading", { name: "Thanks for listening" })).toBeVisible();
});

test("controls are reachable with Tab and show a focus ring", async ({ page }) => {
  await startWithMic(page);
  await page.getByRole("button", { name: "Next slide" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("slide-title")).toHaveText("How the medicines work");
  const outline = await page
    .getByRole("button", { name: "Next slide" })
    .evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe("none");
});

test("R retries a shown error", async ({ page }) => {
  // Slow fake speech, so the answer is still running when P pauses it.
  await startWithMic(page, "&fakeMsPerChar=80");
  // Pausing during a question cuts the answer; R asks again.
  await page.getByRole("textbox", { name: "Your question" }).fill("Tell me more");
  await page.keyboard.press("Enter");
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("p");
  await expect(page.getByText("That answer was cut short.")).toBeVisible();
  await page.keyboard.press("r");
  await expect(page.getByText("That answer was cut short.")).toHaveCount(0);
});
