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
export async function startTyping(page: Page, query = "") {
  await mockHealth(page);
  await page.goto(`/?fake=1${query}`);
  await page.getByRole("button", { name: "Continue without mic (type instead)" }).click();
  await page.getByRole("button", { name: "Start presentation" }).click();
  await expect(page.getByTestId("slide-title")).toHaveText("What is GLP-1?");
}

/** Voice mode: passes the mic check with Chrome's fake device, then starts with the fake adapter. */
export async function startWithMic(page: Page, query = "") {
  await mockHealth(page);
  await page.goto(`/?fake=1${query}`);
  await page.getByRole("button", { name: "Check microphone" }).click();
  await expect(page.getByText("We can hear you")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Start presentation" }).click();
  await expect(page.getByTestId("slide-title")).toHaveText("What is GLP-1?");
}

export const status = (page: Page) => page.getByTestId("status");

/** Instructions of every response the live fake adapter was asked to create. */
export const createdInstructions = (page: Page) =>
  page.evaluate(() =>
    (
      window as unknown as {
        __avaFake: { commands: { type: string; req?: { instructions: string } }[] };
      }
    ).__avaFake.commands
      .filter((c) => c.type === "createResponse")
      .map((c) => c.req!.instructions),
  );

/** Stubs speechSynthesis: utterances start after 10 ms and end after 80 ms. */
export async function stubSpeech(page: Page, voices: { localService: boolean; name: string }[]) {
  await page.addInitScript((v) => {
    const spoken: string[] = [];
    const synth = {
      speak(u: SpeechSynthesisUtterance) {
        spoken.push(u.text);
        setTimeout(() => u.onstart?.(new Event("start") as SpeechSynthesisEvent), 10);
        setTimeout(() => u.onend?.(new Event("end") as SpeechSynthesisEvent), 80);
      },
      cancel() {},
      getVoices: () => v,
    };
    Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
    // Real utterances reject plain objects as voices; the stub list uses plain objects.
    class StubUtterance {
      lang = "";
      voice: unknown = null;
      onstart: unknown = null;
      onend: unknown = null;
      onerror: unknown = null;
      constructor(public text: string) {}
    }
    Object.defineProperty(window, "SpeechSynthesisUtterance", {
      value: StubUtterance,
      configurable: true,
    });
    (window as unknown as { __spoken: string[] }).__spoken = spoken;
  }, voices);
}

export const spokenTexts = (page: Page) =>
  page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken);

/** Output gain of the fake adapter, through the e2e-only test hook. */
export const fakeGain = (page: Page) =>
  page.evaluate(() => (window as unknown as { __avaFake: { gain: number } }).__avaFake.gain);

/** Text of the most recent Ava caption. */
export const lastAvaCaption = (page: Page) =>
  page.locator(".line:not(.you) p:first-of-type").last();
