import { expect, test } from "@playwright/test";
import { deck } from "@ava/shared";
import { createdInstructions, startTyping, status } from "./helpers.js";

test("a dropped transport reconnects on the same slide without a reload (arch §6.3)", async ({
  page,
}) => {
  // Reconnects take 1.2 s so the "reconnecting" state can be observed.
  await startTyping(page, "&fakeConnectDelayMs=1200");
  await page.evaluate(() => ((window as unknown as { __noReload: number }).__noReload = 1));
  await expect(page.getByTestId("captions")).toContainText(deck[0]!.segments[0]!.text, {
    timeout: 10_000,
  });

  await page.getByRole("button", { name: "Next slide" }).click();
  await page.getByRole("button", { name: "Next slide" }).click();
  const title = deck[2]!.title;
  await expect(page.getByTestId("slide-title")).toHaveText(title);

  await page.evaluate(() =>
    (window as unknown as { __avaFake: { drop: (r: string) => void } }).__avaFake.drop("network"),
  );
  await expect(status(page)).toHaveText("Connection lost — reconnecting…");
  await expect(page.getByTestId("slide-title")).toHaveText(title);

  await expect(status(page)).not.toHaveText("Connection lost — reconnecting…", { timeout: 10_000 });
  await expect(page.getByTestId("slide-title")).toHaveText(title);
  // The new session was told to say "We're back" and carry on from the checkpoint.
  await expect
    .poll(async () => (await createdInstructions(page)).join("\n"))
    .toContain("We're back.");
  // No reload, no error banner.
  expect(await page.evaluate(() => (window as unknown as { __noReload?: number }).__noReload)).toBe(
    1,
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("a typed question still works after a reconnect", async ({ page }) => {
  await startTyping(page);
  await page.evaluate(() =>
    (window as unknown as { __avaFake: { drop: (r: string) => void } }).__avaFake.drop("server"),
  );
  await expect(status(page)).not.toHaveText("Connection lost — reconnecting…", { timeout: 10_000 });
  await page.getByRole("textbox", { name: "Your question" }).fill("What are the side effects?");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("slide-title")).toHaveText("Side effects and safety");
});
