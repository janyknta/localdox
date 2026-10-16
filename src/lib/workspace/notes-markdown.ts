import type { NotebookEntry } from "./notes.ts";

/**
 * The whole Notes tab as continuous content, in the same order as its cards.
 * A note is its own Markdown; a highlight is the source text it marks.
 */
export function notesToMarkdown(entries: readonly NotebookEntry[]): string {
  const content = entries
    // Preserve Markdown, including indentation for code blocks.
    .map((entry) => entry.body.replace(/^\n+/, "").trimEnd())
    .filter((section) => section.trim())
    .join("\n\n");
  return content ? content + "\n" : "";
}
