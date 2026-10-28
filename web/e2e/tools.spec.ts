import { expect, test } from "@playwright/test";
import { startTyping, status } from "./helpers.js";

test("a cross-slide question jumps to the answer slide and returns (brief §12 check 4)", async ({
  page,
}) => {
  await startTyping(page);
  await page.getByRole("button", { name: "Next slide" }).click(); // to slide 2
  await expect(page.getByTestId("slide-title")).toHaveText("How the medicines work");
  await page.getByRole("textbox", { name: "Your question" }).fill("What are the side effects?");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("slide-title")).toHaveText("Side effects and safety");
  await expect(status(page)).toHaveText(/Speaking/);
  await expect(page.getByRole("button", { name: "Stay here" })).toBeVisible();
  await expect(page.getByTestId("slide-title")).toHaveText("How the medicines work", {
    timeout: 6000,
  });
});

test('"Go to the evidence slide" changes the slide (brief §12 check 5)', async ({ page }) => {
  await startTyping(page);
  await page.getByRole("textbox", { name: "Your question" }).fill("Go to the evidence slide");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("slide-title")).toHaveText("What the evidence shows");
  // An explicit request moves the checkpoint too: no Stay here, no return.
  await expect(page.getByRole("button", { name: "Stay here" })).toHaveCount(0);
  await page.waitForTimeout(2500);
  await expect(page.getByTestId("slide-title")).toHaveText("What the evidence shows");
});

test("Stay here keeps the answer slide (S)", async ({ page }) => {
  await startTyping(page);
  await page.getByRole("textbox", { name: "Your question" }).fill("What are the side effects?");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("slide-title")).toHaveText("Side effects and safety");
  await page.locator("body").click({ position: { x: 5, y: 5 } }); // leave the question box
  await page.keyboard.press("s");
  await expect(page.getByRole("button", { name: "Stay here" })).toHaveCount(0);
  await page.waitForTimeout(2500);
  await expect(page.getByTestId("slide-title")).toHaveText("Side effects and safety");
});

test("a chip sends its question", async ({ page }) => {
  await startTyping(page);
  await page.getByText("Example questions").click();
  await page.getByRole("button", { name: "What are the side effects?" }).click();
  await expect(page.getByTestId("slide-title")).toHaveText("Side effects and safety");
});
