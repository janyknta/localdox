import { useState } from "react";
import { Dropdown } from "@/components/ui/dropdown";
import type { MdFile } from "@/lib/markdown/markdown-utils";
import { DEFAULT_PRACTICE_RULES } from "@/services/exams/practice-rules";
import { readPracticeFile } from "@/services/exams/practice";
import {
  loadPracticeAnswers,
  loadPracticeSession,
  managePracticeSession,
  practiceSignature,
} from "@/services/exams/practice-progress";
import {
  isRulesFile,
  rulesTag,
  rulesetTitle,
  withRulesTag,
  withoutRulesTag,
} from "@/services/exams/rules-tag";
import { practiceXruleTemplate } from "@/services/exams/templates";
import { xruleSchema } from "@/services/exams/xrule";
import { PracticeControls } from "./PracticeControls";

export function PracticeSettingsTab({
  files,
  fileId,
  onSelect,
  onSaveFile,
  onAddFile,
  onEditRules,
}: {
  files: MdFile[];
  fileId?: string;
  onSelect?: (id: string) => void;
  onSaveFile: (id: string, content: string) => void;
  onAddFile: (
    name: string,
    content: string,
    folderId: string | null,
  ) => { id: string; name: string };
  onEditRules?: (id: string) => void;
}) {
  const [, refresh] = useState(0);
  const practiceFiles = files.filter((f) => !f.deletedAt && f.kind === "practice");
  const file =
    practiceFiles.find((f) => f.id === fileId) ?? (!fileId ? practiceFiles[0] : undefined);
  if (!practiceFiles.length)
    return (
      <p className="text-sm text-muted-foreground">
        Open or create a practice file to configure its settings.
      </p>
    );
  const rulesets = files.filter((f) => !f.deletedAt && isRulesFile(f));
  const tag = file ? rulesTag(file.content) : null;
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
      ? `Practice rules “${tag}” were not found. Choose other rules below.`
      : !parsed?.success
        ? `Fix “${tag}” in Exam rules, or choose another ruleset.`
        : !rules
          ? `“${tag}” has no practice controls. Save practice settings to add them.`
          : null);
  let sheet: ReturnType<typeof readPracticeFile> | undefined;
  let sourceProblem = "";
  try {
    if (file) sheet = readPracticeFile(file.content, file.name);
  } catch (error) {
    sourceProblem = error instanceof Error ? error.message : String(error);
  }
  const answers = file ? loadPracticeAnswers(file.id) : {};
  const signature =
    sheet?.questions
      .map((q) => `${q.id}:${practiceSignature(q, sheet!.solutionFor[q.id])}`)
      .join(",") ?? "";
  const session = file ? loadPracticeSession(file.id, signature) : null;
  const completed =
    sheet?.questions.filter(
      (q) => answers[q.id]?.sig === practiceSignature(q, sheet!.solutionFor[q.id]),
    ).length ?? 0;
  const choose = (name: string) => {
    if (file)
      onSaveFile(file.id, name ? withRulesTag(file.content, name) : withoutRulesTag(file.content));
  };
  const action = (kind: "reset" | "end") => {
    if (!file) return;
    if (
      kind === "reset" &&
      !window.confirm("Clear practice answers and solve times, and start over?")
    )
      return;
    managePracticeSession(file.id, kind);
    refresh((n) => n + 1);
  };
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <label htmlFor="settings-practice-file" className="text-xs font-medium">
          Practice file
        </label>
        <Dropdown
          id="settings-practice-file"
          value={file?.id ?? ""}
          onValueChange={(id) => onSelect?.(id)}
          options={practiceFiles.map((f) => ({ value: f.id, label: f.name }))}
        />
      </div>
      {!file ? (
        <p role="alert" className="text-sm text-destructive">
          This practice file is not available. Choose another file.
        </p>
      ) : (
        <>
          {problem && (
            <p role="alert" className="text-xs leading-relaxed text-destructive">
              {problem}
            </p>
          )}
          <PracticeControls
            key={`${file.id}:${selected?.id ?? "default"}:${JSON.stringify(rules)}`}
            rules={rules ?? DEFAULT_PRACTICE_RULES}
            ruleName={tag ?? ""}
            ruleOptions={[
              { value: "", label: "Default · no time limit" },
              ...(tag && !selected ? [{ value: tag, label: `${tag} (missing)` }] : []),
              ...rulesets.map((f) => ({ value: f.name, label: rulesetTitle(f) })),
            ]}
            onChooseRules={choose}
            onSave={
              !tag || parsed?.success
                ? (next) => {
                    if (selected)
                      onSaveFile(
                        selected.id,
                        JSON.stringify(
                          { ...JSON.parse(selected.content), practice: next },
                          null,
                          2,
                        ) + "\n",
                      );
                    else {
                      const made = onAddFile(
                        "Practice.xrule",
                        JSON.stringify({ xrule: 1, name: "Practice", practice: next }, null, 2) +
                          "\n",
                        null,
                      );
                      choose(made.name);
                    }
                  }
                : undefined
            }
            onEditRules={selected && onEditRules ? () => onEditRules(selected.id) : undefined}
            onNewRules={() => {
              const made = onAddFile("Practice.xrule", practiceXruleTemplate("Practice"), null);
              choose(made.name);
              onEditRules?.(made.id);
            }}
          />
          <section
            className="space-y-3 border-t border-hairline pt-4"
            aria-label="Practice session settings"
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-medium">Session</h3>
              {sheet && (
                <span className="text-xs text-muted-foreground">
                  {completed} of {sheet.questions.length} answered
                </span>
              )}
            </div>
            {sourceProblem && (
              <p role="alert" className="text-xs text-destructive">
                Fix the practice questions before continuing.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="min-h-10 rounded-full border border-border px-4 text-xs hover:bg-accent"
                onClick={() => action("reset")}
              >
                Start over
              </button>
              {session && session.phase !== "ended" ? (
                <button
                  type="button"
                  className="min-h-10 rounded-full px-4 text-xs text-destructive hover:bg-destructive/5"
                  onClick={() => action("end")}
                >
                  End practice
                </button>
              ) : session?.phase === "ended" ? (
                <span role="status" className="self-center text-xs text-muted-foreground">
                  Practice ended
                </span>
              ) : null}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              End saves your progress. Start over clears answers, drafts and question times.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
