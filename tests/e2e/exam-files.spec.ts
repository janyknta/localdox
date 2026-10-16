import { test, expect, type Page } from "@playwright/test";
import { XAM_TEMPLATE } from "../../src/services/exams/templates";

test.use({ viewport: { width: 1280, height: 800 }, screenshot: "only-on-failure" });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "localdox:prefs",
      JSON.stringify({ name: "Reader", namePrompted: true, aiEnabled: false }),
    ),
  );
});

const file = (name: string, text: string, mimeType = "application/octet-stream") => ({
  name,
  mimeType,
  buffer: Buffer.from(text),
});
const square = file(
  "square.svg",
  '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#4f5bd5"/></svg>',
  "image/svg+xml",
);
const rules = (fields: object = {}) =>
  JSON.stringify({ xrule: 1, name: "Arithmetic mock", summary: "Addition facts", ...fields });
const question = (difficulty: string, body: string) =>
  `:::question{#q type=mcq marks=5 difficulty=${difficulty}}\n${body}\n\n- Correct answer\n- Wrong answer\n- Alternative\n- None\n:::\n\n:::solution{#q answer=A}\nExplanation.\n:::`;
const paper = (exam = question("easy", "Pick the square. ![A square](square.svg)")) => `# Exam

${exam}
`;

async function createWorkspace(page: Page, name = "Exam files") {
  await page.goto("/");
  await page.getByRole("button", { name: "Create or manage workspaces" }).click();
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByLabel("New workspace name").fill(name);
  await expect(page.getByLabel("Workspace kind")).toHaveCount(0);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Open", exact: true }).click();
}
const upload = (page: Page, files: ReturnType<typeof file>[]) =>
  page.locator('input[type="file"]').first().setInputFiles(files);
const sidebar = (page: Page) => page.getByRole("complementary").first();

test("the legacy exams URL uses the same workspace without creating a separate one", async ({
  page,
}) => {
  await page.goto("/exams");
  await upload(page, [file("paper.xam", XAM_TEMPLATE)]);
  await open(page, "paper");
  await expect(page.getByRole("button", { name: "Start exam", exact: true })).toBeVisible();
  const records = () =>
    page.evaluate(
      () =>
        new Promise<{ id: string; kind?: string }[]>((resolve, reject) => {
          const req = indexedDB.open("localdox");
          req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction("workspaces");
            const rows = tx.objectStore("workspaces").getAll();
            tx.oncomplete = () => {
              resolve(rows.result);
              db.close();
            };
            tx.onabort = () => {
              reject(tx.error);
              db.close();
            };
          };
          req.onerror = () => reject(req.error);
        }),
    );
  const initial = await records();
  expect(initial).toHaveLength(1);
  expect(initial[0]).not.toHaveProperty("kind");
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Start exam", exact: true })).toBeVisible();
  const reopened = await records();
  expect(reopened).toHaveLength(1);
  expect(reopened[0].id).toBe(initial[0].id);
  expect(reopened[0]).not.toHaveProperty("kind");
});
async function showDetails(page: Page) {
  const details = page
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: "Exam details & rules" }) });
  await expect(details).toBeVisible();
  if (!(await details.getAttribute("open"))) {
    if (!(await details.evaluate((node) => (node as HTMLDetailsElement).open)))
      await details.locator("summary").click();
  }
}

/** A paper and its rules share a name; the paper, uploaded first, comes first. */
async function open(page: Page, name: string) {
  await sidebar(page).getByRole("button", { name, exact: true }).first().click();
}
async function sitExam(page: Page, correct: boolean) {
  await page.getByRole("checkbox", { name: "I have read and acknowledge" }).check();
  await page.getByRole("button", { name: "Start exam", exact: true }).click();
  await page
    .getByRole("radio")
    .nth(correct ? 0 : 1)
    .check();
  await page.getByRole("button", { name: "Save & next", exact: true }).click();
  await page.getByRole("button", { name: "Submit exam", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Submit exam" }).click();
  await expect(page.getByRole("region", { name: "Result" })).toBeVisible();
}

test("a workspace runs a paper in place, with a ruleset it can make", async ({ page }) => {
  await createWorkspace(page);
  await upload(page, [file("paper.xam", paper()), square]);
  // The same reader chrome as any workspace, and nothing exam-specific beside it.
  for (const gone of ["Paper library", "Attempt history", "Import files", "All materials"])
    await expect(page.getByRole("button", { name: gone })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add to workspace" }).first()).toBeVisible();

  await open(page, "paper");
  await expect(page.getByRole("button", { name: "Start exam", exact: true })).toBeVisible();
  await showDetails(page);
  await page.getByRole("button", { name: "Default rules", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Settings" })
    .getByRole("button", { name: "Done", exact: true })
    .click();
  // The ruleset is named in the paper and kept in Settings, not the sidebar.
  await expect(sidebar(page).getByRole("button", { name: "paper", exact: true })).toHaveCount(1);
  await showDetails(page);
  await expect(page.getByText("70% to pass")).toBeVisible();
  await expect(page.getByRole("button", { name: "paper.xrule" })).toBeVisible();

  // The paper is its exam: no learn, practice or review steps before it, and
  // no key or solution anywhere until it is submitted.
  for (const gone of [/^Step \d/, /finished studying/])
    await expect(page.getByRole("button", { name: gone })).toHaveCount(0);
  await expect(page.getByText("Explanation.")).toHaveCount(0);
  await expect(page.getByText("1 question", { exact: true })).toBeVisible();
  await expect(page.getByText("3 attempts left")).toBeVisible();
  await page.screenshot({ path: "test-results/exam-files-paper.png" });

  // The exam covers the reader while it runs, with its image from the workspace.
  await page.getByRole("button", { name: "Start exam", exact: true }).click();
  const overlay = page.locator(".exam-overlay");
  await expect(overlay).toBeVisible();
  expect(await overlay.evaluate((node) => node.getBoundingClientRect().width)).toBe(1280);
  await page.screenshot({ path: "test-results/exam-files-instructions.png" });
  await page.getByRole("checkbox", { name: "I have read and acknowledge" }).check();
  await page.getByRole("button", { name: "Start exam", exact: true }).click();
  await expect
    .poll(() =>
      page
        .getByRole("img", { name: "A square" })
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBeGreaterThan(0);
  await expect(page.getByText("Explanation.")).toHaveCount(0);
  await page.getByRole("radio").first().check();
  await page.getByRole("button", { name: "Save & next", exact: true }).click();
  await page.getByRole("button", { name: "Submit exam", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Submit exam" }).click();
  // The result and its answers are one screen, in the reader: the timed part
  // is over, so the workspace's sidebar is back beside it.
  await expect(page.getByRole("heading", { name: /^Passed/ })).toBeVisible();
  await expect(overlay).toHaveCount(0);
  await expect(sidebar(page)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Answers & solutions" })).toBeVisible();
  await expect(page.getByText("Explanation.")).toBeVisible();
  await page.screenshot({ path: "test-results/exam-files-result.png", fullPage: true });
  await page.getByRole("button", { name: "Back to paper" }).first().click();

  // After submission the key is released, from the paper and its attempt.
  await expect(page.getByRole("status").filter({ hasText: /Passed · \d+%/ })).toBeVisible();
  await page.getByText(/^Attempt history \(/).click();
  await expect(page.locator("details[aria-label=Attempts]")).toContainText("Passed");
  await page.getByRole("button", { name: "Review answers", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Answers & solutions" })).toBeFocused();
  await expect(page.getByText("Explanation.")).toBeVisible();
  await page.screenshot({ path: "test-results/exam-files-review.png" });
  await page.getByRole("button", { name: "Back to paper" }).first().click();
  await page.reload();
  await expect(page.getByRole("status").filter({ hasText: /Passed · \d+%/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start exam", exact: true })).toHaveCount(0);
  await page.screenshot({ path: "test-results/exam-files-done.png" });
});

/** Edit a ruleset where rulesets live: Settings ▸ Exam rules. */
async function editRules(page: Page, title: string, text: string) {
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings.getByRole("heading", { name: "Exam rules" })).toBeVisible();
  const editor = settings.getByRole("textbox", { name: /^Edit .*\.xrule$/ });
  await expect(settings.getByRole("button", { name: "JSON", exact: true })).toBeVisible();
  await settings.getByRole("button", { name: "JSON", exact: true }).click();
  await editor.fill(text);
  await settings.getByRole("button", { name: "Save", exact: true }).click();
  await settings.getByRole("button", { name: "Done", exact: true }).click();
}

/** Edit the open document through its own editor, as a person would. */
async function editOpenFile(page: Page, label: string, text: string) {
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel(label).fill(text);
  await page.getByRole("button", { name: "Done · Save" }).click();
}

test("rules from a folder above apply to a paper; edits apply until the first attempt, then a new paper comes from the edited file", async ({
  page,
}) => {
  await createWorkspace(page);
  const noPractice = (exam: string) => `# Exam\n\n${exam}\n`;
  await upload(page, [
    file("mock.xam", noPractice(question("easy", "First question?"))),
    file("rules.xrule", rules({ durationMinutes: 5, passPercentage: 80, maxAttempts: 1 })),
  ]);
  await open(page, "mock");
  await showDetails(page);
  await expect(page.getByText("80% to pass")).toBeVisible();
  await expect(page.getByRole("button", { name: "rules.xrule" })).toBeVisible();

  // Before any attempt, saving the rules changes the exam. The paper's rules
  // link opens them, ready to edit, in Settings.
  await showDetails(page);
  await page.getByRole("button", { name: "rules.xrule" }).click();
  await editRules(
    page,
    "Arithmetic mock",
    rules({ durationMinutes: 5, passPercentage: 60, maxAttempts: 1 }),
  );
  await showDetails(page);
  await expect(page.getByText("60% to pass")).toBeVisible();

  // One attempt, failed: the paper is spent.
  await page.getByRole("button", { name: "Start exam", exact: true }).click();
  await sitExam(page, false);
  await page.getByRole("button", { name: "Back to paper" }).first().click();
  await expect(page.getByText(/No attempts left on this paper/)).toBeVisible();
  await page.getByText(/^Attempt history \(/).click();
  await expect(page.locator("details[aria-label=Attempts]")).toContainText("Not passed");
  // The unchanged paper is refused: a retake must be a new, harder paper.
  await page.getByRole("button", { name: "Use the edited paper" }).click();
  await expect(page.getByRole("alert")).toContainText("at least 50% hard");

  // After an attempt, edits don't rewrite history: the new questions wait
  // until they are taken as the next paper.
  await editOpenFile(page, "Edit exam questions", noPractice(question("hard", "A harder one?")));
  await expect(page.getByText(/Edited since your first attempt/)).toBeVisible();
  await page.getByRole("button", { name: "Use the edited paper" }).click();
  await expect(page.getByText("Paper 2", { exact: true })).toBeVisible();
  await expect(page.getByText(/Edited since your first attempt/)).toHaveCount(0);
  await page.getByRole("button", { name: "Start exam", exact: true }).click();
  await sitExam(page, true);
  await expect(page.getByRole("heading", { name: /^Passed/ })).toBeVisible();
});

test("a running exam resumes after reload, renders rich content steadily and submits itself at time", async ({
  page,
}) => {
  await page.clock.install();
  await createWorkspace(page);
  const chart = JSON.stringify({
    type: "bar",
    title: "Sold",
    data: [
      { day: "Mon", sold: 4 },
      { day: "Tue", sold: 7 },
    ],
    series: [{ key: "sold", name: "Items" }],
    xKey: "day",
  });
  const rich = [
    ":::question{#q type=mcq marks=1}",
    "If $x^2 = 4$ and $x > 0$, what is $x$?",
    "",
    "```mermaid",
    "flowchart LR",
    "  A --> B",
    "```",
    "",
    "```chart",
    chart,
    "```",
    "",
    "- 2",
    "- 4",
    ":::",
    "",
    ":::solution{#q answer=A}",
    "Two.",
    ":::",
  ].join("\n");
  await upload(page, [
    file("timed.xam", `# Exam\n\n${rich}\n`),
    file("timed.xrule", rules({ durationMinutes: 2 })),
  ]);
  await open(page, "timed");
  await page.getByRole("button", { name: "Start exam", exact: true }).click();
  await page.getByRole("checkbox", { name: "I have read and acknowledge" }).check();
  await page.getByRole("button", { name: "Start exam", exact: true }).click();
  await expect(page.getByRole("timer")).toBeVisible();
  await expect(page.locator(".exam-overlay .katex").first()).toBeVisible();
  await expect(page.getByRole("img", { name: "Sold" })).toBeVisible();
  // The exam clock re-renders twice a second; the drawn diagram must stay put.
  const diagram = await page.locator(".xr-body-md .ex-diagram svg").elementHandle();
  await page.clock.runFor(1600);
  expect(await diagram!.evaluate((node) => node.isConnected)).toBe(true);
  await page.getByRole("radio").first().check();
  await page.getByRole("button", { name: "Save & next", exact: true }).click();

  // Reloading reopens the paper, and the paper reopens its running exam.
  await page.reload();
  await expect(page.getByRole("timer")).toBeVisible();
  await expect(page.getByRole("radio").first()).toBeChecked();
  await page.screenshot({ path: "test-results/exam-files-runner.png" });

  await page.clock.fastForward("03:00");
  await expect(page.getByText("Submitted automatically when time ran out.")).toBeVisible();
  // The answer chosen before the reload is the one graded.
  await expect(page.getByRole("heading", { name: /^Passed/ })).toBeVisible();
  await expect(page.getByText("1.00 / 1 marks")).toBeVisible();
});

test("a workspace can start an uploaded exam and Settings checks its rules", async ({ page }) => {
  await page.goto("/");
  await upload(page, [
    file("paper.xam", `# Exam\n\n${question("easy", "What is first?")}\n`),
    file("rules.xrule", rules({ mcqPenalty: "third" })),
  ]);
  await open(page, "paper");
  await expect(page.getByText("Exam", { exact: true })).toBeVisible();
  // Keys and solutions remain sealed until submission in every workspace.
  await expect(page.getByText("A, correct:")).toHaveCount(0);
  await expect(page.getByText("Explanation.")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Start exam", exact: true })).toBeVisible();
  await expect(sidebar(page).getByRole("button", { name: "rules", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Settings" }).first().click();
  await page.getByRole("tab", { name: "Exam rules" }).click();
  const row = page.locator('[data-ruleset="rules.xrule"]');
  await expect(row).toContainText("Arithmetic mock");
  await expect(row).toContainText("−1/3 for a wrong MCQ");
  await page
    .getByRole("dialog", { name: "Settings" })
    .getByRole("button", { name: "Done", exact: true })
    .click();
  await page.getByRole("button", { name: "Start exam", exact: true }).click();
  await sitExam(page, true);
  await expect(page.getByText("Explanation.")).toBeVisible();
});

test("an uploaded paper starts without a rules file and offers a complete GATE session", async ({
  page,
}) => {
  await page.goto("/");
  await upload(page, [file("gate-mock.xam", XAM_TEMPLATE)]);
  await open(page, "gate-mock");
  await expect(page.getByRole("button", { name: "Start exam", exact: true })).toBeVisible();
  await showDetails(page);
  await page.getByRole("button", { name: "Use GATE style", exact: true }).click();
  await showDetails(page);
  await expect(page.getByRole("button", { name: "gate-mock.xrule", exact: true })).toBeVisible();
  await showDetails(page);
  await expect(page.getByText("25% to pass", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Start exam", exact: true }).click();
  await page.getByRole("checkbox", { name: "I have read and acknowledge" }).check();
  await page.getByRole("button", { name: "Start exam", exact: true }).click();
  await expect(page.getByRole("timer")).toBeVisible();
  await expect(
    page.getByRole("complementary", { name: "Question palette and exam actions" }),
  ).toBeVisible();
  await page.getByRole("radio").nth(1).check();
  await page.getByRole("button", { name: "Save & next", exact: true }).click();
  await page.getByRole("checkbox").nth(0).check();
  await page.getByRole("checkbox").nth(2).check();
  await page.getByRole("button", { name: "Mark for review & next", exact: true }).click();
  const keypad = page.getByRole("group", { name: "Numeric keypad" });
  await expect(page.getByLabel("Numeric answer")).toHaveAttribute("readonly", "");
  for (const name of ["0", "Decimal point", "2", "5"])
    await keypad.getByRole("button", { name, exact: true }).click();
  await page.getByRole("button", { name: "Save & next", exact: true }).click();
  await page.reload();
  await expect(page.getByLabel("Numeric answer")).toHaveValue("0.25");
  await expect(page.getByRole("timer")).toBeVisible();
  await page.getByRole("button", { name: "Calculator", exact: true }).click();
  await expect(page.getByRole("dialog", { name: /calculator/i })).toBeVisible();
  await page
    .getByRole("dialog", { name: /calculator/i })
    .getByRole("button", { name: /close/i })
    .click();
  await page.screenshot({ path: "test-results/uploaded-gate-session.png" });
  await page.getByRole("button", { name: "Submit exam", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Submit exam" }).click();
  await expect(page.getByRole("heading", { name: /^Passed/ })).toBeVisible();
  await expect(page.getByText("5.00 / 5 marks")).toBeVisible();
});

test("Settings deletes a paper's progress, but not while that paper is open", async ({
  context,
  page,
}) => {
  await createWorkspace(page);
  await upload(page, [file("mock.xam", paper()), file("mock.xrule", rules()), square]);
  await open(page, "mock");
  // Opening the paper builds its record in exam storage.
  await expect(page.getByRole("button", { name: "Start exam", exact: true })).toBeVisible();

  const settings = await context.newPage();
  settings.on("dialog", (dialog) => void dialog.accept());
  await settings.goto("/settings");
  await settings.getByRole("tab", { name: "Storage", exact: true }).click();
  const remove = settings.getByRole("button", { name: "Delete Arithmetic mock" });
  await remove.click();
  await expect(settings.getByRole("alert")).toContainText("An exam paper is open in another tab");

  await page.close();
  await expect
    .poll(() =>
      settings.evaluate(
        async () =>
          !(await navigator.locks.query()).held?.some((lock) =>
            lock.name.startsWith("localdox-exam-writer"),
          ),
      ),
    )
    .toBe(true);
  await remove.click();
  await expect(settings.getByText("No uploaded exam files.")).toBeVisible();

  // The files remain; opening the paper starts it afresh.
  await settings.goto("/");
  await open(settings, "mock");
  await expect(settings.getByRole("button", { name: "Start exam", exact: true })).toBeVisible();
});

test("on a phone, the paper and its exam fit the screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await createWorkspace(page);
  await upload(page, [file("paper.xam", paper()), file("paper.xrule", rules()), square]);
  await expect(page.getByRole("button", { name: "Start exam", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/exam-files-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Start exam", exact: true }).click();
  await page.getByRole("checkbox", { name: "I have read and acknowledge" }).check();
  await page.getByRole("button", { name: "Start exam", exact: true }).click();
  await expect
    .poll(() =>
      page
        .getByRole("img", { name: "A square" })
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/exam-files-mobile-exam.png" });
});

test("Create ▸ Exam makes a paper tagged with a chosen ruleset; rulesets are kept in Settings", async ({
  page,
}) => {
  await createWorkspace(page);
  await upload(page, [
    file("notes.md", "# Notes\n"),
    file("gate.xrule", rules({ name: "GATE mock", durationMinutes: 45, passPercentage: 60 })),
  ]);
  await expect(sidebar(page).getByRole("button", { name: "gate", exact: true })).toHaveCount(0);

  // Five peers: the general kinds on one row, the exam and practice pair below.
  await sidebar(page).getByRole("button", { name: "Add to workspace" }).click();
  const tiles = page.getByRole("group", { name: "Create" }).getByRole("button");
  await expect(tiles).toHaveText(["File", "Folder", "Board", "Exam", "Practice", "Ruleset"]);
  const boxes = await Promise.all((await tiles.all()).map((t) => t.boundingBox()));
  expect(boxes[0]!.y).toBe(boxes[1]!.y);
  expect(boxes[1]!.y).toBe(boxes[2]!.y);
  expect(boxes[3]!.y).toBe(boxes[4]!.y);
  expect(boxes[3]!.y).toBeGreaterThan(boxes[0]!.y);
  expect(boxes[0]!.x).toBe(boxes[3]!.x);
  await page.screenshot({ path: "test-results/exam-create-menu.png" });

  // The existing ruleset is offered first.
  await page.getByRole("button", { name: "New exam" }).click();
  const dialog = page.getByRole("dialog", { name: "New exam" });
  await expect(dialog.getByLabel("Ruleset")).toHaveText("GATE mock (gate.xrule)");
  await expect(dialog.getByRole("button", { name: "Create exam" })).toBeDisabled();
  await dialog.getByLabel("Exam name").fill("Mock 1");
  await page.screenshot({ path: "test-results/exam-new-dialog.png" });
  await dialog.getByLabel("Exam name").press("Enter");

  // The paper opens in its editor with the ruleset named in its header.
  const source = page.getByLabel("Edit exam questions");
  await expect(source).toHaveValue(/^---\nrules: gate\.xrule\n---\n/);
  await page.getByRole("button", { name: "Done · Save" }).click();
  await showDetails(page);
  await expect(page.getByText("60% to pass")).toBeVisible();
  await expect(page.getByRole("button", { name: "gate.xrule" })).toBeVisible();

  // A second exam with a new ruleset: made at once, and kept in Settings.
  await sidebar(page).getByRole("button", { name: "Add to workspace" }).click();
  await page.getByRole("button", { name: "New exam" }).click();
  await dialog.getByLabel("Exam name").fill("Quick quiz");
  await dialog.getByLabel("Ruleset").click();
  await page.getByRole("option", { name: "New ruleset (default rules)", exact: true }).click();
  await dialog.getByRole("button", { name: "Create exam" }).click();
  await expect(page.getByLabel("Edit exam questions")).toHaveValue(
    /^---\nrules: Quick quiz\.xrule\n/,
  );
  await page.getByRole("button", { name: "Done · Save" }).click();
  await showDetails(page);
  await expect(page.getByText("70% to pass")).toBeVisible();
  await expect(sidebar(page).getByRole("button", { name: "Quick quiz", exact: true })).toHaveCount(
    1,
  );

  await page.getByRole("button", { name: "Quick quiz.xrule" }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("button", { name: "← All rulesets", exact: true }).click();
  await expect(settings.locator('[data-ruleset="gate.xrule"]')).toContainText("Used by 1 exam");
  await expect(settings.locator('[data-ruleset="Quick quiz.xrule"]')).toContainText(
    "Used by 1 exam",
  );
  // A broken edit says what is wrong before it is saved.
  await settings.getByRole("button", { name: "Edit Quick quiz", exact: true }).click();
  await settings.getByRole("button", { name: "JSON", exact: true }).click();
  const editor = settings.getByRole("textbox", { name: "Edit Quick quiz.xrule" });
  await editor.fill(rules({ passMark: 50 }));
  await expect(settings.getByRole("alert")).toContainText("passMark");
  await page.screenshot({ path: "test-results/exam-rules-settings.png" });
  await settings.getByRole("button", { name: "Cancel", exact: true }).click();

  // Binning a ruleset in use asks first; its exam then asks for other rules.
  page.once("dialog", (d) => void d.accept());
  await settings.getByRole("button", { name: "Move Quick quiz to the Bin" }).click();
  await settings.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("heading", { name: "This paper's rules are missing" })).toBeVisible();
  await page.getByLabel("Ruleset").click();
  await page.getByRole("option", { name: "GATE mock (gate.xrule)", exact: true }).click();
  await page.getByRole("button", { name: "Use these rules" }).click();
  await showDetails(page);
  await expect(page.getByText("60% to pass")).toBeVisible();
});

test("a GATE mock from the Settings template runs by TCS iON rules: an answer counts only once saved", async ({
  page,
}) => {
  await createWorkspace(page);
  const gateQuestion = (id: string, section: string, body: string) =>
    `:::question{#${id} type=mcq marks=1 section=${section}}\n${body}\n\n- Right\n- Wrong\n- Other\n- None\n:::\n\n:::solution{#${id} answer=A}\nWhy ${id}.\n:::`;
  await upload(page, [
    file(
      "mock.xam",
      `---\nrules: GATE mock.xrule\n---\n\n${gateQuestion("ga1", "GA", "First?")}\n\n${gateQuestion("s1", "subject", "Second?")}\n\n${gateQuestion("s2", "subject", "Third?")}\n`,
    ),
  ]);

  // Settings ▸ Exam rules makes the GATE ruleset in one step.
  await page.getByRole("button", { name: "Settings" }).first().click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("tab", { name: "Exam rules" }).click();
  await settings.getByRole("button", { name: "start from GATE" }).click();
  await expect(settings.getByRole("radio", { name: "GATE" })).toBeChecked();
  await expect(settings.getByLabel("New ruleset name")).toHaveValue("GATE mock");
  await expect(
    settings.getByText(/65 questions, 3 hours, one-third negative marking/),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/exam-gate-template.png" });
  await settings.getByRole("button", { name: "Create", exact: true }).click();
  // The full pattern reads cleanly; a three-question mock lowers the count and time.
  await expect(settings.getByLabel("Duration (minutes)", { exact: true })).toHaveValue("180");
  await settings.getByRole("button", { name: "JSON", exact: true }).click();
  const editor = settings.getByRole("textbox", { name: "Edit GATE mock.xrule" });
  const text = await editor.inputValue();
  await editor.fill(
    text
      .replace('"questionCount": 65', '"questionCount": 3')
      .replace('"durationMinutes": 180', '"durationMinutes": 9'),
  );
  await settings.getByRole("button", { name: "Save", exact: true }).click();
  await settings.getByRole("button", { name: "Done", exact: true }).click();

  await open(page, "mock");
  await showDetails(page);
  await expect(page.getByText("Marking from exam structure")).toBeVisible();
  await page.getByRole("button", { name: "Start exam", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Answering a question" })).toBeVisible();
  await expect(page.getByText(/Choosing an answer doesn't save it/)).toBeVisible();
  await page.getByRole("checkbox", { name: "I have read and acknowledge" }).check();
  await page.getByRole("button", { name: "Start exam", exact: true }).click();

  // Choosing isn't saving: leaving from the palette drops the choice.
  await page.getByRole("radio", { name: /Right/ }).check();
  await expect(page.locator(".xr-notice-slot")).toContainText(
    "Not saved. Save & next keeps this answer",
  );
  const sections = page.getByRole("navigation", { name: "Sections" });
  await sections.getByRole("button", { name: "Subject" }).click();
  await sections.getByRole("button", { name: "General Aptitude" }).click();
  await expect(page.getByRole("radio", { name: /Right/ })).not.toBeChecked();
  await expect(page.getByRole("button", { name: "Question 1: not answered" })).toBeVisible();

  // Save & next keeps it. Clicking a chosen option again deselects it.
  await page.getByRole("radio", { name: /Right/ }).check();
  await page.getByRole("button", { name: "Save & next" }).click();
  await expect(page.getByRole("button", { name: "Question 2: not answered" })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await page.getByRole("radio", { name: /Wrong/ }).check();
  await page.getByRole("radio", { name: /Wrong/ }).click();
  await expect(page.getByRole("radio", { name: /Wrong/ })).not.toBeChecked();
  await page.getByRole("radio", { name: /Wrong/ }).check();
  await page.getByRole("button", { name: "Mark for review & next" }).click();

  // The question paper lists every question, read-only.
  await page.getByRole("button", { name: "Question paper" }).first().click();
  const paperDialog = page.getByRole("dialog", { name: "Question paper" });
  await expect(paperDialog.getByText("Third?")).toBeVisible();
  await paperDialog.getByRole("button", { name: "Back to the exam" }).click();

  // The last question still needs Save & next; an unsaved choice is called out at submit.
  await page.getByRole("radio", { name: /Right/ }).check();
  await page.getByRole("button", { name: "Submit exam", exact: true }).first().click();
  const submit = page.getByRole("dialog", { name: "Submit exam?" });
  await expect(submit.getByText(/isn't saved, so it won't be counted/)).toBeVisible();
  await expect(
    submit.getByRole("columnheader", { name: "Answered & marked (counted)" }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/exam-gate-submit.png" });
  await submit.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Save & next" }).click();
  await page.getByRole("button", { name: "Submit exam", exact: true }).first().click();
  await expect(submit.getByText(/isn't saved/)).toHaveCount(0);
  await submit.getByRole("button", { name: "Submit exam" }).click();

  // Q1 right (+1), Q2 wrong and marked but counted (−1/3), Q3 right (+1).
  await expect(page.getByText("1.67 / 3 marks")).toBeVisible();
  await expect(sidebar(page)).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Questions by outcome" })).toBeVisible();
  await expect(page.getByText("Why s1.")).toBeVisible();
  await page.screenshot({ path: "test-results/exam-gate-result.png", fullPage: true });
});

test("strict exams block navigation and clipboard, lock on fullscreen exit, and submit on the third incident", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/");
  await upload(page, [
    file("notes.md", "# Notes"),
    file("strict.xam", paper()),
    file("strict.xrule", rules({ durationMinutes: 2 })),
    square,
  ]);
  await open(page, "notes");
  await open(page, "strict");
  const examUrl = page.url();
  await page.getByRole("button", { name: "Start exam", exact: true }).click();
  await page.getByRole("checkbox", { name: "I have read and acknowledge" }).check();
  await page.getByRole("button", { name: "Start exam", exact: true }).click();
  await expect(page.getByRole("timer")).toBeVisible();
  expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await expect(page.getByRole("button", { name: "Pause timer", exact: true })).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      ["copy", "cut", "paste", "contextmenu"].map((type) => {
        const event = new Event(type, { bubbles: true, cancelable: true });
        document.dispatchEvent(event);
        return event.defaultPrevented;
      }),
    ),
  ).toEqual([true, true, true, true]);
  await page.evaluate(() => history.back());
  await expect(page.getByRole("alert")).toContainText("Submit the exam before leaving");
  await expect(page).toHaveURL(examUrl);
  await page.getByRole("radio").first().check();
  await page.getByRole("button", { name: "Save & next", exact: true }).click();
  await page.evaluate(() => document.exitFullscreen());
  await expect(page.getByRole("radio").first()).toBeDisabled();
  await expect(page.locator(".xr-notice-slot")).toContainText("Warning 1 of 2");
  await page.clock.runFor(10000);
  await expect(page.getByRole("timer")).toContainText("01:50");
  await page.getByRole("button", { name: "Return to fullscreen", exact: true }).click();
  await expect(page.getByRole("radio").first()).toBeEnabled();
  // Focus events are deterministic here; a window exit may also fire visibility/fullscreen events.
  await page.clock.runFor(1000);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(page.getByRole("radio").first()).toBeDisabled();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator(".xr-notice-slot")).toContainText("Warning 2 of 2");
  await page.clock.runFor(1000);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(page.getByText("Submitted automatically after integrity warnings.")).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Passed/ })).toBeVisible();
});
