import { expect, test } from "@playwright/test";
import { mockHealth } from "./helpers.js";

test("Check microphone → the meter moves → We can hear you → Start enabled", async ({ page }) => {
  await mockHealth(page);
  await page.goto("/?fake=1");
  await page.getByRole("button", { name: "Check microphone" }).click();
  const start = page.getByRole("button", { name: "Start presentation" });
  await expect(start).toBeDisabled();
  const meter = page.getByTestId("mic-meter");
  await expect
    .poll(async () => Number(await meter.getAttribute("aria-valuenow")), { timeout: 10_000 })
    .toBeGreaterThan(0);
  await expect(page.getByText("We can hear you")).toBeVisible({ timeout: 10_000 });
  await expect(start).toBeEnabled();
  await expect(
    page.getByText("Using speakers? Headphones give the best interruption experience."),
  ).toBeVisible();
});

test("Continue by typing from the mic check goes to the text-mode start", async ({ page }) => {
  await mockHealth(page);
  await page.goto("/?fake=1");
  await page.getByRole("button", { name: "Check microphone" }).click();
  await page.getByRole("button", { name: "Continue by typing" }).click();
  await expect(page.getByRole("heading", { name: "Ready when you are" })).toBeVisible();
});
