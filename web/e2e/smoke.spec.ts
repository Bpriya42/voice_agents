import { expect, test } from "@playwright/test";

test("the page loads and shows Ava", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Ava" })).toBeVisible();
});

test("the API proxy reaches the server", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBe(true);
  // playwright.config.ts blanks OPENAI_API_KEY, so e2e runs unconfigured and makes no network calls.
  expect(await res.json()).toMatchObject({ configured: false, keyValid: null });
});
