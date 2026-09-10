import { expect, test } from "@playwright/test";

test("CAD views share asset edits and keep proposal activation explicit", async ({ page }) => {
  await page.goto("/workbench");
  await expect(page.getByText("Engineering workspace", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Draft change", exact: true }).click();
  await page.getByLabel("Requested engineering change").fill("Rename M-101 to Cooling pump motor");
  await page.getByRole("button", { name: "Generate draft", exact: true }).click();
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add M-101 Process motor", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByRole("button", { name: "Add M-101 Cooling pump motor", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Add M-101 Cooling pump motor", exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Engineering views" }).getByRole("button", { name: /Electrical/ }).click();
  await expect(page.getByRole("region", { name: "Electrical canvas" })).toBeVisible();
  await expect(page.getByText("Cooling pump motor", { exact: true }).first()).toBeVisible();
  await page.getByRole("navigation", { name: "Engineering views" }).getByRole("button", { name: /Operations/ }).click();
  await expect(page.getByRole("region", { name: "Operations canvas" })).toBeVisible();
  await expect(page.getByText("SIMULATED · GOOD").first()).toBeVisible();
});
