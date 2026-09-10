import { expect, test } from "@playwright/test";

test("judge can verify, configure, approve, and inspect the live twin", async ({ page }) => {
  await page.goto("/live/devices");
  await page.getByRole("button", { name: "Discover" }).click();
  await page.getByRole("button", { name: "Verify & connect" }).click();
  await expect(page.getByText("Discovered raw channels")).toBeVisible();
  await expect(page.getByText("STREAMING", { exact: true }).first()).toBeVisible();

  await page.getByRole("link", { name: "Agents", exact: true }).click();
  await page.getByRole("button", { name: "Run specialist team" }).click();
  await expect(page.getByRole("button", { name: "Approve immutable revision" })).toBeVisible();
  await page.getByRole("button", { name: "Approve immutable revision" }).click();
  await expect(page.getByText("Configuration approved and published")).toBeVisible();

  await page.getByRole("link", { name: "Twin", exact: true }).click();
  await expect(page.getByText("Live operational state")).toBeVisible();
  await expect(page.getByText("Evidence twin")).toBeVisible();
});
