import { expect, test, type Page } from "@playwright/test";
import { mockHealth, startTyping } from "./helpers.js";

const LONG_LABEL =
  "Microphone Array (Intel® Smart Sound Technology for Digital Microphones) — a very long device name";

/** Adds a second microphone with a long label so the device picker shows. */
async function longMicLabel(page: Page) {
  await page.addInitScript((label) => {
    const md = navigator.mediaDevices;
    const real = md.enumerateDevices.bind(md);
    md.enumerateDevices = async () => {
      const list = await real();
      const extra = {
        deviceId: "long",
        groupId: "g",
        kind: "audioinput",
        label,
        toJSON: () => ({}),
      } as MediaDeviceInfo;
      return [...list, extra];
    };
  }, LONG_LABEL);
}

async function noHorizontalScroll(page: Page) {
  const { sw, w } = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    w: window.innerWidth,
  }));
  expect(sw).toBeLessThanOrEqual(w);
}

test("the mic check card contains a long device name (no overflow)", async ({ page }) => {
  await longMicLabel(page);
  await mockHealth(page);
  await page.goto("/?fake=1");
  await page.getByRole("button", { name: "Check microphone" }).click();
  const select = page.getByRole("combobox");
  await expect(select).toBeVisible({ timeout: 10_000 });
  const card = await page.locator(".card").boundingBox();
  const box = await select.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(card!.x + card!.width + 0.5);
  await noHorizontalScroll(page);
});

test("the live view fills the viewport and the slide fits inside it", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await startTyping(page);
  const stage = await page.locator(".stage").boundingBox();
  expect(stage!.width).toBeGreaterThan(900);
  expect(stage!.y + stage!.height).toBeLessThanOrEqual(720);
  await noHorizontalScroll(page);
});

test("phone width has no horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await mockHealth(page);
  await page.goto("/?fake=1");
  await noHorizontalScroll(page);
  await startTyping(page);
  await noHorizontalScroll(page);
});

test("the theme toggle switches and is remembered across reloads", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await mockHealth(page);
  await page.goto("/?fake=1");
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("button", { name: "Switch to light theme" })).toBeVisible();
});
