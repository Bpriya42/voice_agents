import { expect, test } from "@playwright/test";
import { startWithMic } from "./helpers.js";

test("a mic that disappears mid-talk switches to text mode and Try microphone again restores voice", async ({
  page,
}) => {
  await startWithMic(page);
  await expect(page.getByText("Text mode — Ava still speaks")).toHaveCount(0);
  await page.evaluate(() =>
    (window as unknown as { __avaFake: { micEnded: () => void } }).__avaFake.micEnded(),
  );
  await expect(page.getByText(/Your microphone disconnected/).first()).toBeVisible();
  await expect(page.getByText("Text mode — Ava still speaks")).toBeVisible();
  await page.getByRole("button", { name: "Try microphone again" }).click();
  await expect(page.getByText("Text mode — Ava still speaks")).toHaveCount(0);
});
