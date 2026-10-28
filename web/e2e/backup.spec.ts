import { expect, test } from "@playwright/test";
import { deck } from "@ava/shared";
import { spokenTexts, startTyping, status, stubSpeech } from "./helpers.js";

// Check 8a. Live voice is simulated unreachable by making the fake adapter fail three connects
// (the initial attempt and both retries). The text backend, speech and /api/chat are mocked.
test("after the retries fail, backup voice continues the talk and answers typed questions (check 8a)", async ({
  page,
}) => {
  await stubSpeech(page, [{ localService: false, name: "Stub voice" }]);
  let chatBody: { question?: string; slideId?: string } | null = null;
  await page.route("**/api/chat", async (route) => {
    chatBody = route.request().postDataJSON();
    await route.fulfill({
      json: {
        answer: "Mocked backup answer about safety.",
        goto_slide: { slide_id: "safety", intent: "answer" },
      },
    });
  });
  await startTyping(page, "&fakeFailConnect=3");
  await page.evaluate(() => ((window as unknown as { __noReload: number }).__noReload = 1));

  await expect(status(page)).toHaveText("Can't connect to the voice service.", {
    timeout: 10_000,
  });
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  await page.getByRole("button", { name: "Continue with backup voice" }).click();

  // The downgrade is honest, and the talk carries on by itself.
  await expect(page.getByTestId("voice-tag")).toHaveText("Backup voice");
  await expect(page.getByTestId("captions")).toContainText(deck[0]!.segments[0]!.text);
  await expect(page.getByTestId("captions")).toContainText(deck[0]!.segments[1]!.text);
  expect(await spokenTexts(page)).toContain(deck[0]!.segments[0]!.text);
  await expect(page.getByRole("button", { name: "Try live voice again" })).toBeVisible();

  // A typed question goes to the mocked /api/chat; its answer is shown and spoken, and the slide moves.
  await page.getByRole("textbox", { name: "Your question" }).fill("What are the side effects?");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("slide-title")).toHaveText("Side effects and safety");
  await expect(page.getByTestId("captions")).toContainText("Mocked backup answer about safety.");
  await expect.poll(() => spokenTexts(page)).toContain("Mocked backup answer about safety.");
  expect(chatBody).toMatchObject({ question: "What are the side effects?" });
  expect(deck.map((s) => s.id)).toContain((chatBody as unknown as { slideId: string }).slideId);

  // Afterwards the talk returns to where it was (with a bridge) and keeps going.
  await expect
    .poll(async () => (await spokenTexts(page)).some((t) => t.startsWith("Back to where we were")))
    .toBe(true);
  await expect(status(page)).not.toHaveText("Connection lost — reconnecting…");
  expect(await page.evaluate(() => (window as unknown as { __noReload?: number }).__noReload)).toBe(
    1,
  );
});

test("with no speech engine, backup voice shows the scripts and answers as text", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "speechSynthesis", { value: undefined, configurable: true });
  });
  await page.route("**/api/chat", (route) =>
    route.fulfill({ json: { answer: "A text-only answer." } }),
  );
  await startTyping(page, "&fakeFailConnect=3");
  await expect(status(page)).toHaveText("Can't connect to the voice service.", {
    timeout: 10_000,
  });
  await page.getByRole("button", { name: "Continue with backup voice" }).click();
  await expect(page.getByTestId("script")).toContainText(deck[0]!.segments[0]!.text);
  await expect(page.getByText("Audio unavailable", { exact: false }).first()).toBeVisible();
  await page.getByRole("textbox", { name: "Your question" }).fill("What is it?");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("captions")).toContainText("A text-only answer.");
  // The talk stays paused until audio works; navigation still moves the script.
  await page.getByRole("button", { name: "Next slide" }).click();
  await expect(page.getByTestId("script")).toContainText(deck[1]!.segments[0]!.text);
});
