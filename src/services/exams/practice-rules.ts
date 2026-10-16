import { z } from "zod";

/** Practice is unscored and shows one question at a time. These are its optional controls. */
export const practiceRulesSchema = z
  .object({
    questionTimeLimitSeconds: z.number().int().min(1).max(36000).nullable().default(null),
    showElapsedTime: z.boolean().default(true),
    // Accepted for older rule files. Practice navigation is always free; answers reveal solutions.
    allowSkip: z.boolean().default(true),
    showProgress: z.boolean().default(true),
    // Accepted for older files; focus/visibility changes always pause practice.
    pauseOnTabLeave: z.boolean().default(true),
  })
  .strict();

export type PracticeRules = z.infer<typeof practiceRulesSchema>;
export const DEFAULT_PRACTICE_RULES = practiceRulesSchema.parse({});

export function practiceFacts(rules: PracticeRules): string[] {
  return [
    "One question at a time",
    rules.questionTimeLimitSeconds === null
      ? "No time limit"
      : `${rules.questionTimeLimitSeconds}s per question · auto-advance`,
  ];
}
