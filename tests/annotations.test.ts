import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import {
  addHighlight,
  addNote,
  annotationBlock,
  annotationOffset,
  changeAnnotation,
  findAnnotation,
  parseAnnotations,
  removeAnnotation,
  stripAnnotations,
} from "../src/lib/markdown/annotations.ts";
import { remarkAnnotations } from "../src/lib/markdown/remark-annotations.ts";
import { remarkTasks } from "../src/lib/markdown/markdown-tasks.ts";
import { splitMarkdownSegments } from "../src/lib/markdown/markdown-segments.ts";
import { parseRows } from "../src/lib/search/rows.ts";

const span = (source: string, text: string, from = 0) => {
  const start = source.indexOf(text, from);
  assert.ok(start >= 0, `"${text}" not in source`);
  return { start, end: start + text.length };
};

test("parses notes and coloured highlights with labels, and finds each highlight's passage", () => {
  const source = [
    "# Light",
    "",
    "The light reactions make chemical energy.",
    "",
    "```yellownote Key idea",
    "chemical energy",
    "```",
    "",
    "```note",
    "ATP + **NADPH**",
    "```",
    "",
  ].join("\n");
  const [highlight, note] = parseAnnotations(source);
  assert.equal(highlight.kind, "highlight");
  assert.equal(highlight.color, "yellow");
  assert.equal(highlight.label, "Key idea");
  assert.equal(highlight.body, "chemical energy");
  assert.deepEqual(highlight.target, span(source, "chemical energy"));
  assert.equal(note.kind, "note");
  assert.equal(note.color, undefined);
  assert.equal(note.body, "ATP + **NADPH**");
  assert.equal(source.slice(note.bodySpan.start, note.bodySpan.end), note.body);
  assert.equal(source.slice(note.span.start, note.span.end), "```note\nATP + **NADPH**\n```");
});

test("ignores other fences, indented or quoted ones, and fences inside code", () => {
  const source = [
    "````md",
    "```note",
    "an example of the syntax",
    "```",
    "````",
    "",
    "  ```note",
    "  indented",
    "  ```",
    "",
    "> ```note",
    "> quoted",
    "> ```",
    "",
    "```notes",
    "not ours",
    "```",
    "",
    "```{yellow}note",
    "braces are not the syntax",
    "```",
  ].join("\n");
  assert.deepEqual(parseAnnotations(source), []);
});

test("a highlight's target is the nearest copy above it, outside notes, in its section", () => {
  const source = [
    "# One",
    "",
    "same words here",
    "",
    "# Two",
    "",
    "nothing",
    "",
    "```bluenote",
    "same words",
    "```",
    "",
    "same words again",
    "",
    "```note",
    "quoting same words",
    "```",
    "",
    "```greennote",
    "same words",
    "```",
  ].join("\n");
  const [orphan, , marked] = parseAnnotations(source);
  // The only copy above the first highlight is in another section.
  assert.equal(orphan.target, undefined);
  // The note's copy is closer, but a highlight never marks a note's text.
  const again = source.indexOf("same words again");
  assert.deepEqual(marked.target, { start: again, end: again + "same words".length });
});

test("an unclosed fence runs to the end and CRLF bodies keep exact offsets", () => {
  const unclosed = parseAnnotations("Text\n\n```note\nstill writing");
  assert.equal(unclosed[0].body, "still writing");
  const crlf = "Para one.\r\n\r\n```pinknote\r\nPara\r\n```\r\n";
  const [highlight] = parseAnnotations(crlf);
  assert.equal(highlight.body, "Para");
  assert.deepEqual(highlight.target, { start: 0, end: 4 });
});

test("the fence is longer than any fence inside the body, and labels stay on one line", () => {
  const block = annotationBlock({
    kind: "note",
    label: "with `ticks`\nand lines",
    body: "```js\ncode\n```",
  });
  assert.equal(block, "````note with ticks and lines\n```js\ncode\n```\n````");
  const [note] = parseAnnotations(`Intro\n\n${block}\n`);
  assert.equal(note.body, "```js\ncode\n```");
});

test("highlighting writes a fence after the passage's block and replaces overlapping marks", () => {
  const source = "Intro line.\n\nA long paragraph\nthat wraps lines.\n\nNext.\n";
  const first = addHighlight(source, span(source, "long paragraph"), "yellow")!;
  assert.equal(
    first.content,
    "Intro line.\n\nA long paragraph\nthat wraps lines.\n\n```yellownote\nlong paragraph\n```\n\nNext.\n",
  );
  assert.equal(first.content.slice(first.at, first.at + 13), "```yellownote");

  // Overlapping the first: it is replaced, not stacked.
  const second = addHighlight(first.content, span(first.content, "paragraph\nthat"), "pink", "x")!;
  const marks = parseAnnotations(second.content);
  assert.equal(marks.length, 1);
  assert.equal(marks[0].color, "pink");
  assert.equal(marks[0].body, "paragraph\nthat");
  assert.ok(second.content.endsWith("```pinknote x\nparagraph\nthat\n```\n\nNext.\n"));

  // A separate passage adds a second mark, after the first, in order.
  const third = addHighlight(second.content, span(second.content, "Intro"), "green")!;
  const all = parseAnnotations(third.content);
  assert.deepEqual(
    all.map((a) => [a.color, a.body, !!a.target]),
    [
      ["green", "Intro", true],
      ["pink", "paragraph\nthat", true],
    ],
  );
});

test("emphasis hugging the selection is taken in, so the stored passage stays balanced", () => {
  const source = "Some **bold words** here.\n";
  const { content } = addHighlight(source, span(source, "bold words"), "yellow")!;
  const [mark] = parseAnnotations(content);
  assert.equal(mark.body, "**bold words**");
  assert.deepEqual(mark.target, span(content, "**bold words**"));
});

test("a note never splits a list or a code block; headings end a block", () => {
  // What sits on either side of the insertion point.
  const around = (source: string, text: string) => {
    const at = annotationOffset(source, span(source, text).end);
    return [source.slice(0, at).trimEnd().split("\n").pop(), source.slice(at).trimStart()];
  };
  assert.deepEqual(around("1. one\n2. two\n\n3. three\n\nAfter.\n", "one"), [
    "3. three",
    "After.\n",
  ]);
  assert.deepEqual(around("- item\n\n  continued\n\nAfter.\n", "item"), [
    "  continued",
    "After.\n",
  ]);
  assert.deepEqual(around("```js\nconst a = 1;\n\nconst b = 2;\n```\nAfter.\n", "a = 1"), [
    "```",
    "After.\n",
  ]);
  assert.deepEqual(around("## Title\nBody text.\n", "Title"), ["## Title", "Body text.\n"]);
  assert.deepEqual(around("First.\n\nSecond.\n", "First"), ["First.", "Second.\n"]);
  assert.deepEqual(around("Para.\n\n```note\nn\n```\n\nNext.\n", "Para"), ["```", "Next.\n"]);
});

test("notes go after the passage, or at the end without one", () => {
  const source = "# Doc\n\nPassage.\n\nMore.";
  const placed = addNote(source, span(source, "Passage"), "My **note**")!;
  assert.equal(placed.content, "# Doc\n\nPassage.\n\n```note\nMy **note**\n```\n\nMore.");
  const appended = addNote(source, null, "At the end")!;
  assert.equal(appended.content, "# Doc\n\nPassage.\n\nMore.\n\n```note\nAt the end\n```\n");
  assert.equal(addNote(source, null, "  \n "), null);
});

test("change, remove, find and strip rewrite only the annotation's bytes", () => {
  const source = "A.\n\n```note\nfirst\n```\n\nB.\n\n```bluenote L\nB\n```\n";
  const [note, mark] = parseAnnotations(source);

  const edited = changeAnnotation(source, note, { body: "second" });
  assert.equal(edited, "A.\n\n```note\nsecond\n```\n\nB.\n\n```bluenote L\nB\n```\n");
  const recoloured = changeAnnotation(source, mark, { color: "orange", label: undefined });
  assert.ok(recoloured.endsWith("```orangenote\nB\n```\n"));

  assert.equal(removeAnnotation(source, note), "A.\n\nB.\n\n```bluenote L\nB\n```\n");
  assert.equal(removeAnnotation(source, mark), "A.\n\n```note\nfirst\n```\n\nB.\n");
  assert.equal(stripAnnotations(source), "A.\n\nB.\n");

  // Text added above moves it; finding it again uses kind, text and nearness.
  const moved = `Inserted.\n\n${source}`;
  const found = findAnnotation(moved, note)!;
  assert.equal(found.span.start, note.span.start + "Inserted.\n\n".length);
  assert.equal(findAnnotation(edited, note), null);
});

const render = (source: string) =>
  renderToStaticMarkup(
    createElement(
      Markdown,
      { remarkPlugins: [remarkGfm, remarkAnnotations, remarkTasks, remarkMath] },
      source,
    ),
  );

test("notes render as annotation cards with Markdown bodies; marked highlights render nothing", () => {
  const html = render(
    "Text with energy.\n\n```yellownote\nenergy\n```\n\n```note Label\n- [] task in a note\n- **bold**\n```\n\n```greennote\ngone\n```\n",
  );
  assert.ok(!html.includes("yellownote") && !html.includes("<code"), html);
  assert.match(html, /<docs-annotation data-kind="note" data-label="Label">/);
  assert.ok(html.includes("<strong>bold</strong>"), html);
  // The task box inside the note points at its line in the file.
  assert.ok(html.includes('data-task-line="7"'), html);
  // A highlight with no passage left shows as a card in its colour.
  assert.match(
    html,
    /<docs-annotation data-kind="highlight" data-color="green" data-orphan="true"><p>gone<\/p>/,
  );
});

test("segments never separate a passage from its annotations", () => {
  const filler = Array.from({ length: 400 }, (_, i) => `Paragraph ${i} with some text.\n`).join(
    "\n",
  );
  const source = `${filler}\nMarked passage.\n\n\`\`\`yellownote\nMarked passage\n\`\`\`\n\n${filler}`;
  const segments = splitMarkdownSegments(source);
  assert.ok(segments.sources.length > 1);
  const holder = segments.sources.find((s) => s.includes("```yellownote"))!;
  assert.ok(holder.includes("Marked passage.\n"), "fence and passage are in one segment");
});

test("search skips highlight fences and reads note bodies as Markdown", () => {
  const rows = parseRows(
    "Energy text.\n\n```yellownote\nEnergy\n```\n\n```note\n- **Bold** point\n```\n",
  );
  assert.deepEqual(
    rows.map((row) => row.text),
    ["Energy text.", "Bold point"],
  );
});
