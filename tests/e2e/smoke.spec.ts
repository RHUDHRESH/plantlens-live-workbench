import { expect, test } from "@playwright/test";

test("loads the simulated plant and retains the shell across primary routes", async ({ page }) => {
  await page.goto("/plant");
  await expect(page.getByRole("heading", { name: "Plant", exact: true })).toBeVisible();
  await expect(page.getByText("SIMULATION", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("CNC-01", { exact: true }).first()).toBeVisible();
  await page.getByRole("link", { name: "Knowledge", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Knowledge sources" })).toBeVisible();
  await page.getByRole("link", { name: "Incidents", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Incidents", exact: true })).toBeVisible();
});

test("judge explainer, deep links, and sample pack work", async ({ page }) => {
  await page.goto("/explain");
  await expect(page.getByRole("heading", { name: /How does PlantLens decide/ })).toBeVisible();
  await page.goto("/plant/PUMP-01");
  await expect(page.getByRole("heading", { name: /PUMP-01/ })).toBeVisible();
  await page.goto("/knowledge/sources");
  await page.getByRole("button", { name: "Load sample factory pack" }).click();
  await expect(page.getByRole("button", { name: "asset_registry.csv", exact: true })).toBeVisible({ timeout: 20_000 });
});
