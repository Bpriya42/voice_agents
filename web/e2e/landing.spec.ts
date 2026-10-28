import { expect, test } from "@playwright/test";
import { mockHealth } from "./helpers.js";

test("the landing explains itself: hint, chips, privacy line and both ways in", async ({
  page,
}) => {
  await mockHealth(page);
  await page.goto("/");
  await expect(page.getByText("Interrupt anytime — hold Space to talk.")).toBeVisible();
  await expect(page.getByText("A 3-minute spoken talk on how GLP-1 medicines work.")).toBeVisible();
  for (const q of [
    "What are the side effects?",
    "How much weight do people lose?",
    "Is there a pill version?",
  ]) {
    await expect(page.getByText(q)).toBeVisible();
  }
  await expect(
    page.getByText("Nothing you say is stored by this demo.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Check microphone" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue without mic (type instead)" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("an unconfigured server shows the README banner", async ({ page }) => {
  await mockHealth(page, {
    configured: false,
    keyValid: null,
    limits: { sessionMaxMinutes: null, busy: false, paused: false },
    public: {},
  });
  await page.goto("/");
  await expect(page.getByRole("alert")).toHaveText("Server isn't configured — see README.");
});

test("the real e2e server (no key) reports not configured", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("alert")).toHaveText("Server isn't configured — see README.");
});

test("hosted busy and paused messages show before Start, with the repo link", async ({ page }) => {
  await mockHealth(page, {
    configured: true,
    keyValid: true,
    limits: { sessionMaxMinutes: 10, busy: false, paused: true },
    public: { repoUrl: "https://example.com/repo" },
  });
  await page.goto("/");
  await expect(page.getByText("The hosted demo is paused for this month.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Run it locally from the repo." })).toHaveAttribute(
    "href",
    "https://example.com/repo",
  );
});
