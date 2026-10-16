import { test, expect, type Page } from "@playwright/test";
import { XAM_TEMPLATE, xruleTemplate } from "../../src/services/exams/templates";

test.use({ viewport: { width: 1280, height: 800 } });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "localdox:prefs",
      JSON.stringify({ name: "Reader", namePrompted: true, aiEnabled: false }),
    ),
  );
});
const file = (name: string, content: string) => ({
  name,
  mimeType: "application/octet-stream",
  buffer: Buffer.from(content),
});
const upload = (page: Page, files: ReturnType<typeof file>[]) =>
  page.locator('input[type="file"]').first().setInputFiles(files);
const sidebar = (page: Page) => page.getByRole("complementary").first();
async function configure(page: Page, name = "paper") {
  const row = sidebar(page)
    .locator("[data-sidebar-file]")
    .filter({ has: page.getByRole("button", { name, exact: true }) });
  await row.getByRole("button", { name: "Options", exact: true }).click();
  await page.getByRole("button", { name: "Configure", exact: true }).click();
  return page.getByRole("dialog", { name: "Configure exam", exact: true });
}

async function showDetails(page: Page) {
  const details = page
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: "Exam details & rules" }) });
  await expect(details).toBeVisible();
  if (!(await details.evaluate((node) => (node as HTMLDetailsElement).open)))
    await details.locator("summary").click();
}

test("Configure changes a paper's rules and creates private settings without changing shared rules", async ({
  page,
}) => {
  await page.goto("/");
  await upload(page, [
    file("paper.xam", XAM_TEMPLATE),
    file("shared.xrule", xruleTemplate("Shared rules")),
    file(
      "short.xrule",
      JSON.stringify({ xrule: 1, name: "Short mock", durationMinutes: 5, passPercentage: 40 }),
    ),
  ]);
  await sidebar(page).getByRole("button", { name: "paper", exact: true }).click();
  let dialog = await configure(page);
  await dialog.getByRole("combobox", { name: "Exam ruleset" }).click();
  await page.getByRole("option", { name: "Short mock (short.xrule)", exact: true }).click();
  await dialog.getByRole("button", { name: "Save configuration" }).click();
  await showDetails(page);
  await expect(page.getByText("40% to pass", { exact: true })).toBeVisible();
  await showDetails(page);
  await expect(page.getByRole("button", { name: "short.xrule", exact: true })).toBeVisible();
  dialog = await configure(page);
  await dialog.getByRole("combobox", { name: "Exam ruleset" }).click();
  await page.getByRole("option", { name: "Shared rules (shared.xrule)", exact: true }).click();
  await dialog.getByLabel("Time limit (minutes)").fill("12");
  await dialog.getByLabel("Passing score (%)").fill("75");
  await dialog.getByLabel("Maximum attempts").fill("5");
  await dialog.getByRole("button", { name: "Save configuration" }).click();
  await showDetails(page);
  await expect(page.getByRole("button", { name: "paper.xrule", exact: true })).toBeVisible();
  await showDetails(page);
  await expect(page.getByText("75% to pass", { exact: true })).toBeVisible();
  await expect(page.getByText("5 attempts left", { exact: true })).toBeVisible();
  await page.reload();
  await showDetails(page);
  await expect(page.getByText("75% to pass", { exact: true })).toBeVisible();
  dialog = await configure(page);
  await expect(dialog.getByLabel("Time limit (minutes)")).toHaveValue("12");
  await dialog.getByRole("combobox", { name: "Exam ruleset" }).click();
  await page.getByRole("option", { name: "Shared rules (shared.xrule)", exact: true }).click();
  await expect(dialog.getByLabel("Time limit (minutes)")).toHaveValue("30");
  await expect(dialog.getByLabel("Passing score (%)")).toHaveValue("70");
  await dialog.getByRole("button", { name: "Save & edit ruleset" }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings.getByRole("heading", { name: "Exam rules", exact: true })).toBeVisible();
  await expect(settings.getByRole("textbox", { name: "Name", exact: true })).toHaveValue(
    "Shared rules",
  );
});

test("Configure cancels cleanly and GATE style works on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await upload(page, [file("paper.xam", XAM_TEMPLATE)]);
  await expect(page.getByRole("button", { name: "Start exam", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  let dialog = await configure(page);
  await dialog.getByLabel("Time limit (minutes)").fill("10");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  dialog = await configure(page);
  await expect(dialog.getByLabel("Time limit (minutes)")).toHaveValue("30");
  await dialog.getByRole("combobox", { name: "Exam ruleset" }).click();
  await expect(
    page.getByRole("option", { name: "Automatic · folder rules or defaults" }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await page.screenshot({ path: "test-results/exam-configure-mobile.png" });
  await dialog.getByRole("button", { name: "Use GATE style", exact: true }).click();
  // Close the sidebar after configuring its file.
  await page
    .getByRole("dialog", { name: "Workspace navigation" })
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await showDetails(page);
  await expect(page.getByText("25% to pass", { exact: true })).toBeVisible();
});

test("the sidebar New submenu creates files inside the clicked folder and rules in Settings", async ({
  page,
}) => {
  await page.goto("/");
  await upload(page, [file("notes.md", "# Notes\n")]);
  const nav = sidebar(page).getByRole("navigation");
  await nav.click({ button: "right" });
  await page.getByRole("menuitem", { name: "New", exact: true }).hover();
  for (const name of ["File", "Folder", "Board", "Exam", "Ruleset"])
    await expect(page.getByRole("menuitem", { name, exact: true })).toBeVisible();
  page.once("dialog", (dialog) => void dialog.accept("Study"));
  await page.getByRole("menuitem", { name: "Folder", exact: true }).click();
  const folder = sidebar(page)
    .locator("[data-sidebar-folder]")
    .filter({ has: page.getByText("Study", { exact: true }) });
  await folder.click({ button: "right" });
  await page.getByRole("menuitem", { name: "New", exact: true }).hover();
  await page.getByRole("menuitem", { name: "Exam", exact: true }).click();
  const exam = page.getByRole("dialog", { name: "New exam" });
  await exam.getByLabel("Exam name").fill("Folder mock");
  await exam.getByRole("button", { name: "Create exam" }).click();
  await page.getByRole("button", { name: "Done · Save" }).click();
  await folder.getByRole("button", { name: /^Study/ }).click();
  await expect(
    folder.locator("..").getByRole("button", { name: "Folder mock", exact: true }),
  ).toBeVisible();
  await nav.click({ button: "right" });
  await page.getByRole("menuitem", { name: "New", exact: true }).hover();
  page.once("dialog", (dialog) => void dialog.accept("Folder rules"));
  await page.getByRole("menuitem", { name: "Ruleset", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings.getByRole("heading", { name: "Exam rules", exact: true })).toBeVisible();
  await expect(settings.getByRole("textbox", { name: "Name", exact: true })).toHaveValue(
    "Folder rules",
  );
});

test("uploading a ruleset explains its location and opens its editor", async ({ page }) => {
  await page.goto("/");
  await upload(page, [file("uploaded.xrule", xruleTemplate("Uploaded rules"))]);
  await expect(
    page.getByText("Rulesets are available in Settings → Exam rules.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open exam rules", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings.getByRole("heading", { name: "Exam rules", exact: true })).toBeVisible();
  await expect(settings.getByRole("textbox", { name: "Name", exact: true })).toHaveValue(
    "Uploaded rules",
  );
});
