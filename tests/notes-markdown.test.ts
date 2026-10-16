import assert from "node:assert/strict";
import { test } from "node:test";
import { notesToMarkdown } from "../src/lib/workspace/notes-markdown.ts";
import { notebookEntries } from "../src/lib/workspace/notes.ts";

const entries = (content: string) => notebookEntries([{ id: "doc", content }]);

test("merges content in card order without generated headings, metadata, or separators", () => {
  const markdown = notesToMarkdown(
    entries(
      [
        "A *literal* passage.",
        "",
        "```bluenote [label]",
        "*literal*",
        "```",
        "",
        "````note",
        "**Bold**",
        "",
        "$$x^2$$",
        "",
        "```mermaid",
        "graph TD",
        "A --> B",
        "```",
        "````",
        "",
        "```note",
        "    indented code",
        "```",
      ].join("\n"),
    ),
  );
  // A highlight is the passage's own source, so its Markdown means the same.
  assert.equal(
    markdown,
    "*literal*\n\n**Bold**\n\n$$x^2$$\n\n```mermaid\ngraph TD\nA --> B\n```\n\n    indented code\n",
  );
});

test("an empty notebook produces no content", () => {
  assert.equal(notesToMarkdown([]), "");
  assert.equal(notesToMarkdown(entries("No notes here.\n\n```js\ncode\n```\n")), "");
});
