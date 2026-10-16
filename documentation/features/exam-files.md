# Exam and practice files: `.xam`, `.xrule` and `.xp`

Three plain files, organised in folders like any other:

| File           | Format   | Holds                                                                            | Opens                                     |
| -------------- | -------- | -------------------------------------------------------------------------------- | ----------------------------------------- |
| `mock-1.xam`   | Markdown | An exam paper: questions, keys and solutions.                                    | Start, resume and review in any workspace |
| `mock-1.xrule` | JSON     | How exams run: name, time, pass mark, attempts, marking, tools, any engine rule. | Settings ▸ Exam rules                     |
| `bayes.xp`     | Markdown | Practice questions with their solutions. No rules.                               | Anywhere, answered in place               |

## Why exams and practice are separate files

They follow opposite rules. An **exam** is strict: timed, a pass mark, a limited number of attempts, and its keys and solutions stay sealed until the attempt is submitted. **Practice** is the reverse: a per-question clock, optional deadlines, no attempt limit, and the key and solution appear the moment a question is answered, because that is how practice teaches.

Papers used to hold both, a `# Practice` part above the `# Exam` part, plus Learn, Practice, Exam and Review steps that unlocked one after another. One file then had to hide its keys and show them, depending on which heading a question sat under, and the exam waited behind a self-reported "I've finished studying". Splitting by file makes the rule follow the file type: an `.xam` never reveals a key before submission, and an `.xp` never hides one. A paper that still has a `# Practice` heading is refused with a message pointing at `.xp`.

The `.xrule` split follows who changes what. Questions change often; rules change rarely and apply to many papers. One `.xrule` can govern a whole folder of papers.

## `.xam`: an exam paper

```text
:::question{#q1 type=nat marks=2 difficulty=easy}
Write $\frac{5}{8}$ to two decimal places.
:::

:::solution{#q1 answer=0.62:0.63}
$5 \div 8 = 0.625$.
:::
```

- Every `:::question` is an exam question, in order. `# Exam` (or `# Questions`) and `# Solutions` headings are optional and only organise the file; questions can't follow `# Solutions`.
- `:::question{#id type=mcq|msq|nat marks=N}` holds the question, then its options as a list (MCQ/MSQ). Optional: `section`, `topic`, `difficulty`, `time`, `tags`.
- `:::solution{#id answer=…}` holds the key and the explanation, anywhere in the file, matched by id. Answers are a letter (`B`), letters (`B,C`), a number, or a range (`0.62:0.63`); `tolerance=` widens a number.
- An optional header names the ruleset: `---` / `rules: mock.xrule` / `---`. New exam writes it.
- Math (`$…$`), Mermaid, ` ```chart ` fences and images named by file render as in the exam itself.

## `.xrule`: how an exam runs

```json
{
  "xrule": 1,
  "name": "Probability mock 1",
  "durationMinutes": 30,
  "passPercentage": 70,
  "maxAttempts": 3
}
```

| Field             | Required | Meaning                                                                                                    |
| ----------------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| `xrule`           | yes      | Format version, always `1`.                                                                                |
| `name`            | yes      | The exam's name.                                                                                           |
| `summary`         |          | Markdown shown on the paper above its Start button: what the exam covers.                                  |
| `durationMinutes` |          | 1–600. Default 30.                                                                                         |
| `questionCount`   |          | Exact number of questions the `.xam` must have. Omit to allow any number.                                  |
| `passPercentage`  |          | 0–100. Default 70.                                                                                         |
| `maxAttempts`     |          | 1–20. Default 3.                                                                                           |
| `mcqPenalty`      |          | `none`, `third` or `quarter` of a wrong MCQ's marks. Only without `preset` or `rules`.                     |
| `calculator`      |          | `none`, `basic` or `scientific`. Only without `preset` or `rules`.                                         |
| `preset`          |          | `"gate"` starts from the built-in GATE ruleset.                                                            |
| `rules`           |          | A complete engine ruleset ([reference](../docs/exam-format.md)) for sections, MSQ partial credit and more. |

Layers apply in order, each overriding the last: the defaults or the preset, then `rules`, then the plain fields. Combinations that would be silently ignored (`preset` with `rules`; `mcqPenalty` or `calculator` with either) are rejected. Parsing produces an `ExamSetup`, the object the exam engine already runs on.

## `.xp`: practice

```text
# Conditional probability

:::question{#cp1 type=mcq}
A fair die shows an even number. What is the chance it is a 6?

- 1/6
- 1/3
- 1/2
:::

:::solution{#cp1 answer=B}
Three even faces, one of them a 6.
:::
```

The paper's grammar, made lighter: no `.xrule`, no header, `marks` optional (default 1). Headings organize the source; the practice reader shows only the question, options, solution, question timer and quiet progress. Every question needs its solution, and keys are checked when the file is read, so a mistake shows as a problem to fix, not as a wrong verdict.

**Answering.** Choosing an MCQ option is answering it. MSQ options are picked, then **Check answer**. A NAT is typed, then Enter. Each question then shows Correct, Partly correct or Not quite, marks the right options and the one chosen, and opens its solution. An answer is final; **Start over** clears them all. Scoring is the exam's own `scoreQuestion`, without negative marking.

**Session controls.** The arrows, question number, timer and a three-dot settings button share one row above the question. Selecting an MCQ option reveals its solution for right and wrong answers; there is no separate reveal action. Arrows preserve unfinished MSQ/NAT drafts. Practice automatically pauses on tab/window changes and while Settings is open, then resumes on return. There are no playback buttons. The three-dot button opens Settings → Practice at `/settings/practice/<file id>`, containing time limits, timer/progress visibility, linked rules, restart and end-session actions. End saves progress and stops timing; Continue practice returns to the same question. Current question, drafts and ended state survive reloads in `localdox:practice-session:<file id>`. Start over clears answers, times and session state. Changes apply explicitly and persist in the linked `.xrule`; saving defaults creates one for the file. The question view has no inline settings panel.

**Exam enforcement.** All `.xam` sessions require fullscreen and explicit Save & next, disallow pausing, block copy/paste and right-click, and submit at the deadline. Window/tab or fullscreen exits are recorded: two warnings, then submission on the third incident, unless authored limits are stricter. In-app navigation is blocked until submission. These are browser controls, without camera monitoring or operating-system lockdown.

**Where answers live.** In this browser's `localStorage`, under `localdox:practice-answers:<file id>`. Practice progress is the reader's own and cheap to lose, so it isn't written into the file, exported, or put behind exam storage's writer lock (which would make a practice file wait for an open exam). Each answer stores a hash of its question and key; editing either retires that answer and leaves the others. Storage that is full or blocked only means answers don't survive a reload.

**Making them.** Create ▸ Practice, or **New file** with a name ending in `.xp`, starts from a working template (`XP_TEMPLATE`). `scripts/generate-gate-da-probability-practice.mjs` writes generated packs as `.xp`. `plans/conditional-probability-tough.xp` is a hand-written test pack (14 questions: Bayes, paradoxes, conditioning, independence); `tests/practice-files.test.ts` checks every key against an independently computed answer and the usual wrong one.

## Sitting a paper

In **any workspace**, opening a `.xam` shows its rules, then one action for where the learner stands (Start, Resume, Retake, Review answers, or Use the edited paper) and the attempts so far. An uploaded paper without a rules tag or applicable rules file uses the default rules immediately: 30 minutes, 70% to pass, three attempts and no negative marking. **Default rules** creates an editable rules file and opens it in Settings. The instructions and the running exam cover the whole screen; once it is submitted, the result replaces the paper's panel in the reader, with the sidebar back beside it. Nothing unlocks first. Keys and solutions are read only from a submitted attempt (`loadSolutions` refuses earlier), and the result's **Answers & solutions**, on the same screen as the score, is the first place they appear.

Before the first attempt, **Use GATE style** creates and attaches a GATE ruleset sized to the uploaded paper. Its duration scales from three hours for 65 questions, rounded up to whole minutes and capped at three hours. It enables the GATE palette, Save & next, review flags, NAT keypad, scientific calculator and one-third negative marking for MCQs. The rules link lets you adjust the duration. A full 65-question paper must satisfy the GATE section composition; shorter mocks use their own sections. Practice remains a separate `.xp` file with immediate answer feedback.

Standalone previews without a workspace show questions and options without keys. The source, through **Edit**, is the one place a key is visible before submission: it is the author's file.

**Which rules apply.**

1. The ruleset named in the paper's header, when it exists. If it's gone (binned, renamed), the paper says so rather than run under another.
2. Otherwise, from the paper's folder up to the root: `mock-1.xrule` beside `mock-1.xam` wins; else a folder with exactly one `.xrule` applies it to every paper beneath.
3. Two unrelated `.xrule` files at one level stop the search: the paper asks which to use.
4. With none and no explicit rules tag, the paper uses the default rules and offers **Start exam** immediately. Missing named rules or ambiguous choices still require selecting or restoring the ruleset.

Rulesets aren't listed in the sidebar; Settings ▸ Exam rules lists and edits them, and a paper's rules link opens them there. Uploading a `.xrule` explains this location and offers **Open exam rules**. Files in the Bin don't count.

**Configure a paper.** Its three-dots menu offers **Configure**: select a ruleset, use automatic folder rules, edit the selected ruleset, create one, or apply GATE style. Quick settings cover the time limit, passing score and maximum attempts. Saving changes to these values creates a ruleset for this paper, preserving shared rules for other papers. Advanced marking, tools, sections and navigation remain editable through **Edit ruleset** in Settings. Changes after an attempt follow the pinning rules below.

**Create from the sidebar.** Right-click and choose **New** → **File**, **Folder**, **Board**, **Exam** or **Ruleset**. New documents and folders go inside the clicked folder (or a clicked file's parent); rulesets open in Settings ▸ Exam rules.

**A GATE ruleset in one step.** Settings ▸ Exam rules ▸ **New ruleset** offers two starting points: the default rules, or **GATE** (`gateXruleTemplate`): `preset: "gate"` with the paper-level facts written out (65 questions, 180 minutes, 25% to pass, 3 attempts) so they are visible and easy to change. The preset brings the rest: General Aptitude and Subject sections with their 1- and 2-mark composition, −1/3 for a wrong MCQ, no penalty or partial credit for MSQ, the NAT keypad, the scientific calculator, the GATE palette and Save & next (`navigation.requireSave`). A full paper tags each question `section=GA` or `section=subject`; an untagged one is reported with the tags to use. For a shorter mock, lower `questionCount` and `durationMinutes`: sections then come from the questions present, and the GATE marking still applies.

**Progress belongs to the paper file.** Each `.xam` has one record (a study plan, keyed by the file's id via `paperPlanId`), so renaming or moving it keeps its attempts. The record fingerprints the paper and rules text it was built from, and `syncPaperPlan` compares that with the files every time the paper opens:

- **Unchanged:** nothing happens.
- **Changed, no attempt yet:** rebuilt from the files.
- **Changed after an attempt:** **pinned** to the version the attempt used, because a score and an attempt limit only mean something against the paper they were earned on. The paper says so.

**After the last attempt.** A paper that ran out of attempts without a pass needs a new paper: edit the file's questions, then **Use the edited paper**. It must pass the rewrite rules (different questions; the rule's share tagged with its difficulty label, 50% `hard` by default) and keeps the original rules. A passed paper is done; its review stays available.

## Flow

```
open mock-1.xam (any workspace)
  └─ rulesFileFor ──▶ the .xrule ─parseXrule─▶ ExamSetup ─┐
     mock-1.xam text + workspace images ─parseExamFile─────┴─ readExamFile ─▶ exam record + sealed keys
  └─ syncPaperPlan: current / rebuilt / pinned ─▶ ExamPanel ─▶ full-screen session ─▶ result ─▶ review

open bayes.xp (any workspace)
  └─ readPracticeFile ─▶ groups + solutions ─▶ answer ─checkPractice─▶ verdict + solution ─▶ localStorage
```

- `src/services/exams/parser.ts`: `parseExamFile` (papers) and `parsePracticeFile` (practice) share one block reader, so both accept the same blocks and report errors by line.
- `src/services/exams/practice.ts`: `readPracticeFile` validates an `.xp`; `checkPractice` grades one answer.
- `src/services/exams/xrule.ts`, `exam-setup.ts`: the `.xrule` schema; `readExamFile` checks a paper against its setup, keys included, before the first attempt.
- `src/services/exams/paper-plan.ts`: `rulesFileFor`, `paperPlanId`, `syncPaperPlan`, `starterRules`. Pure, unit-tested.
- `src/services/exams/ExamPanel.tsx`, `ExamApp.tsx`: the paper at rest; storage, writer lock, recovery, sessions and grading.
- `src/components/docs/viewer/document-viewer/ExamFileViewer.tsx`, `PracticeFileViewer.tsx`: the two Markdown formats in the reader. `question-source.tsx` is their shared editor (draft, Done/Cancel, problems).
- `src/lib/markdown/document-utils.ts`: maps `xam` → `exam`, `xrule` → `exam-rules`, `xp` → `practice`; all are text and editable.

## Trade-offs and limits

- **Keys live in the paper's source.** Hiding them everywhere but a submitted attempt's review is a product rule, not secrecy: anyone with the file can read it in Edit. Local files have no server to keep a secret.
- **Practice answers are per browser.** They don't follow a workspace export or another device, and a file deleted from the workspace leaves its small `localStorage` entry behind. Worth it for practice that never waits on, or is blocked by, exam storage.
- **A long `.xp` renders whole.** It reads like a document, every question on one page. The generated 100-question packs parse in about 20 ms; solutions render only once answered.
- **Images resolve from the current workspace.** Papers and `.xp` files find images by file name. Standalone previews without workspace assets show "Image not available: name".
- **One open paper per workspace.** Exam storage has one writer lock per workspace; a second paper waits until the first closes. Practice files take no lock.
- **The rules block is the engine's own ruleset**, not a friendlier copy: every engine rule is reachable, at the cost of verbosity. Plain fields and `preset` cover most files.

## Debugging

- _"Practice questions go in their own .xp file"_: a paper has a `# Practice` heading. Move those questions to an `.xp`.
- _"This paper needs rules"_ / _"…rules are missing"_: no `.xrule` found, or the one its header names is gone.
- _"Unknown field …"_: a typo in the `.xrule`; the schema is strict.
- _"Expected N exam questions, found M"_: `questionCount` (or a ruleset's sections) disagrees with the paper.
- _"Edited since your first attempt"_: expected; see pinning.
- _An `.xp` answer disappeared after an edit_: its question or key changed, so the old verdict no longer applies.
- _"Opening exam storage…" never finishes_: another tab or pane has a paper from this workspace open.
- _A GATE paper says "Expected 65 exam questions"_: the GATE template is the full pattern; lower `questionCount` (and `durationMinutes`) for a shorter mock.
- Tests: `tests/exam-files.test.ts`, `tests/exam-setup.test.ts` (formats), `tests/practice-files.test.ts` (`.xp`), `tests/exam-paper-plan.test.ts` (rules lookup, sync, pinning), `tests/e2e/exam-files.spec.ts` and `tests/e2e/practice-files.spec.ts` (both flows end to end, phone included).
