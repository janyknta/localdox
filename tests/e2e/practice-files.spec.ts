import { test, expect, type Page } from "@playwright/test";

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
const DRILL = `# Parity

:::question{#even type=mcq}
Which number is even?

- 7
- 12
:::

:::solution{#even answer=B}
Twelve is divisible by two.
:::

:::question{#primes type=msq}
Select every prime.

- 2
- 4
- 5
:::

:::solution{#primes answer="A,C"}
Two and five.
:::

# Fractions

:::question{#third type=nat}
Write $7/3$ to two places.
:::

:::solution{#third answer=2.32:2.34}
Seven thirds.
:::
`;
const upload = (page: Page, files: ReturnType<typeof file>[]) =>
  page.locator('input[type="file"]').first().setInputFiles(files);
const sidebar = (page: Page) => page.getByRole("complementary").first();
const question = (page: Page, n: number) => page.getByRole("listitem", { name: `Question Q${n}` });
const progress = (page: Page) => page.getByRole("progressbar", { name: "Practice answered" });
async function showPracticeSettings(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  if (!(await dialog.isVisible()))
    await page.getByRole("button", { name: "Practice settings", exact: true }).click();
  else await dialog.getByRole("tab", { name: "Practice", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "Practice", exact: true })).toBeVisible();
  return dialog;
}
async function closePracticeSettings(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

test("an .xp reveals one question and answer at a time and remembers progress", async ({
  page,
}) => {
  await page.goto("/");
  await upload(page, [file("drill.xp", DRILL)]);
  await sidebar(page).getByRole("button", { name: "drill", exact: true }).click();
  await expect(page.getByText("Practice", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Parity" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Fractions" })).toHaveCount(0);
  await expect(question(page, 2)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Next question", exact: true })).toBeEnabled();
  await expect(progress(page)).toHaveAttribute("aria-valuetext", "0 of 3 answered");
  // Nothing is revealed before an answer.
  for (const hidden of ["Twelve is divisible by two.", "Two and five.", "Seven thirds."])
    await expect(page.getByText(hidden)).toHaveCount(0);
  await page.screenshot({ path: "test-results/practice-unanswered.png" });

  // MCQ: choosing is answering. A wrong choice shows the key and why.
  const first = question(page, 1);
  await first.getByRole("button", { name: /^A: / }).click();
  await expect(first.getByRole("status")).toHaveText("Not quite");
  await expect(first.getByText("Twelve is divisible by two.")).toBeVisible();
  await expect(first.getByRole("button", { name: /^B, correct/ })).toBeVisible();
  await expect(first.getByRole("button", { name: /^A, your answer/ })).toBeVisible();
  // Answered is final: the options are inert, and even a forced click changes nothing.
  const key = first.getByRole("button", { name: /^B, correct/ });
  await expect(key).toHaveAttribute("aria-disabled", "true");
  await key.click({ force: true });
  await expect(first.getByRole("status")).toHaveText("Not quite");
  await expect(progress(page)).toHaveAttribute("aria-valuetext", "1 of 3 answered");
  // The other questions still hide their solutions.
  await expect(page.getByText("Two and five.")).toHaveCount(0);

  await page.getByRole("button", { name: "Next question", exact: true }).click();
  await expect(question(page, 1)).toHaveCount(0);
  // MSQ: pick several, then check.
  const second = question(page, 2);
  await second.getByRole("button", { name: /^A: / }).click();
  await second.getByRole("button", { name: /^C: / }).click();
  await expect(second.getByRole("button", { name: /^C: / })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await second.getByRole("button", { name: "Check answer" }).click();
  await expect(second.getByRole("status")).toHaveText("Correct");
  await expect(second.getByText("Two and five.")).toBeVisible();

  await page.getByRole("button", { name: "Next question", exact: true }).click();
  // NAT: a number, checked with Enter; focus lands on the verdict.
  const third = question(page, 3);
  await expect(third.getByRole("button", { name: "Check answer" })).toBeDisabled();
  await third.getByLabel("Answer to question 3").fill("2.33");
  await third.getByLabel("Answer to question 3").press("Enter");
  await expect(third.getByRole("status")).toHaveText("Correct");
  await expect(third.getByText("Correct: 2.32 to 2.34")).toBeVisible();
  await expect(progress(page)).toHaveAttribute("aria-valuetext", "3 of 3 answered");
  await page.screenshot({ path: "test-results/practice-answered.png", fullPage: true });

  // Answers belong to this browser and survive a reload.
  await page.reload();
  await expect(progress(page)).toHaveAttribute("aria-valuetext", "3 of 3 answered");
  await page.getByRole("button", { name: "Previous question", exact: true }).click();
  await page.getByRole("button", { name: "Previous question", exact: true }).click();
  await expect(question(page, 1).getByRole("status")).toHaveText("Not quite");

  // Editing a question retires its old answer; the others stand.
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByLabel("Edit practice questions")
    .fill(DRILL.replace("Which number is even?", "Which of these is even?"));
  await page.getByRole("button", { name: "Done · Save" }).click();
  await expect(progress(page)).toHaveAttribute("aria-valuetext", "2 of 3 answered");
  await expect(question(page, 1).getByRole("status")).toHaveCount(0);

  page.once("dialog", (dialog) => void dialog.accept());
  await showPracticeSettings(page);
  await page.getByRole("button", { name: "Start over" }).click();
  await closePracticeSettings(page);
  await expect(progress(page)).toHaveAttribute("aria-valuetext", "0 of 3 answered");
  await page.reload();
  await expect(progress(page)).toHaveAttribute("aria-valuetext", "0 of 3 answered");
});

test("a broken .xp says what to fix, and Create ▸ Practice starts from a working file", async ({
  page,
}) => {
  await page.goto("/");
  await upload(page, [file("broken.xp", ":::question{#q type=mcq}\nQ?\n\n- a\n- b\n:::\n")]);
  await sidebar(page).getByRole("button", { name: "broken", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Question q has no matching :::solution block",
  );

  await sidebar(page).getByRole("button", { name: "Add to workspace" }).click();
  page.once("dialog", (dialog) => void dialog.accept("Warm-up drill"));
  await page.getByRole("button", { name: "New practice" }).click();
  const source = page.getByLabel("Edit practice questions");
  await expect(source).toHaveValue(/^# Warm-up\n/);
  await expect(page.getByText("Reads as 3 questions")).toBeVisible();
  await page.getByRole("button", { name: "Done · Save" }).click();
  await expect(
    sidebar(page).getByRole("button", { name: "Warm-up drill", exact: true }),
  ).toBeVisible();
  await expect(progress(page)).toHaveAttribute("aria-valuetext", "0 of 3 answered");
});

test("on a phone, practice fits the screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await upload(page, [file("drill.xp", DRILL)]);
  await expect(progress(page)).toBeVisible();
  await question(page, 1).getByRole("button", { name: /^B: / }).click();
  await expect(question(page, 1).getByRole("status")).toHaveText("Correct");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/practice-mobile.png", fullPage: true });
});

const timedRules = (seconds: number, extras: object = {}) =>
  JSON.stringify({
    xrule: 1,
    name: "Timed practice",
    practice: { questionTimeLimitSeconds: seconds, ...extras },
  });
const timedDrill = `---\nrules: timed.xrule\n---\n\n${DRILL}`;

test("practice deadlines advance once, keep times local, and finish the last question", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/");
  await upload(page, [file("drill.xp", timedDrill), file("timed.xrule", timedRules(5))]);
  await sidebar(page).getByRole("button", { name: "drill", exact: true }).click();
  await expect(question(page, 1)).toBeVisible();
  await page.clock.runFor(5100);
  await expect(question(page, 2)).toBeVisible();
  await expect(question(page, 1)).toHaveCount(0);
  await expect(page.getByText("Twelve is divisible by two.")).toHaveCount(0);
  const answers = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("localdox:practice-answers:"))!;
    return JSON.parse(localStorage.getItem(key)!);
  });
  expect(answers.even).toMatchObject({ reason: "timeout", elapsedMs: 5000, response: null });
  await page.getByRole("button", { name: "Previous question", exact: true }).click();
  await expect(question(page, 1).getByRole("status")).toHaveText("Time is up");
  await expect(page.getByText("Twelve is divisible by two.")).toBeVisible();
  await page.clock.runFor(10000);
  await expect(question(page, 1)).toBeVisible();
  await page.getByRole("button", { name: "Next question", exact: true }).click();
  await page.clock.runFor(5100);
  await expect(question(page, 3)).toBeVisible();
  await page.clock.runFor(5100);
  await expect(page.getByText("Practice complete", { exact: true })).toBeVisible();
  await expect(question(page, 3).getByRole("status")).toHaveText("Time is up");
  await page.clock.runFor(10000);
  await expect(question(page, 3)).toBeVisible();
  page.once("dialog", (d) => void d.accept());
  await showPracticeSettings(page);
  await page.getByRole("button", { name: "Start over" }).click();
  await closePracticeSettings(page);
  await expect(question(page, 1)).toBeVisible();
  await expect(page.getByRole("timer")).toContainText("0:05");
  await question(page, 1).getByRole("button", { name: /^B: / }).click();
  await page.getByRole("button", { name: "Next question", exact: true }).click();
  await expect(page.getByRole("timer")).toContainText("0:05");
});

test("an answer stops the clock; unanswered timing resumes after reload", async ({ page }) => {
  await page.clock.install();
  await page.goto("/");
  await upload(page, [
    file("drill.xp", timedDrill),
    file("timed.xrule", timedRules(30, { allowSkip: false })),
  ]);
  await sidebar(page).getByRole("button", { name: "drill", exact: true }).click();
  await expect(question(page, 1)).toBeVisible();
  await expect(page.getByRole("button", { name: "Show solution" })).toHaveCount(0);
  await page.clock.runFor(6000);
  await page.reload();
  await expect(page.getByRole("timer")).toContainText(/0:2[34]/);
  await question(page, 1).getByRole("button", { name: /^B: / }).click();
  await page.clock.runFor(60000);
  await expect(question(page, 1).getByRole("status")).toHaveText("Correct");
  await expect(page.getByRole("timer", { name: "Solve time" })).toHaveText(/0:0[67]/);
  await expect(question(page, 2)).toHaveCount(0);
});

test("practice rules can be created, configured and linked through the UI", async ({ page }) => {
  await page.goto("/");
  await upload(page, [file("drill.xp", DRILL)]);
  await showPracticeSettings(page);
  await page.getByRole("button", { name: "New practice rules" }).click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(settings.getByRole("heading", { name: "Practice", exact: true })).toBeVisible();
  await settings.getByLabel("Set Time per question (seconds)", { exact: true }).check();
  await settings
    .getByRole("spinbutton", { name: "Time per question (seconds)", exact: true })
    .fill("15");
  await settings.locator("summary").filter({ hasText: "Advanced" }).click();
  await settings.getByLabel("Show question timer", { exact: true }).uncheck();

  await settings.getByRole("button", { name: "Save", exact: true }).click();
  await settings.getByRole("button", { name: "Done", exact: true }).click();
  const controls = await showPracticeSettings(page);
  await expect(controls.getByRole("combobox", { name: "Practice rules", exact: true })).toHaveText(
    "Practice",
  );
  await closePracticeSettings(page);
  await expect(page.getByRole("timer")).toBeVisible();
  await expect(page.getByText(/^Elapsed:/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Show solution" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("timer")).toBeVisible();
  await showPracticeSettings(page);
  await page.getByRole("combobox", { name: "Practice rules", exact: true }).click();
  await page.getByRole("option", { name: "Default · no time limit", exact: true }).click();
  await closePracticeSettings(page);
  await expect(page.getByRole("timer")).toBeVisible();
  await expect(question(page, 1)).toBeVisible();
});

test("missing practice rules are actionable and cannot silently disable the deadline", async ({
  page,
}) => {
  await page.goto("/");
  await upload(page, [file("drill.xp", timedDrill)]);
  await expect(page.getByRole("alert")).toContainText("were not found");
  await expect(question(page, 1)).toHaveCount(0);
  await showPracticeSettings(page);
  await page.getByRole("combobox", { name: "Practice rules", exact: true }).click();
  await page.getByRole("option", { name: "Default · no time limit", exact: true }).click();
  await closePracticeSettings(page);
  await expect(question(page, 1)).toBeVisible();
});

test("practice arrows preserve drafts, pause freezes timing, and ended sessions survive reload", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/");
  await upload(page, [file("drill.xp", DRILL)]);
  await expect(question(page, 1)).toBeVisible();
  await page.clock.runFor(3000);
  await expect(page.getByRole("timer")).toHaveText("0:03");
  await page.getByRole("button", { name: "Next question", exact: true }).click();
  await question(page, 2).getByRole("button", { name: /^C: / }).click();
  await page.clock.runFor(2000);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(page.getByText("Practice paused", { exact: true })).toBeVisible();
  await expect(question(page, 2)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Next question", exact: true })).toBeDisabled();
  await page.clock.runFor(20000);
  await expect(page.getByRole("timer")).toHaveText("0:02");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(question(page, 2).getByRole("button", { name: /^C: / })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.clock.runFor(3000);
  await expect(page.getByRole("timer")).toHaveText("0:05");
  await page.getByRole("button", { name: "Previous question", exact: true }).click();
  await expect(page.getByRole("timer")).toHaveText("0:03");
  await page.getByRole("button", { name: "Next question", exact: true }).click();
  await expect(question(page, 2).getByRole("button", { name: /^C: / })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await showPracticeSettings(page);
  await page.getByRole("button", { name: "End practice", exact: true }).click();
  await closePracticeSettings(page);
  await expect(page.getByRole("heading", { name: "Practice ended" })).toBeVisible();
  await expect(page.getByRole("timer")).toHaveCount(0);
  await page.clock.runFor(60000);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Practice ended" })).toBeVisible();
  await page.getByRole("button", { name: "Continue practice" }).click();
  await expect(page.getByRole("timer")).toHaveText("0:05");
  await expect(question(page, 2).getByRole("button", { name: /^C: / })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await showPracticeSettings(page);
  await page.getByRole("button", { name: "End practice", exact: true }).click();
  await closePracticeSettings(page);
  page.once("dialog", (dialog) => void dialog.accept());
  await showPracticeSettings(page);
  await page.getByRole("button", { name: "Start over", exact: true }).click();
  await closePracticeSettings(page);
  await expect(question(page, 1)).toBeVisible();
  await expect(page.getByRole("timer")).toHaveText("0:00");
});

test("practice controls share one row above the question on desktop and mobile", async ({
  page,
}) => {
  await page.goto("/");
  await upload(page, [file("drill.xp", DRILL)]);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const row = page.getByRole("group", { name: "Practice controls", exact: true });
    const buttons = row.getByRole("button");
    await expect(buttons).toHaveCount(3);
    const boxes = await Promise.all((await buttons.all()).map((button) => button.boundingBox()));
    const timer = (await row.getByRole("timer").boundingBox())!;
    const q = (await question(page, 1).boundingBox())!;
    for (const box of boxes) {
      expect(box!.y + box!.height / 2).toBeCloseTo(timer.y + timer.height / 2, 0);
      expect(box!.y + box!.height).toBeLessThan(q.y);
    }
    await expect(row.getByText("1 / 3", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Show solution", exact: true })).toHaveCount(0);
    await expect(
      page.locator("summary").filter({ hasText: /Progress|Practice settings/ }),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^(Pause|Resume) practice$/ })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Practice settings", exact: true }),
    ).toHaveAttribute("aria-haspopup", "dialog");
    await expect(page.getByRole("button", { name: "End practice", exact: true })).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `test-results/practice-controls-${width}.png` });
  }
});

test("practice settings live in the routed Settings modal and preserve drafts", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/");
  await upload(page, [file("drill.xp", DRILL)]);
  await page.getByRole("button", { name: "Next question", exact: true }).click();
  await question(page, 2).getByRole("button", { name: /^C: / }).click();
  await page.clock.runFor(3000);
  const fileUrl = page.url();
  let settings = await showPracticeSettings(page);
  await expect(page).toHaveURL(/\/settings\/practice\/[^/]+$/);
  await settings.getByRole("checkbox", { name: /^Show question timer/ }).uncheck();
  await settings.getByRole("checkbox", { name: /^Show progress bar/ }).uncheck();
  await settings.getByRole("button", { name: "Save practice settings", exact: true }).click();
  await expect(settings.getByRole("combobox", { name: "Practice rules", exact: true })).toHaveText(
    "Practice",
  );
  await page.clock.runFor(20000); // opening Settings pauses question timing too
  await page.reload();
  settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(settings.getByRole("heading", { name: "Practice", exact: true })).toBeVisible();
  await expect(settings.getByRole("checkbox", { name: /^Show progress bar/ })).not.toBeChecked();
  await settings.getByRole("checkbox", { name: "Set a question time limit", exact: true }).check();
  await settings.getByRole("spinbutton", { name: "Seconds per question", exact: true }).fill("20");
  await settings.getByRole("button", { name: "Save practice settings", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(settings.getByRole("tab", { name: "Practice", exact: true })).toBeInViewport();
  await page.screenshot({ path: "test-results/practice-settings-mobile.png" });
  await closePracticeSettings(page);
  await expect(page).toHaveURL(fileUrl);
  await expect(progress(page)).toHaveCount(0);
  await expect(page.getByRole("timer")).toHaveText("0:17");
  await expect(question(page, 2).getByRole("button", { name: /^C: / })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("button", { name: "Practice settings", exact: true })).toBeFocused();
});

test("practice auto-pauses on tab and window changes and resumes without playback controls", async ({
  page,
  context,
}) => {
  await page.clock.install();
  await page.goto("/");
  await upload(page, [
    file("drill.xp", timedDrill),
    file("timed.xrule", timedRules(10, { pauseOnTabLeave: false })),
  ]);
  await sidebar(page).getByRole("button", { name: "drill", exact: true }).click();
  await expect(question(page, 1)).toBeVisible();
  await page.clock.runFor(3000);
  // Headless Chromium keeps pages visible; dispatch the browser visibility transition explicitly.
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByText("Practice paused", { exact: true })).toBeVisible();
  await page.clock.runFor(30000);
  await expect(page.getByRole("timer")).toHaveText("0:07");
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });
  await expect(question(page, 1)).toBeVisible();
  await page.clock.runFor(1000);
  await expect(page.getByRole("timer")).toHaveText("0:06");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.clock.runFor(20000);
  await expect(page.getByRole("timer")).toHaveText("0:06");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(question(page, 1)).toBeVisible();
  await page.clock.runFor(1000);
  await expect(page.getByRole("timer")).toHaveText("0:05");
  await expect(page.getByRole("button", { name: /^(Pause|Resume) practice$/ })).toHaveCount(0);
});

test("Practice modal protects unsaved settings and returns to the three-dot opener", async ({
  page,
}) => {
  await page.goto("/");
  await upload(page, [file("drill.xp", DRILL)]);
  const settings = await showPracticeSettings(page);
  const settingsUrl = page.url();
  await settings.getByRole("checkbox", { name: /^Show question timer/ }).uncheck();
  page.once("dialog", (dialog) => void dialog.dismiss());
  await settings.getByRole("tab", { name: "Reading", exact: true }).click();
  await expect(page).toHaveURL(settingsUrl);
  await expect(settings.getByRole("checkbox", { name: /^Show question timer/ })).not.toBeChecked();
  page.once("dialog", (dialog) => void dialog.accept());
  await closePracticeSettings(page);
  await expect(page.getByRole("timer")).toBeVisible();
  await expect(page.getByRole("button", { name: "Practice settings", exact: true })).toBeFocused();
});
