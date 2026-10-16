import { useBlocker } from "@tanstack/react-router";
import { useId, useRef, useState } from "react";
import { Dropdown } from "@/components/ui/dropdown";
import { practiceRulesSchema, type PracticeRules } from "@/services/exams/practice-rules";

/** A small, explicit apply step keeps incomplete deadline edits from affecting a live question. */
export function PracticeControls({
  rules,
  ruleName,
  ruleOptions,
  onChooseRules,
  onSave,
  onEditRules,
  onNewRules,
}: {
  rules: PracticeRules;
  ruleName: string;
  ruleOptions: { value: string; label: string }[];
  onChooseRules?: (name: string) => void;
  onSave?: (rules: PracticeRules) => void;
  onEditRules?: () => void;
  onNewRules?: () => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(rules);
  const [limitInput, setLimitInput] = useState(String(rules.questionTimeLimitSeconds ?? 60));
  const candidate = {
    ...draft,
    pauseOnTabLeave: true,
    questionTimeLimitSeconds: draft.questionTimeLimitSeconds === null ? null : Number(limitInput),
  };
  const parsed = practiceRulesSchema.safeParse(candidate);
  const changed = JSON.stringify(candidate) !== JSON.stringify({ ...rules, pauseOnTabLeave: true });
  const leaving = useRef(false);
  useBlocker({
    enableBeforeUnload: () => !!onSave && changed,
    shouldBlockFn: ({ current, next }) =>
      !leaving.current &&
      !!onSave &&
      changed &&
      current.pathname !== next.pathname &&
      !window.confirm("Discard unsaved practice settings?"),
  });
  const discardDraft = () => !changed || window.confirm("Discard unsaved practice settings?");
  const toggle = (key: "showElapsedTime" | "showProgress", value: boolean) => {
    setDraft((s) => ({ ...s, [key]: value }));
  };
  const input = "min-h-10 w-full rounded-lg border border-input bg-background px-3 text-sm";
  const check = "size-4 shrink-0 accent-primary";
  return (
    <div className="space-y-5">
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (!parsed.success || !onSave || !changed) return;
          onSave(parsed.data);
        }}
      >
        <fieldset disabled={!onSave} className="grid min-w-0 gap-6 sm:grid-cols-2">
          <section className="space-y-3" aria-label="Practice timing settings">
            <h3 className="text-sm font-medium">Timing</h3>
            <label className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                className={check}
                checked={draft.questionTimeLimitSeconds !== null}
                onChange={(e) => {
                  setDraft((s) => ({
                    ...s,
                    questionTimeLimitSeconds: e.target.checked ? 60 : null,
                  }));
                }}
              />
              Set a question time limit
            </label>
            {draft.questionTimeLimitSeconds !== null ? (
              <div className="space-y-2 pl-7">
                <label htmlFor={`${id}-limit`} className="text-xs text-muted-foreground">
                  Seconds per question
                </label>
                <input
                  id={`${id}-limit`}
                  type="number"
                  min={1}
                  max={36000}
                  step={1}
                  className={input}
                  value={limitInput}
                  onChange={(e) => {
                    setLimitInput(e.target.value);
                  }}
                  required
                />
                <p className="text-xs leading-relaxed text-muted-foreground">
                  When time runs out, move to the next question. Go back to read the solution.
                </p>
              </div>
            ) : (
              <p className="pl-7 text-xs text-muted-foreground">Take as much time as you need.</p>
            )}
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                className={`${check} mt-0.5`}
                checked={draft.showElapsedTime}
                onChange={(e) => toggle("showElapsedTime", e.target.checked)}
              />
              <span>
                Show question timer
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                  A countdown stays visible when a time limit is set.
                </span>
              </span>
            </label>
          </section>
          <section className="space-y-3" aria-label="Practice focus settings">
            <h3 className="text-sm font-medium">Focus</h3>
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                className={`${check} mt-0.5`}
                checked={draft.showProgress}
                onChange={(e) => toggle("showProgress", e.target.checked)}
              />
              <span>
                Show progress bar
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                  A quiet indication of questions answered.
                </span>
              </span>
            </label>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Practice pauses automatically when you switch tabs, leave the window or open Settings,
              and resumes when you return. Time away doesn't count.
            </p>
          </section>
        </fieldset>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={!onSave || !changed || !parsed.success}
            className="min-h-10 rounded-full bg-foreground px-4 text-xs font-medium text-background disabled:opacity-40"
          >
            Save practice settings
          </button>
          {!parsed.success && (
            <span role="alert" className="text-xs text-destructive">
              Use a whole number from 1 to 36,000 seconds.
            </span>
          )}
        </div>
      </form>
      <div className="space-y-2 border-t border-hairline pt-4">
        <label htmlFor={`${id}-rules`} className="text-xs font-medium">
          Practice rules
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Dropdown
            id={`${id}-rules`}
            className="w-full sm:w-auto sm:min-w-48"
            value={ruleName}
            disabled={!onChooseRules}
            onValueChange={(value) => {
              if (discardDraft()) onChooseRules?.(value);
            }}
            options={ruleOptions}
          />
          {onEditRules && (
            <button
              type="button"
              className="min-h-10 rounded-full px-3 text-xs hover:bg-accent"
              onClick={onEditRules}
            >
              Edit rules
            </button>
          )}
          {onNewRules && (
            <button
              type="button"
              className="min-h-10 rounded-full px-3 text-xs hover:bg-accent"
              onClick={() => {
                if (discardDraft()) {
                  leaving.current = true;
                  onNewRules?.();
                }
              }}
            >
              New practice rules
            </button>
          )}
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {ruleName
            ? "Saved changes apply to practice files using these rules."
            : "Saving creates rules for this practice file."}
        </p>
      </div>
    </div>
  );
}
