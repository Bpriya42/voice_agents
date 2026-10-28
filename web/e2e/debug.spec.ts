import { expect, test } from "@playwright/test";
import { mockHealth, startTyping } from "./helpers.js";

test("no overlay without ?debug=1", async ({ page }) => {
  await startTyping(page);
  await expect(page.getByTestId("debug-overlay")).toHaveCount(0);
});

test("?debug=1 shows measured greeting, typed latency and slide sync, and copies JSON", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await mockHealth(page);
  await page.goto("/?fake=1&debug=1");
  await page.getByRole("button", { name: "Continue without mic (type instead)" }).click();
  await page.getByRole("button", { name: "Start presentation" }).click();
  const overlay = page.getByTestId("debug-overlay");
  await expect(overlay).toBeVisible();
  const row = (name: string) => overlay.getByRole("row", { name: new RegExp(`^${name}`) });
  // Greeting speech from the fake adapter produces the first measurement.
  await expect(row("greeting").getByRole("cell").nth(3)).toHaveText("1", { timeout: 10_000 });

  await page.getByRole("textbox", { name: "Your question" }).fill("What are the side effects?");
  await page.keyboard.press("Enter");
  await expect(row("typedLatency").getByRole("cell").nth(3)).toHaveText("1", { timeout: 10_000 });
  await expect(row("toolRoundTrip").getByRole("cell").nth(3)).toHaveText("1", { timeout: 10_000 });
  await expect(row("slideSync").getByRole("cell").nth(3)).toHaveText("1", { timeout: 10_000 });

  await overlay.getByRole("button", { name: "Copy as JSON" }).click();
  const copied = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
  expect(copied.metrics.greeting.n).toBeGreaterThanOrEqual(1);
  expect(Object.keys(copied)).toEqual(["metrics", "staleEvents", "conversationTokens", "epoch"]);
});
