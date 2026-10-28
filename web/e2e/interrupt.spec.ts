import { expect, test } from "@playwright/test";
import { deck } from "@ava/shared";
import { fakeGain, startWithMic, status } from "./helpers.js";

const s0 = deck[0]!.segments[0]!.text;

test("hold Space → Listening and the output gate is silent → release → Thinking → answer → resume (brief §12 check 3)", async ({
  page,
}) => {
  await startWithMic(page);
  const captions = page.getByTestId("captions");
  await expect(captions).toContainText(s0, { timeout: 10_000 });
  await page.keyboard.down("Space");
  await expect(status(page)).toHaveText("Listening…");
  expect(await fakeGain(page)).toBe(0);
  await page.waitForTimeout(450);
  await page.keyboard.up("Space");
  await expect(status(page)).toHaveText(/Thinking…|Speaking/);
  await expect(captions).toContainText("Can you say more about that?");
  await expect(captions).toContainText("Here's the short answer from the reviewed deck.");
  // After the 1.5 s resume window, narration picks the interrupted sentence back up.
  await expect(page.locator(".line:not(.you)").last()).not.toContainText("short answer", {
    timeout: 6_000,
  });
  await expect(status(page)).toHaveText(/Speaking|Hold Space/);
});

test("a short Space press restarts the interrupted sentence", async ({ page }) => {
  await startWithMic(page);
  const captions = page.getByTestId("captions");
  await expect(captions).toContainText(s0, { timeout: 10_000 });
  await page.keyboard.down("Space");
  await page.keyboard.up("Space");
  // The cut line is closed with a dash and the same checkpoint is narrated again.
  await expect(page.locator(".line.cut")).not.toHaveCount(0);
  await expect(status(page)).not.toHaveText("Listening…");
  await expect(page.locator(".line:not(.you)").last()).not.toHaveClass(/cut/);
});

test("the orb toggles capture: tap to start, tap to send", async ({ page }) => {
  await startWithMic(page);
  const orb = page.getByRole("button", { name: "Tap to talk" });
  await orb.click();
  await expect(status(page)).toHaveText("Listening…");
  await page.getByRole("button", { name: "Tap to send" }).click();
  await expect(page.getByTestId("captions")).toContainText("Can you say more about that?");
});
