import {
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ChevronLeft, ChevronRight, Check, Ellipsis, X } from "lucide-react";
import { dataBlob } from "@/lib/workspace/binary";
import { ExamAssets, ExamMarkdown } from "@/services/exams/ExamMarkdown";
import { numeric, optionLabel, type Question, type Solution } from "@/services/exams/parser";
import { checkPractice, readPracticeFile, type PracticeSheet } from "@/services/exams/practice";
import { isAnswered, type Outcome, type Response } from "@/services/exams/scoring";
import { DEFAULT_PRACTICE_RULES, type PracticeRules } from "@/services/exams/practice-rules";
import {
  PRACTICE_ACTION_EVENT,
  type PracticeAction,
  formatPracticeTime,
  loadPracticeAnswers,
  loadPracticeTime,
  loadPracticeSession,
  savePracticeSession,
  type PracticeSession,
  practiceGeneration,
  practiceSignature,
  savePracticeAnswers,
  savePracticeTime,
  type PracticeAnswer as Answer,
  type PracticeAnswers as Answers,
} from "@/services/exams/practice-progress";
import { isRulesFile, rulesTag } from "@/services/exams/rules-tag";
import { xruleSchema } from "@/services/exams/xrule";
import "@/services/exams/exams.css";
import { PracticeWorkspaceContext } from "../ExamWorkspaceContext";
import { ViewerFrame, ViewerMasthead } from "./shared";
import type { Props } from "./shared";
import {
  Problems,
  SourceEditor,
  Unreadable,
  plural,
  readQuestions,
  useSourceEditor,
} from "./question-source";

/**
 * An `.xp` file discloses one question and its feedback at a time.
 * Rules travel with files; answers and solve times belong only to this browser.
 */
export function PracticeFileViewer(props: Props) {
  const { file, prevFile, nextFile, onNavFile, onOpenPalette } = props;
  const workspace = useContext(PracticeWorkspaceContext);
  const read = useCallback(
    (source: string) => readQuestions(() => readPracticeFile(source, file.name)),
    [file.name],
  );
  const saved = useMemo(() => read(file.content), [read, file.content]);
  const { editing, draft, setDraft, drafted, actions } = useSourceEditor(file, read, props);
  // Images resolve by file name from the current workspace.
  const files = workspace?.files;
  const assets = useMemo(() => {
    const found: Record<string, Blob> = {};
    for (const f of files ?? []) {
      const blob = !f.deletedAt && f.kind === "image" ? dataBlob(f.data, f.mimeType) : null;
      if (blob) found[f.name] = blob;
    }
    return { assets: found };
  }, [files]);

  return (
    <ViewerFrame
      file={file}
      prevFile={prevFile}
      nextFile={nextFile}
      onNavFile={onNavFile}
      onOpenPalette={onOpenPalette}
      editing={editing}
      action={actions}
    >
      <div className="mx-auto max-w-3xl px-4 py-6 md:px-8">
        {(editing || !saved.ok) && <ViewerMasthead file={file} kindLabel="Practice" />}
        {editing ? (
          <SourceEditor
            label="Edit practice questions"
            draft={draft}
            onChange={setDraft}
            status={
              drafted?.ok ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Reads as {plural(drafted.value.questions.length, "question")} — Done saves, Cancel
                  discards.
                </p>
              ) : (
                <Problems problems={drafted?.problems ?? []} compact />
              )
            }
          />
        ) : saved.ok ? (
          <ExamAssets source={assets}>
            <PracticeSetup props={props} sheet={saved.value} />
          </ExamAssets>
        ) : (
          <Unreadable problems={saved.problems} source={file.content} />
        )}
      </div>
    </ViewerFrame>
  );
}

function PracticeSetup({ props, sheet }: { props: Props; sheet: PracticeSheet }) {
  const workspace = useContext(PracticeWorkspaceContext);
  const tag = rulesTag(props.file.content);
  const rulesets = (workspace?.files ?? []).filter((f) => !f.deletedAt && isRulesFile(f));
  const selected = rulesets.find((f) => f.name === tag);
  const parsed = selected
    ? xruleSchema.safeParse(
        (() => {
          try {
            return JSON.parse(selected.content);
          } catch {
            return null;
          }
        })(),
      )
    : null;
  const rules = parsed?.success ? parsed.data.practice : undefined;
  const problem =
    tag &&
    (!selected
      ? `Practice rules “${tag}” were not found in this workspace.`
      : !parsed?.success
        ? `Fix “${tag}” in Settings before continuing.`
        : !rules
          ? `“${tag}” has no practice controls. Add them in Settings → Exam rules → Advanced.`
          : null);
  const openSettings = () => workspace?.openPractice(props.file.id);
  const settingsButton = (
    <button
      type="button"
      aria-label="Practice settings"
      title="Practice settings"
      aria-haspopup="dialog"
      onClick={openSettings}
      disabled={!workspace}
      className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30"
    >
      <Ellipsis size={18} aria-hidden />
    </button>
  );
  return problem ? (
    <div className="space-y-4">
      <div className="flex justify-end">{settingsButton}</div>
      <p role="alert" className="text-sm text-destructive">
        {problem}
      </p>
    </div>
  ) : (
    <Sheet
      key={`${props.file.id}:${sheet.questions.map((q) => `${q.id}:${practiceSignature(q, sheet.solutionFor[q.id])}`).join(",")}`}
      fileId={props.file.id}
      sheet={sheet}
      rules={rules ?? DEFAULT_PRACTICE_RULES}
      paused={workspace?.paused ?? false}
      settingsButton={settingsButton}
    />
  );
}

function Sheet({
  fileId,
  sheet,
  rules,
  paused,
  settingsButton,
}: {
  settingsButton: ReactNode;
  fileId: string;
  sheet: PracticeSheet;
  rules: PracticeRules;
  paused: boolean;
}) {
  const signatures = useMemo(
    () =>
      Object.fromEntries(
        sheet.questions.map((q) => [q.id, practiceSignature(q, sheet.solutionFor[q.id])]),
      ),
    [sheet],
  );
  const [stored, setStored] = useState(() => loadPracticeAnswers(fileId));
  const answers = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(stored).filter(([id, a]) => signatures[id] === a.sig),
      ) as Answers,
    [stored, signatures],
  );
  const signature = Object.entries(signatures)
    .map(([id, sig]) => `${id}:${sig}`)
    .join(",");
  const [session, setSession] = useState<PracticeSession>(() => {
    const restored = loadPracticeSession(fileId, signature);
    const firstOpen = sheet.questions.find((q) => !answers[q.id]) ?? sheet.questions.at(-1)!;
    return restored && sheet.questions.some((q) => q.id === restored.currentId)
      ? {
          ...restored,
          phase: restored.phase === "ended" ? "ended" : document.hidden ? "paused" : "running",
        }
      : { signature, currentId: firstOpen.id, phase: "running", drafts: {} };
  });
  const index = sheet.questions.findIndex((q) => q.id === session.currentId);
  const [restart, setRestart] = useState(0);
  const [notice, setNotice] = useState("");
  const focusRef = useRef<HTMLDivElement>(null);
  const initial = useRef(true);
  const pausedView = useRef(paused);
  pausedView.current = paused;
  const generation = practiceGeneration(fileId);
  useEffect(() => {
    savePracticeSession(fileId, session, generation);
  }, [fileId, session, generation]);
  // Pause on both tab visibility and window focus; coming back resumes without a button.
  useEffect(() => {
    const pause = () => setSession((s) => (s.phase === "running" ? { ...s, phase: "paused" } : s));
    const resume = () => {
      if (!document.hidden)
        setSession((s) => (s.phase === "paused" ? { ...s, phase: "running" } : s));
    };
    const visibility = () => {
      if (document.hidden) pause();
      else if (document.hasFocus()) resume();
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("blur", pause);
    window.addEventListener("focus", resume);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("blur", pause);
      window.removeEventListener("focus", resume);
    };
  }, []);
  useEffect(() => {
    const change = (event: Event) => {
      const action = (event as CustomEvent<PracticeAction>).detail;
      if (action.fileId !== fileId) return;
      setNotice("");
      if (action.action === "reset") {
        setStored({});
        setSession({ signature, currentId: sheet.questions[0].id, phase: "running", drafts: {} });
        setRestart((n) => n + 1);
      } else setSession((s) => ({ ...s, phase: "ended" }));
    };
    window.addEventListener(PRACTICE_ACTION_EVENT, change);
    return () => window.removeEventListener(PRACTICE_ACTION_EVENT, change);
  }, [fileId, signature, sheet]);
  useEffect(() => {
    if (initial.current) {
      initial.current = false;
      return;
    }
    if (!pausedView.current) focusRef.current?.focus({ preventScroll: true });
  }, [index, restart]);
  const commit = (next: Answers) => {
    setStored(next);
    savePracticeAnswers(fileId, next);
  };
  const q = sheet.questions[index];
  const stopped = paused || session.phase !== "running";
  const answer = (response: Response, elapsedMs: number, reason: Answer["reason"] = "answered") => {
    if (stopped || answers[q.id] || (reason === "answered" && !isAnswered(response))) return;
    const outcome =
      reason === "answered" ? checkPractice(q, sheet.solutionFor[q.id], response) : "unanswered";
    commit({ ...answers, [q.id]: { response, outcome, elapsedMs, reason, sig: signatures[q.id] } });
    if (reason === "timeout") {
      setNotice(
        `Time is up for question ${index + 1}. Its answer is available with Previous question.`,
      );
      if (index + 1 < sheet.questions.length)
        setSession((s) => ({ ...s, currentId: sheet.questions[index + 1].id }));
    }
  };
  const completed = Object.keys(answers).length;
  const move = (delta: number) => {
    const next = sheet.questions[index + delta];
    if (!next || stopped) return;
    setSession((s) => ({ ...s, currentId: next.id }));
    setNotice("");
  };
  const roundButton =
    "inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-30";
  return (
    <div className="ex-portal xf-preview flex flex-col gap-5">
      {session.phase === "ended" ? (
        <div>
          <div className="flex justify-end">{settingsButton}</div>
          <div className="space-y-4 py-10 text-center">
            <h2 className="text-base font-medium">Practice ended</h2>
            <p className="text-sm text-muted-foreground">
              {completed} of {sheet.questions.length} answered. Your progress is saved.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <button
                type="button"
                className="rounded-full bg-foreground px-4 py-2 text-sm text-background"
                onClick={() => setSession((s) => ({ ...s, phase: "running" }))}
              >
                Continue practice
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div
            ref={focusRef}
            tabIndex={-1}
            className="outline-none"
            aria-label={`Question ${index + 1} of ${sheet.questions.length}`}
          >
            <TimedQuestion
              key={`${q.id}:${restart}`}
              fileId={fileId}
              sig={signatures[q.id]}
              number={index + 1}
              question={q}
              solution={sheet.solutionFor[q.id]}
              answer={answers[q.id]}
              onAnswer={answer}
              rules={rules}
              paused={stopped}
              controls={
                <>
                  <nav aria-label="Practice questions" className="flex items-center gap-2">
                    <button
                      type="button"
                      aria-label="Previous question"
                      title="Previous question"
                      className={roundButton}
                      disabled={index === 0 || stopped}
                      onClick={() => move(-1)}
                    >
                      <ChevronLeft size={18} aria-hidden />
                    </button>
                    <span
                      className="min-w-12 text-center text-xs tabular-nums text-muted-foreground"
                      aria-hidden
                    >
                      {index + 1} / {sheet.questions.length}
                    </span>
                    <button
                      type="button"
                      aria-label="Next question"
                      title="Next question"
                      className={roundButton}
                      disabled={index === sheet.questions.length - 1 || stopped}
                      onClick={() => move(1)}
                    >
                      <ChevronRight size={18} aria-hidden />
                    </button>
                  </nav>
                </>
              }
              settingsButton={settingsButton}
              progress={
                rules.showProgress ? (
                  <div
                    className="h-0.5 overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-label="Practice answered"
                    aria-valuemin={0}
                    aria-valuemax={sheet.questions.length}
                    aria-valuenow={completed}
                    aria-valuetext={`${completed} of ${sheet.questions.length} answered`}
                  >
                    <div
                      className="h-full bg-muted-foreground/35"
                      style={{ width: `${(completed / sheet.questions.length) * 100}%` }}
                    />
                  </div>
                ) : null
              }
              draft={session.drafts[q.id] ?? null}
              onDraftChange={(draft) =>
                setSession((s) => ({ ...s, drafts: { ...s.drafts, [q.id]: draft } }))
              }
            />
          </div>
          {completed === sheet.questions.length && (
            <p role="status" className="text-center text-xs text-muted-foreground">
              Practice complete
            </p>
          )}
          {notice && (
            <p role="status" className="text-xs text-muted-foreground">
              {notice}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function TimedQuestion({
  fileId,
  sig,
  rules,
  paused,
  onAnswer,
  controls,
  settingsButton,
  progress,
  ...props
}: {
  settingsButton: ReactNode;
  controls: ReactNode;
  progress: ReactNode;
  fileId: string;
  sig: string;
  rules: PracticeRules;
  paused: boolean;
  number: number;
  question: Question;
  solution: Solution;
  answer?: Answer;
  draft: Response;
  onDraftChange: (response: Response) => void;
  onAnswer: (response: Response, elapsedMs: number, reason?: Answer["reason"]) => void;
}) {
  const [elapsed, setElapsed] = useState(
    () => props.answer?.elapsedMs ?? loadPracticeTime(fileId, props.question.id, sig),
  );
  const clock = useRef({ elapsed, since: Date.now(), running: false });
  const generation = useRef(practiceGeneration(fileId)).current;
  const callback = useRef(onAnswer);
  callback.current = onAnswer;
  const finished = useRef(!!props.answer);
  const limit =
    rules.questionTimeLimitSeconds === null ? null : rules.questionTimeLimitSeconds * 1000;
  const readTime = () =>
    clock.current.elapsed +
    (clock.current.running ? Math.max(0, Date.now() - clock.current.since) : 0);
  useEffect(() => {
    if (props.answer || paused || finished.current) return;
    const activeClock = clock.current;
    activeClock.since = Date.now();
    activeClock.running = true;
    let lastSecond = -1;
    const tick = () => {
      const ms = readTime();
      if (Math.floor(ms / 1000) !== lastSecond) {
        lastSecond = Math.floor(ms / 1000);
        setElapsed(ms);
        savePracticeTime(fileId, props.question.id, sig, ms, generation);
      }
      if (limit !== null && ms >= limit && !finished.current) {
        finished.current = true;
        callback.current(null, limit, "timeout");
      }
    };
    const timer = window.setInterval(tick, 250);
    const checkpoint = () =>
      savePracticeTime(fileId, props.question.id, sig, readTime(), generation);
    window.addEventListener("pagehide", checkpoint);
    tick();
    return () => {
      activeClock.elapsed = readTime();
      activeClock.running = false;
      window.clearInterval(timer);
      window.removeEventListener("pagehide", checkpoint);
      savePracticeTime(fileId, props.question.id, sig, activeClock.elapsed, generation);
    };
  }, [fileId, sig, props.question.id, props.answer, paused, limit, generation]);
  const complete = (response: Response, reason: Answer["reason"] = "answered") => {
    if (finished.current || paused) return;
    const ms = readTime();
    finished.current = true;
    if (limit !== null && ms >= limit) callback.current(null, limit, "timeout");
    else callback.current(response, ms, reason);
  };
  const displayed = props.answer?.elapsedMs ?? elapsed;
  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <div
          className="flex items-center gap-2 sm:gap-3"
          role="group"
          aria-label="Practice controls"
        >
          {controls}
          <span className="flex-1" />
          {(rules.showElapsedTime || limit !== null) && (
            <span
              role="timer"
              aria-label={
                props.answer ? "Solve time" : limit !== null ? "Time remaining" : "Question time"
              }
              title={
                props.answer ? "Solve time" : limit !== null ? "Time remaining" : "Question time"
              }
              className="shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground"
            >
              {formatPracticeTime(
                !props.answer && limit !== null
                  ? Math.ceil(Math.max(0, limit - elapsed) / 1000) * 1000
                  : displayed,
              )}
            </span>
          )}
          {settingsButton}
        </div>
        {progress}
      </div>
      {paused ? (
        <div role="status" className="py-14 text-center text-sm text-muted-foreground">
          Practice paused
        </div>
      ) : (
        <ol className="list-none">
          <PracticeQuestion {...props} onAnswer={(response) => complete(response)} />
        </ol>
      )}
    </div>
  );
}

const VERDICT: Record<Outcome, string> = {
  correct: "Correct",
  partial: "Partly correct",
  wrong: "Not quite",
  unanswered: "Not quite",
};

function PracticeQuestion({
  number,
  question: q,
  solution,
  answer,
  onAnswer,
  draft,
  onDraftChange,
}: {
  number: number;
  question: Question;
  solution: Solution;
  answer?: Answer;
  onAnswer: (response: Response) => void;
  draft: Response;
  onDraftChange: (response: Response) => void;
}) {
  const id = useId();
  const verdictRef = useRef<HTMLDivElement>(null);
  const moveFocus = useRef(false);
  // Checking with a button that then disappears would drop focus to the page;
  // it moves to the verdict instead, which also reads it out.
  useEffect(() => {
    if (answer && moveFocus.current) verdictRef.current?.focus();
    moveFocus.current = false;
  }, [answer]);
  const check = (response: Response) => {
    moveFocus.current = q.type !== "mcq";
    onAnswer(response);
  };

  const response = answer?.response ?? draft;
  const picked = Array.isArray(response) ? response : response ? [response] : [];
  const key = solution.answer.split(",").map((a) => a.trim());
  const ready = q.type === "nat" ? typeof draft === "string" && numeric(draft) : isAnswered(draft);

  return (
    <li aria-labelledby={`${id}-title`} className="list-none">
      <span id={`${id}-title`} className="sr-only">
        Question Q{number}
      </span>
      <ExamMarkdown source={q.body} />

      {q.type === "nat" ? (
        answer ? null : (
          <form
            className="mt-3 flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (ready) check(draft);
            }}
          >
            <input
              className="h-9 w-48 rounded-md border border-input bg-background px-3 text-sm tabular-nums outline-none focus:ring-2 focus:ring-ring"
              aria-label={`Answer to question ${number}`}
              inputMode="decimal"
              autoComplete="off"
              placeholder="Enter a number"
              value={typeof draft === "string" ? draft : ""}
              onChange={(e) => onDraftChange(e.target.value)}
            />
            <CheckButton disabled={!ready} />
          </form>
        )
      ) : (
        <>
          <ol className="mt-3 flex flex-col gap-1.5" aria-label="Options">
            {q.options.map((option, i) => {
              const label = optionLabel(i),
                on = picked.includes(label),
                state = !answer
                  ? on
                    ? "picked"
                    : "open"
                  : key.includes(label)
                    ? "correct"
                    : on
                      ? "wrong"
                      : "rest";
              return (
                <li
                  key={label}
                  className={`relative flex items-start gap-3 rounded-lg border px-3 py-2 transition-colors ${OPTION_TONE[state]}`}
                >
                  {/* The button stretches over the whole row, so the option is
                      the target; its markdown can't sit inside a button. */}
                  <button
                    type="button"
                    aria-labelledby={`${id}-${label}`}
                    aria-pressed={q.type === "msq" && !answer ? on : undefined}
                    aria-disabled={answer ? true : undefined}
                    onClick={() => {
                      if (answer) return;
                      if (q.type === "mcq") check(label);
                      else
                        onDraftChange(on ? picked.filter((v) => v !== label) : [...picked, label]);
                    }}
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full xf-choice text-xs font-semibold after:absolute after:inset-0 after:rounded-lg after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-ring ${answer ? "cursor-default" : "cursor-pointer"} ${BADGE_TONE[state]}`}
                  >
                    {state === "correct" ? (
                      <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
                    ) : state === "wrong" ? (
                      <X className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
                    ) : (
                      label
                    )}
                  </button>
                  <div id={`${id}-${label}`} className="xf-option min-w-0 flex-1">
                    <span className="sr-only">
                      {label}
                      {state === "correct" ? ", correct" : state === "wrong" ? ", your answer" : ""}
                      :{" "}
                    </span>
                    <ExamMarkdown source={option} />
                  </div>
                </li>
              );
            })}
          </ol>
          {q.type === "msq" && !answer && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <CheckButton disabled={!ready} onClick={() => check(draft)} />
              <span className="text-xs text-muted-foreground">Select all that apply.</span>
            </div>
          )}
        </>
      )}

      {answer && (
        <div
          ref={verdictRef}
          tabIndex={-1}
          className="mt-4 flex flex-col gap-3 border-t border-hairline pt-3"
        >
          <p className={`xp-verdict is-${answer.outcome}`} role="status">
            {answer.outcome === "correct" ? (
              <Check size={18} aria-hidden="true" />
            ) : (
              <X size={18} aria-hidden="true" />
            )}
            {answer.reason === "timeout"
              ? "Time is up"
              : answer.reason === "skipped"
                ? "Skipped"
                : VERDICT[answer.outcome]}
          </p>
          {q.type === "nat" && (
            <p className="flex flex-wrap gap-x-6 gap-y-1 text-sm tabular-nums">
              <span>
                Your answer:{" "}
                <strong>
                  {answer.response === null ? "Not answered" : String(answer.response)}
                </strong>
              </span>
              <span>
                Correct: <strong>{solution.answer.replace(":", " to ")}</strong>
                {solution.tolerance !== undefined ? ` ± ${solution.tolerance}` : ""}
              </span>
            </p>
          )}
          {solution.body.trim() && (
            <section aria-label="Solution">
              <ExamMarkdown source={solution.body} />
            </section>
          )}
        </div>
      )}
    </li>
  );
}

const OPTION_TONE = {
  open: "border-hairline hover:border-border hover:bg-accent/50",
  picked: "border-primary/50 bg-primary/5",
  correct: "border-lime-600/40 bg-lime-600/5 dark:border-lime-400/40",
  wrong: "border-destructive/40 bg-destructive/5",
  rest: "border-hairline opacity-70",
} as const;
const BADGE_TONE = {
  open: "bg-muted text-muted-foreground",
  picked: "bg-primary text-primary-foreground",
  correct: "bg-lime-600 text-white dark:bg-lime-500",
  wrong: "bg-destructive text-destructive-foreground",
  rest: "bg-muted text-muted-foreground",
} as const;

function CheckButton({ disabled, onClick }: { disabled: boolean; onClick?: () => void }) {
  return (
    <button
      type={onClick ? "button" : "submit"}
      disabled={disabled}
      onClick={onClick}
      className="flex h-9 items-center rounded-md bg-foreground px-3 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
    >
      Check answer
    </button>
  );
}
