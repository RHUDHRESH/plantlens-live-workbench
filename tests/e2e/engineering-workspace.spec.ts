import { expect, test } from "@playwright/test";

test.describe("engineering workspace", () => {
  test("keeps context reachable on short screens and rejects unsupported files", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const errors: string[] = [];
    page.on("console", entry => { if (entry.type() === "error") errors.push(entry.text()); });
    await page.goto("/workbench");
    const files = page.getByRole("button", { name: /Context files/ });
    await expect(files).toBeInViewport();
    const splitter = page.getByRole("separator", { name: "Resize project panel" });
    await splitter.focus();
    const before = await splitter.getAttribute("aria-valuenow");
    await page.keyboard.press("ArrowRight");
    await expect(splitter).not.toHaveAttribute("aria-valuenow", before!);
    await files.click();
    await page.locator('input[type="file"]').setInputFiles({ name: "manual.pdf", mimeType: "application/pdf", buffer: Buffer.from("not an extracted PDF") });
    await expect(page.getByRole("status")).toContainText("PDF/image extraction is not available");
    expect(errors.filter(error => /hydrat|didn't match/i.test(error))).toEqual([]);
  });

  test("separates DAG cycle rejection from signed feedback and restores analysis", async ({ page }) => {
    await page.goto("/analysis");
    await page.getByLabel("From asset", { exact: true }).selectOption("M-101");
    await page.getByLabel("To asset", { exact: true }).selectOption("VFD-101");
    await page.getByLabel("Relationship label", { exact: true }).fill("Motor dependency");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByLabel("From asset", { exact: true }).selectOption("VFD-101");
    await page.getByLabel("To asset", { exact: true }).selectOption("M-101");
    await page.getByLabel("Relationship label", { exact: true }).fill("Feedback hypothesis");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText(/This edge would create a cycle/)).toBeVisible();
    await page.getByLabel("Relationship type", { exact: true }).selectOption("LOOP");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByRole("button", { name: "Save locally", exact: true }).click();
    await expect(page.getByText("Saved on this device", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText("Feedback hypothesis", { exact: true })).toBeVisible();
    await expect(page.getByRole("img", { name: "Loops directed relationship overview" })).toBeVisible();
    await expect(page.getByText("HEALTHY", { exact: true })).toHaveCount(0);
  });

  test("moves a placed asset and restores the saved browser workspace", async ({ page }) => {
    await page.goto("/workbench");
    const node = page.getByLabel("PT-101 Discharge pressure", { exact: true });
    await expect(node).toBeVisible();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible();
    const initial = await page.evaluate(() => JSON.parse(localStorage.getItem("plantlens.cad.workspace.v1") || "null"));
    await node.dragTo(page.locator('[aria-label="Signal wiring canvas"]'), { targetPosition: { x: 520, y: 260 } });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("plantlens.cad.workspace.v1") || "null"));
    const initialPlacement = initial?.placements.find((placement: { assetId: string; view: string }) => placement.assetId === "PT-101" && placement.view === "signal");
    const savedPlacement = saved.placements.find((placement: { assetId: string; view: string }) => placement.assetId === "PT-101" && placement.view === "signal");
    expect(savedPlacement).toBeTruthy();
    expect(savedPlacement.x !== initialPlacement?.x || savedPlacement.y !== initialPlacement?.y).toBe(true);
    await page.reload();
    await expect(page.getByLabel("PT-101 Discharge pressure", { exact: true })).toBeVisible();
    await expect(page.getByText("Workspace restored", { exact: true })).toBeVisible();
  });

  test("reviews one CAD proposal explicitly and leaves activation human-controlled", async ({ page }) => {
    await page.goto("/workbench");
    await page.getByRole("button", { name: "Draft change", exact: true }).click();
    await page.getByLabel("Requested engineering change").fill("Rename M-101 to Review motor");
    await page.getByRole("button", { name: "Generate draft", exact: true }).click();
    await expect(page.getByText("Rename M-101 from", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeVisible();
    await expect(page.getByLabel("M-101 Review motor", { exact: true })).not.toBeVisible();
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(page.getByRole("button", { name: "Add M-101 Review motor", exact: true })).toBeVisible();
    await expect(page.getByText("COMPLETED", { exact: true })).toBeVisible();
  });

  test("indexes uploaded text locally and retrieves the same excerpt after reload", async ({ page }) => {
    await page.goto("/workbench");
    await page.getByRole("button", { name: /Context files/ }).click();
    await page.locator('input[type="file"]').setInputFiles({
      name: "motor-notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("M-101 motor current register is 42 A. Verify against the approved drive manual."),
    });
    await expect(page.getByText("motor-notes.txt", { exact: true })).toBeVisible();
    await expect(page.getByText("indexed locally", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Local retrieval", exact: true }).click();
    await page.getByLabel("Search local context").fill("42 A");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.getByText("M-101 motor current register is 42 A.", { exact: false })).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "Local retrieval", exact: true }).click();
    await page.getByLabel("Search local context").fill("42 A");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.getByText("M-101 motor current register is 42 A.", { exact: false })).toBeVisible();
  });

  test("requires per-query web consent and clearly blocks web research in the browser", async ({ page }) => {
    await page.goto("/workbench");
    await page.getByRole("button", { name: "Web research", exact: true }).click();
    const query = page.getByLabel("Web research query");
    const search = page.getByRole("button", { name: "Search web", exact: true });
    await query.fill("ACME VFD-101 manual");
    await expect(search).toBeDisabled();
    await page.getByRole("checkbox").check();
    await expect(search).toBeEnabled();
    await search.click();
    await expect(page.getByText("Web research is a desktop-only tool in this preview.", { exact: true })).toBeVisible();
    await expect(page.getByText("Local retrieval needs no API key.", { exact: false })).toBeVisible();
    await query.fill("A different model");
    await expect(search).toBeDisabled();
  });
});
