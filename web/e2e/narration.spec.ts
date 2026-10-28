import { expect, test } from "@playwright/test";
import { deck } from "@ava/shared";
import { startWithMic, status } from "./helpers.js";

test("greets, then narrates slide 1 sentence by sentence and moves on to slide 2 (brief §12 check 2)", async ({
  page,
}) => {
  await startWithMic(page);
  const captions = page.getByTestId("captions");
  await expect(captions).toContainText("Hi, I'm Ava.");
  await expect(status(page)).toHaveText(
    /Speaking — hold Space to interrupt|Hold Space or tap to talk/,
  );
  for (const seg of deck[0]!.segments.slice(0, 2)) {
    await expect(captions).toContainText(seg.text, { timeout: 10_000 });
  }
  await expect(page.locator(".bul li.on")).toHaveCount(1);
  await expect(page.getByTestId("slide-title")).toHaveText("How the medicines work", {
    timeout: 15_000,
  });
  await expect(captions).toContainText(deck[1]!.segments[0]!.text);
});
