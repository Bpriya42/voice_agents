import { expect, test } from "@playwright/test";
import { startWithMic } from "./helpers.js";

test("End shows the end screen, stops the mic track and closes the adapter (brief §12 check 13)", async ({
  page,
}) => {
  await startWithMic(page);
  await page.getByRole("textbox", { name: "Your question" }).fill("What are the side effects?");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "End presentation" }).click();
  await expect(page.getByRole("heading", { name: "Thanks for listening" })).toBeVisible();
  await expect(page.getByText("What are the side effects?")).toBeVisible();
  const state = await page.evaluate(() => {
    const w = window as unknown as {
      __avaMic: () => MediaStream | null;
      __avaFake: { closed: boolean };
    };
    const track = w.__avaMic()?.getAudioTracks()[0];
    return { track: track?.readyState ?? "released", closed: w.__avaFake.closed };
  });
  expect(["ended", "released"]).toContain(state.track);
  expect(state.closed).toBe(true);
});

test("End during capture releases the mic at once", async ({ page }) => {
  await startWithMic(page);
  const track = await page.evaluateHandle(
    () =>
      (window as unknown as { __avaMic: () => MediaStream | null })
        .__avaMic()!
        .getAudioTracks()[0]!,
  );
  await page.keyboard.down("Space");
  await page.keyboard.press("Shift+E");
  await page.keyboard.up("Space");
  await expect(page.getByRole("heading", { name: "Thanks for listening" })).toBeVisible();
  expect(await track.evaluate((t) => t.readyState)).toBe("ended");
});

test("Restart returns to the first screen", async ({ page }) => {
  await startWithMic(page);
  await page.keyboard.press("Shift+E");
  await page.getByRole("button", { name: "Restart" }).click();
  await expect(page.getByRole("button", { name: "Check microphone" })).toBeVisible();
});
