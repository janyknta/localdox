import type { Ruleset } from "./schema.ts";

/** Browser-enforced minimum controls for every timed exam; authored stricter limits survive. */
export function enforceStrictExamRules(rules: Ruleset): Ruleset {
  return {
    ...rules,
    timing: { ...rules.timing, pausable: false, autoSubmitOnExpiry: true },
    navigation: { ...rules.navigation, requireSave: true },
    integrity: {
      ...rules.integrity,
      requireFullscreen: true,
      blockCopyPaste: true,
      blockContextMenu: true,
      maxTabSwitches: Math.min(rules.integrity.maxTabSwitches ?? 2, 2),
      onViolation:
        rules.integrity.onViolation === "autosubmit" ? "autosubmit" : "warn_then_autosubmit",
    },
  };
}
