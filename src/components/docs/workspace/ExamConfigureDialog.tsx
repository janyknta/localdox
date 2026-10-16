import { useEffect, useId, useMemo, useState } from "react";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dropdown } from "@/components/ui/dropdown";
import { Modal } from "@/components/ui/modal";
import type { MdFile } from "@/lib/markdown/markdown-utils";
import { rulesFileFor } from "@/services/exams/paper-plan";
import { parseXrule } from "@/services/exams/xrule";
import { parseExamFile } from "@/services/exams/parser";
import { gateMockXruleTemplate, xruleTemplate } from "@/services/exams/templates";
import {
  isRulesFile,
  rulesTag,
  rulesetTitle,
  withRulesTag,
  withoutRulesTag,
} from "@/services/exams/rules-tag";

export default function ExamConfigureDialog({
  file,
  files,
  folders,
  onSave,
  onAddRules,
  onEditRules,
  onClose,
}: {
  file: MdFile;
  files: MdFile[];
  folders: { id: string; parentId?: string | null }[];
  onSave: (fileId: string, content: string) => void;
  onAddRules: (
    name: string,
    content: string,
    folderId: string | null,
  ) => { id: string; name: string };
  onEditRules: (id: string) => void;
  onClose: () => void;
}) {
  const id = useId();
  const stem = file.name.replace(/\.xam$/i, "");
  const [chosen, setChosen] = useState(rulesTag(file.content) ?? "");
  const rulesets = files.filter((f) => !f.deletedAt && isRulesFile(f));
  const lookup = useMemo(
    () =>
      rulesFileFor(
        {
          ...file,
          content: chosen ? withRulesTag(file.content, chosen) : withoutRulesTag(file.content),
        },
        files,
        folders,
      ),
    [file, chosen, files, folders],
  );
  const effective = lookup.kind === "found" ? lookup.file : null;
  const parsed = useMemo(() => {
    try {
      const content = effective?.content ?? xruleTemplate(stem);
      return { setup: parseXrule(content, effective?.name), raw: JSON.parse(content) };
    } catch {
      return null;
    }
  }, [effective, stem]);
  const [duration, setDuration] = useState(parsed?.setup.durationMinutes ?? 30);
  const [pass, setPass] = useState(parsed?.setup.passPercentage ?? 70);
  const [attempts, setAttempts] = useState(parsed?.setup.maxAttempts ?? 3);
  const [error, setError] = useState("");
  useEffect(() => {
    setDuration(parsed?.setup.durationMinutes ?? 30);
    setPass(parsed?.setup.passPercentage ?? 70);
    setAttempts(parsed?.setup.maxAttempts ?? 3);
    setError("");
  }, [parsed]);
  const problem =
    lookup.kind === "ambiguous"
      ? "Several rulesets could apply. Choose one for this paper."
      : lookup.kind === "missing" && lookup.tagged
        ? `“${lookup.tagged}” is missing. Choose another ruleset.`
        : !parsed
          ? "This ruleset needs repair. Edit it in Settings → Exam rules."
          : null;
  const valid =
    !problem &&
    Number.isInteger(duration) &&
    duration >= 1 &&
    duration <= 600 &&
    Number.isFinite(pass) &&
    pass >= 0 &&
    pass <= 100 &&
    Number.isInteger(attempts) &&
    attempts >= 1 &&
    attempts <= 20;
  const changed =
    parsed &&
    (duration !== parsed.setup.durationMinutes ||
      pass !== parsed.setup.passPercentage ||
      attempts !== parsed.setup.maxAttempts);
  const attach = (content: string) => {
    const made = onAddRules(`${stem}.xrule`, content, null);
    onSave(file.id, withRulesTag(file.content, made.name));
    return made;
  };
  const commit = (forEditing = false) => {
    if (!valid || !parsed) return;
    if (changed || (forEditing && !effective)) {
      const raw = {
        ...parsed.raw,
        name: stem,
        durationMinutes: duration,
        passPercentage: pass,
        maxAttempts: attempts,
      };
      const content = JSON.stringify(raw, null, 2) + "\n";
      parseXrule(content); // Validate before creating a private ruleset.
      return attach(content).id;
    }
    onSave(file.id, chosen ? withRulesTag(file.content, chosen) : withoutRulesTag(file.content));
    return effective?.id;
  };
  const action = (run: () => void) => {
    try {
      run();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title="Configure exam"
      description={file.name}
      icon={<Settings2 className="h-4 w-4" />}
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!valid}
            onClick={() =>
              action(() => {
                commit();
                onClose();
              })
            }
          >
            Save configuration
          </Button>
        </>
      }
    >
      <div className="space-y-5 px-5 py-4">
        <div className="space-y-2">
          <label htmlFor={`${id}-rules`} className="text-sm font-medium">
            Ruleset
          </label>
          <Dropdown
            id={`${id}-rules`}
            aria-label="Exam ruleset"
            value={chosen}
            onValueChange={setChosen}
            options={[
              { value: "", label: "Automatic · folder rules or defaults" },
              ...(chosen && !rulesets.some((f) => f.name === chosen)
                ? [{ value: chosen, label: `${chosen} (missing)` }]
                : []),
              ...rulesets.map((f) => ({ value: f.name, label: `${rulesetTitle(f)} (${f.name})` })),
            ]}
          />
          <p className="text-xs text-muted-foreground">
            {effective
              ? `Using ${effective.name}.`
              : "Default rules apply when no ruleset is assigned by the folder."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!effective && !valid}
              onClick={() =>
                action(() => {
                  const target = !valid ? effective?.id : commit(true);
                  if (target) {
                    onClose();
                    onEditRules(target);
                  }
                })
              }
            >
              {changed || chosen !== (rulesTag(file.content) ?? "")
                ? "Save & edit ruleset"
                : "Edit ruleset"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                action(() => {
                  const made = attach(xruleTemplate(stem));
                  onClose();
                  onEditRules(made.id);
                })
              }
            >
              New ruleset
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                action(() => {
                  const paper = parseExamFile(file.content, file.name);
                  const content = gateMockXruleTemplate(stem, paper.questions.length);
                  parseXrule(content);
                  attach(content);
                  onClose();
                })
              }
            >
              Use GATE style
            </Button>
          </div>
        </div>
        {(problem || error) && (
          <p role="alert" className="text-sm text-destructive">
            {error || problem}
          </p>
        )}
        <fieldset disabled={!!problem} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="space-y-1.5 text-xs font-medium">
            Time limit (minutes)
            <input
              type="number"
              min={1}
              max={600}
              step={1}
              value={Number.isNaN(duration) ? "" : duration}
              onChange={(e) => setDuration(e.target.value === "" ? NaN : Number(e.target.value))}
              className="min-h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
            />
          </label>
          <label className="space-y-1.5 text-xs font-medium">
            Passing score (%)
            <input
              type="number"
              min={0}
              max={100}
              value={Number.isNaN(pass) ? "" : pass}
              onChange={(e) => setPass(e.target.value === "" ? NaN : Number(e.target.value))}
              className="min-h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
            />
          </label>
          <label className="space-y-1.5 text-xs font-medium">
            Maximum attempts
            <input
              type="number"
              min={1}
              max={20}
              step={1}
              value={Number.isNaN(attempts) ? "" : attempts}
              onChange={(e) => setAttempts(e.target.value === "" ? NaN : Number(e.target.value))}
              className="min-h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
            />
          </label>
        </fieldset>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Changing these values creates a ruleset for this paper. Shared rules stay available to
          other exams. Edit the ruleset for marking, calculator, sections, navigation and advanced
          settings.
        </p>
        <p className="rounded-lg bg-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          Rules apply before the first attempt. After an attempt, its paper and rules stay fixed;
          duplicate the paper to start with new settings.
        </p>
      </div>
    </Modal>
  );
}
