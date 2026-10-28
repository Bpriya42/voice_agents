import { expect, test } from "@playwright/test";
import { deck } from "@ava/shared";
import {
  configuredHealth,
  createdInstructions,
  startTyping,
  status,
  stubSpeech,
} from "./helpers.js";

// Check 8b. `context.setOffline` fires the browser's offline / online events and fails real
// requests; mocked routes still answer, so the health route aborts while "offline".
test("offline shows the scripts, then live voice returns on the same slide (check 8b, no local voice)", async ({
  page,
  context,
}) => {
  await stubSpeech(page, []); // no usable local voice
  await startTyping(page);
  let offline = false;
  await page.route("**/api/health", (route) =>
    offline ? route.abort("internetdisconnected") : route.fulfill({ json: configuredHealth }),
  );
  await page.getByRole("button", { name: "Next slide" }).click();
  await expect(page.getByTestId("slide-title")).toHaveText(deck[1]!.title);
  await page.getByRole("textbox", { name: "Your question" }).fill("a draft question");

  offline = true;
  await context.setOffline(true);
  await expect(status(page)).toHaveText("You're offline — questions are paused", {
    timeout: 10_000,
  });
  await expect(page.getByTestId("voice-tag")).toHaveText("Offline");
  await expect(page.getByTestId("script")).toContainText(deck[1]!.segments[0]!.text);
  await expect(page.getByRole("textbox", { name: "Your question" })).toBeDisabled();
  await expect(page.getByRole("textbox", { name: "Your question" })).toHaveValue(
    "a draft question",
  );

  offline = false;
  await context.setOffline(false);
  await expect(status(page)).not.toHaveText("You're offline — questions are paused", {
    timeout: 10_000,
  });
  await expect(page.getByTestId("script")).toHaveCount(0);
  await expect(page.getByTestId("slide-title")).toHaveText(deck[1]!.title);
  await expect(page.getByRole("textbox", { name: "Your question" })).toBeEnabled();
  await expect(page.getByRole("textbox", { name: "Your question" })).toHaveValue(
    "a draft question",
  );
  // The draft still holds the talk paused; clearing it resumes the checkpoint sentence.
  await page.getByRole("textbox", { name: "Your question" }).fill("");
  await expect
    .poll(async () => (await createdInstructions(page)).join("\n"))
    .toContain(deck[1]!.segments[0]!.text);
});

test("offline with an on-device voice keeps narrating locally (check 8b, local voice)", async ({
  page,
  context,
}) => {
  await stubSpeech(page, [{ localService: true, name: "Local stub" }]);
  await startTyping(page);
  let offline = false;
  await page.route("**/api/health", (route) =>
    offline ? route.abort("internetdisconnected") : route.fulfill({ json: configuredHealth }),
  );
  offline = true;
  await context.setOffline(true);
  await expect(page.getByTestId("voice-tag")).toHaveText("Offline", { timeout: 10_000 });
  await expect(page.getByTestId("script")).toHaveCount(0);
  // Local speech goes on with the next sentences.
  await expect(page.getByTestId("captions")).toContainText(deck[0]!.segments[2]!.text, {
    timeout: 10_000,
  });
  offline = false;
  await context.setOffline(false);
  await expect(page.getByTestId("voice-tag")).toHaveCount(0, { timeout: 10_000 });
});
