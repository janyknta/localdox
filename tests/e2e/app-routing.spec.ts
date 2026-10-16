import { test, expect, type Page } from "@playwright/test";
import { XAM_TEMPLATE, XP_TEMPLATE, xruleTemplate } from "../../src/services/exams/templates";

test.use({ viewport: { width: 1280, height: 850 } });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem("localdox:prefs"))
      localStorage.setItem(
        "localdox:prefs",
        JSON.stringify({ name: "Reader", namePrompted: true, theme: "light" }),
      );
  });
});
const file = (name: string, content: string) => ({
  name,
  mimeType: "text/plain",
  buffer: Buffer.from(content),
});
const sidebar = (page: Page) => page.getByRole("complementary").first();
const settings = (page: Page) => page.getByRole("dialog", { name: "Settings", exact: true });
async function seed(page: Page) {
  await page.goto("/");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles([
      file("notes.md", "# Notes\nUseful notes."),
      file("paper.xam", XAM_TEMPLATE),
      file("drill.xp", XP_TEMPLATE),
      file("Quiz.xrule", xruleTemplate("Quiz")),
    ]);
  await sidebar(page).getByRole("button", { name: "notes", exact: true }).click();
}

test("file URLs survive refresh and both navigation controls share browser history", async ({
  page,
}) => {
  await seed(page);
  const notesUrl = page.url();
  await expect(page).toHaveURL(/\/workspaces\/[^/]+\/files\/[^/#]+/);
  await sidebar(page).getByRole("button", { name: "paper", exact: true }).click();
  await expect(page.getByRole("button", { name: "Start exam", exact: true })).toBeVisible();
  const paperUrl = page.url();
  expect(paperUrl).not.toBe(notesUrl);
  await sidebar(page).getByRole("button", { name: "drill", exact: true }).click();
  const drillUrl = page.url();
  await page.goBack();
  await expect(page).toHaveURL(paperUrl);
  await expect(page.getByRole("button", { name: "Start exam", exact: true })).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(drillUrl);
  await expect(page.getByRole("listitem", { name: "Question Q1", exact: true })).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(drillUrl);
  await expect(page.getByRole("listitem", { name: "Question Q1", exact: true })).toBeVisible();
  await sidebar(page).getByRole("button", { name: "Back", exact: true }).click();
  await expect(page).toHaveURL(paperUrl);
  await page.reload();
  await sidebar(page).getByRole("button", { name: "Forward", exact: true }).click();
  await expect(page).toHaveURL(drillUrl);
});

test("entry screens disclose secondary controls and settings deep links restore the editor", async ({
  page,
}) => {
  await seed(page);
  await sidebar(page).getByRole("button", { name: "paper", exact: true }).click();
  await expect(page.getByRole("button", { name: "Start exam", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Use GATE style", exact: true })).toBeHidden();
  await page.getByText("Exam details & rules", { exact: true }).click();
  await page.getByRole("button", { name: "Quiz.xrule", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/exams\/[^/]+$/);
  await expect(settings(page).getByRole("textbox", { name: "Name", exact: true })).toHaveValue(
    "Quiz",
  );
  await expect(settings(page).getByRole("button", { name: "Save", exact: true })).toHaveCount(1);
  await page.reload();
  await expect(settings(page).getByRole("textbox", { name: "Name", exact: true })).toHaveValue(
    "Quiz",
  );
  await page.screenshot({ path: "test-results/rules-focused-desktop.png" });
  await settings(page).getByRole("tab", { name: "Reading", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/reading$/);
  await page.goBack();
  await expect(settings(page).getByRole("textbox", { name: "Name", exact: true })).toHaveValue(
    "Quiz",
  );
  await settings(page).getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("button", { name: "Start exam", exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/exam-entry-clean.png" });
  await sidebar(page).getByRole("button", { name: "drill", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Practice rules", exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Practice settings", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Practice rules", exact: true })).toBeVisible();
  await settings(page).getByRole("button", { name: "Done", exact: true }).click();
  await page.screenshot({ path: "test-results/practice-entry-clean.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings/exams");
  await settings(page).getByRole("button", { name: "Edit Quiz", exact: true }).click();
  await expect(settings(page).getByRole("textbox", { name: "Name", exact: true })).toHaveValue(
    "Quiz",
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/rules-focused-mobile.png" });
});

test("missing file links offer recovery", async ({ page }) => {
  await seed(page);
  const url = page.url().replace(/\/files\/[^/#]+.*/, "/files/missing");
  await page.goto(url);
  await expect(
    page.getByRole("alert").filter({ hasText: "This file is not available" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open current workspace" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "This file is not available" }),
  ).toHaveCount(0);
  await expect(page.getByText("Useful notes.", { exact: true })).toBeVisible();
});

test("a deep link switches workspaces and protects an unsaved rules draft", async ({ page }) => {
  await seed(page);
  const firstUrl = page.url();
  await page
    .getByRole("button", { name: /^Settings/ })
    .last()
    .click();
  await settings(page).getByRole("tab", { name: "Workspace", exact: true }).click();
  await settings(page).getByRole("button", { name: "New", exact: true }).click();
  await settings(page).getByLabel("New workspace name").fill("Second space");
  await settings(page).getByRole("button", { name: "Save", exact: true }).click();
  await settings(page).getByRole("button", { name: "Done", exact: true }).click();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(file("second.md", "# Second\nSecond workspace content."));
  await expect(page.getByText("Second workspace content.", { exact: true })).toBeVisible();
  await page.goto(firstUrl);
  await expect(page).toHaveURL(firstUrl);
  await expect(page.getByText("Useful notes.", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: /^Settings/ })
    .last()
    .click();
  await settings(page).getByRole("tab", { name: "Exam rules", exact: true }).click();
  await settings(page).getByRole("button", { name: "Edit Quiz", exact: true }).click();
  await settings(page).getByRole("textbox", { name: "Name", exact: true }).fill("Unsaved rules");
  const editorUrl = page.url();
  page.once("dialog", (dialog) => void dialog.dismiss());
  await settings(page).getByRole("tab", { name: "Reading", exact: true }).click();
  await expect(page).toHaveURL(editorUrl);
  await expect(settings(page).getByRole("textbox", { name: "Name", exact: true })).toHaveValue(
    "Unsaved rules",
  );
  await settings(page).getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    settings(page).getByRole("button", { name: "Edit Quiz", exact: true }),
  ).toBeVisible();
});
