import { expect, type Page } from "@playwright/test";

export const configuredHealth = {
  configured: true,
  keyValid: true,
  limits: { sessionMaxMinutes: null, busy: false, paused: false },
  public: {},
};

/** The e2e server has no key, so tests that start a talk mock a configured health response. */
export async function mockHealth(page: Page, body: object = configuredHealth) {
  await page.route("**/api/health", (r) => r.fulfill({ json: body }));
}

/** Text mode with the fake voice adapter (?fake=1). */
export async function startTyping(page: Page) {
  await mockHealth(page);
  await page.goto("/?fake=1");
  await page.getByRole("button", { name: "Continue without mic (type instead)" }).click();
  await page.getByRole("button", { name: "Start presentation" }).click();
  await expect(page.getByTestId("slide-title")).toHaveText("What is GLP-1?");
}

/** Voice mode: passes the mic check with Chrome's fake device, then starts with the fake adapter. */
export async function startWithMic(page: Page) {
  await mockHealth(page);
  await page.goto("/?fake=1");
  await page.getByRole("button", { name: "Check microphone" }).click();
  await expect(page.getByText("We can hear you")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Start presentation" }).click();
  await expect(page.getByTestId("slide-title")).toHaveText("What is GLP-1?");
}

export const status = (page: Page) => page.getByTestId("status");

/** Output gain of the fake adapter, through the e2e-only test hook. */
export const fakeGain = (page: Page) =>
  page.evaluate(() => (window as unknown as { __avaFake: { gain: number } }).__avaFake.gain);

/** Text of the most recent Ava caption. */
export const lastAvaCaption = (page: Page) =>
  page.locator(".line:not(.you) p:first-of-type").last();
