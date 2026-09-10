import { expect, test } from "@playwright/test";

test("CAD views share asset edits and keep proposal activation explicit", async ({ page }) => {
  await page.goto("/workbench");
  await expect(page.getByText("PlantLens CAD", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Draft change", exact: true }).click();
  await page.getByPlaceholder("Rename M-101 to Main pump motor").fill("Rename M-101 to Cooling pump motor");
  await page.getByRole("button", { name: "Draft", exact: true }).click();
  await expect(page.getByRole("button", { name: "Approve item", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "M-101 Process motor", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Approve item", exact: true }).click();
  await expect(page.getByRole("button", { name: "M-101 Cooling pump motor", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "M-101 Cooling pump motor", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Electrical schematic Illustrative template", exact: true }).click();
  await expect(page.getByRole("region", { name: "Electrical schematic canvas" })).toBeVisible();
  await expect(page.getByText("Cooling pump motor", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Presentation twin Operational overview", exact: true }).click();
  await expect(page.getByRole("region", { name: "Presentation twin canvas" })).toBeVisible();
  await expect(page.getByText("SIMULATED · GOOD").first()).toBeVisible();
});
