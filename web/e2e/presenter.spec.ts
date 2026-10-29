import { expect, test, type Page } from "@playwright/test";
import { deck } from "@ava/shared";
import { createdInstructions, mockHealth, status } from "./helpers.js";

/** The presenter the live fake adapter was opened for, through the e2e-only test hook. */
const fakePersona = (page: Page) =>
  page.evaluate(() => (window as unknown as { __avaFake: { persona: string } }).__avaFake.persona);

const radio = (page: Page, name: string) => page.getByRole("radio", { name });
const heading = (page: Page) => page.getByRole("heading", { level: 1 });

async function landing(page: Page, query = "") {
  await mockHealth(page);
  // No sample clips are committed in e2e runs; a missing clip must not break anything.
  await page.route("**/voices/*.mp3", (r) => r.fulfill({ status: 404 }));
  await page.goto(`/?fake=1${query}`);
}

test("Ava is the default presenter of Podium", async ({ page }) => {
  await landing(page);
  await expect(page).toHaveTitle("Podium · Ava");
  await expect(radio(page, "Ava")).toBeChecked();
  await expect(heading(page)).toHaveText("Ava explains GLP-1 medicines");
  await expect(page.locator(".masthead")).toContainText("Podium · A talk with Ava");
});

test("choosing Theo carries through the mic check, splash, greeting and captions (brief §12 check 17)", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await landing(page);
  await radio(page, "Theo").check();
  await expect(heading(page)).toHaveText("Theo explains GLP-1 medicines");
  await expect(page).toHaveTitle("Podium · Theo");
  await expect(page.getByRole("button", { name: "Hear Theo" })).toBeVisible();

  // The mic check is unchanged: no presenter picker there.
  await page.getByRole("button", { name: "Check microphone" }).click();
  await expect(page.getByRole("heading", { name: "Check your microphone" })).toBeVisible();
  await expect(page.getByTestId("presenter-picker")).toHaveCount(0);
  await expect(page.getByText("We can hear you")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Start presentation" }).click();

  await expect(page.locator(".splash-mark")).toHaveText("Theo");
  await expect(page.getByTestId("captions")).toContainText("Hi, I'm Theo.", { timeout: 10_000 });
  await expect(page.locator(".lh-brand")).toContainText("Theo");
  expect(await fakePersona(page)).toBe("theo");
  const instructions = await createdInstructions(page);
  expect(instructions[0]).toMatch(/^You are Theo,/);
  expect(instructions.join("\n")).not.toContain("You are Ava");
  expect(errors).toEqual([]);
});

test("the presenter survives a reconnect", async ({ page }) => {
  await landing(page, "&fakeConnectDelayMs=600");
  await radio(page, "Mira").check();
  await page.getByRole("button", { name: "Continue without mic (type instead)" }).click();
  await page.getByRole("button", { name: "Start presentation" }).click();
  await expect(page.getByTestId("captions")).toContainText(deck[0]!.segments[0]!.text, {
    timeout: 10_000,
  });

  await page.evaluate(() =>
    (window as unknown as { __avaFake: { drop: (r: string) => void } }).__avaFake.drop("network"),
  );
  await expect(status(page)).toHaveText("Connection lost — reconnecting…");
  await expect(status(page)).not.toHaveText("Connection lost — reconnecting…", { timeout: 10_000 });
  expect(await fakePersona(page)).toBe("mira");
  await expect
    .poll(async () => (await createdInstructions(page)).join("\n"))
    .toContain("We're back.");
  expect((await createdInstructions(page)).every((i) => i.startsWith("You are Mira,"))).toBe(true);
});

test("typing mode greets as the chosen presenter", async ({ page }) => {
  await landing(page);
  await radio(page, "Mira").check();
  await page.getByRole("button", { name: "Continue without mic (type instead)" }).click();
  await expect(page.getByText("Mira still speaks")).toBeVisible();
  await page.getByRole("button", { name: "Start presentation" }).click();
  await expect(page.getByTestId("captions")).toContainText("Hi, I'm Mira.", { timeout: 10_000 });
  await expect(page.getByText("Text mode — Mira still speaks")).toBeVisible();
});

test("the choice is remembered, works from the keyboard, and survives End and Restart", async ({
  page,
}) => {
  await landing(page);
  await radio(page, "Ava").focus();
  await page.keyboard.press("ArrowRight");
  await expect(radio(page, "Theo")).toBeChecked();
  await expect(heading(page)).toHaveText("Theo explains GLP-1 medicines");

  await page.reload();
  await expect(radio(page, "Theo")).toBeChecked();

  await page.getByRole("button", { name: "Continue without mic (type instead)" }).click();
  await page.getByRole("button", { name: "Start presentation" }).click();
  await expect(page.getByTestId("slide-title")).toHaveText("What is GLP-1?");
  await page.keyboard.press("Shift+E");
  await expect(page.locator(".masthead")).toContainText("A talk with Theo");
  await page.getByRole("button", { name: "Restart" }).click();
  await expect(radio(page, "Theo")).toBeChecked();
  await radio(page, "Ava").check();
  await expect(heading(page)).toHaveText("Ava explains GLP-1 medicines");
});
