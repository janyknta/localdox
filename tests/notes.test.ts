// Notes: the clean copy of a selection, and the Notes list read out of the
// documents that keep notes and highlights (lib/markdown/annotations.ts).
//
// The DOM half of the clean copy is exercised against a small hand-built DOM
// (selection-markdown reads nodes through a structural interface for exactly
// this reason); the real-browser path is covered by tests/e2e/notes.spec.ts.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  selectionToMarkdown,
  type DomNodeLike,
  type SelectionBounds,
} from "../src/lib/markdown/selection-markdown.ts";
import {
  documentEntries,
  notebookEntries,
  pageOf,
  searchEntries,
} from "../src/lib/workspace/notes.ts";
import { notesToMarkdown } from "../src/lib/workspace/notes-markdown.ts";

// ---- a minimal DOM -----------------------------------------------------------

type FakeNode = DomNodeLike & { childNodes: FakeNode[]; parentNode: FakeNode | null };
type Child = FakeNode | string;

function text(data: string): FakeNode {
  return { nodeType: 3, nodeName: "#text", childNodes: [], parentNode: null, textContent: data };
}

function el(tag: string, attrs: Record<string, string | boolean> = {}, ...children: Child[]) {
  const node: FakeNode = {
    nodeType: 1,
    nodeName: tag.toUpperCase(),
    childNodes: [],
    parentNode: null,
    get textContent() {
      return this.childNodes.map((child) => child.textContent ?? "").join("");
    },
    getAttribute: (name) => {
      const value = attrs[name];
      return typeof value === "string" ? value : null;
    },
    checked: typeof attrs.checked === "boolean" ? attrs.checked : undefined,
  };
  for (const child of children) {
    const kid = typeof child === "string" ? text(child) : child;
    kid.parentNode = node;
    node.childNodes.push(kid);
  }
  return node;
}

function ancestors(node: FakeNode): FakeNode[] {
  const chain: FakeNode[] = [];
  for (let n: FakeNode | null = node; n; n = n.parentNode) chain.push(n);
  return chain;
}

/** A selection from (start, startOffset) to (end, endOffset), like a Range. */
function select(
  start: FakeNode,
  startOffset: number,
  end: FakeNode,
  endOffset: number,
): SelectionBounds {
  const up = new Set(ancestors(start));
  const common = ancestors(end).find((n) => up.has(n))!;
  return {
    startContainer: start,
    startOffset,
    endContainer: end,
    endOffset,
    commonAncestorContainer: common,
  };
}

/** Everything inside `root`. */
const all = (root: FakeNode) => select(root, 0, root, root.childNodes.length);

/** The first text node whose data contains `needle`. */
function textNode(root: FakeNode, needle: string): FakeNode {
  for (const child of root.childNodes) {
    if (child.nodeType === 3 && (child.textContent ?? "").includes(needle)) return child;
    if (child.nodeType === 1) {
      try {
        return textNode(child, needle);
      } catch {
        // keep looking
      }
    }
  }
  throw new Error(`no text node with “${needle}”`);
}

/** KaTeX's `htmlAndMathml` shape: visual spans plus MathML with the source. */
const katex = (latex: string, visual: string, display = false) =>
  el(
    display ? "div" : "span",
    { class: display ? "docs-math-block group" : "docs-math-inline" },
    el(
      "span",
      { class: "katex" },
      el(
        "span",
        { class: "katex-mathml" },
        el(
          "math",
          {},
          el(
            "semantics",
            {},
            el("mi", {}, visual),
            el("annotation", { encoding: "application/x-tex" }, latex),
          ),
        ),
      ),
      el("span", { class: "katex-html", "aria-hidden": "true" }, visual),
    ),
    ...(display ? [el("span", { class: "docs-math-number", "aria-hidden": "true" }, "(1)")] : []),
  );

/** The same equation after services/math/sanitize.ts: <semantics> and
 *  <annotation> are unwrapped, leaving the LaTeX as text inside <math>. */
const sanitizedKatex = (latex: string, visual: string) =>
  el(
    "span",
    { class: "docs-math-inline" },
    el(
      "span",
      { class: "katex" },
      el(
        "span",
        { class: "katex-mathml" },
        el("math", {}, el("mrow", {}, el("mi", {}, visual)), latex),
      ),
      el("span", { class: "katex-html", "aria-hidden": "true" }, visual),
    ),
  );

// ---- clean copy ----------------------------------------------------------------

test("clean copy keeps inline formatting, links and LaTeX source", () => {
  const p = el(
    "p",
    {},
    "Energy is ",
    el("strong", {}, "conserved"),
    ", see ",
    el("a", { href: "https://example.com/e" }, "the proof"),
    " and ",
    el("code", {}, "E"),
    ": ",
    katex("E = mc^2", "E=mc2"),
    ". Also ",
    el("em", {}, "notably "),
    "this.",
  );
  const root = el("div", {}, p);
  assert.equal(
    selectionToMarkdown(all(root), root),
    "Energy is **conserved**, see [the proof](https://example.com/e) and `E`: $E = mc^2$. Also *notably* this.",
  );
});

test("LaTeX is recovered from sanitized KaTeX output, where the annotation is bare text", () => {
  const root = el("div", {}, el("p", {}, "So ", sanitizedKatex("E = mc^2", "E=mc2"), " holds."));
  assert.equal(selectionToMarkdown(all(root), root), "So $E = mc^2$ holds.");
});

test("viewer chrome — copy buttons, fold toggles, stars, equation numbers — is dropped", () => {
  const root = el(
    "div",
    {},
    el(
      "h2",
      { id: "setup" },
      el("button", { "aria-label": "Fold section" }, el("svg", {}, "▾")),
      "Setup",
      el("button", {}, "★"),
    ),
    el(
      "div",
      { class: "group relative my-6" },
      el("button", { "aria-label": "Copy code" }, "Copy"),
      el(
        "pre",
        {},
        el(
          "code",
          { class: "hljs language-ts" },
          el("span", { class: "hljs-keyword" }, "const"),
          " a = 1;\n",
        ),
      ),
    ),
    katex("\\int_0^1 x\\,dx", "∫01xdx", true),
    el("div", { "data-viewer-ui": "" }, "Inspect"),
  );
  assert.equal(
    selectionToMarkdown(all(root), root),
    "## Setup\n\n```ts\nconst a = 1;\n```\n\n$$\n\\int_0^1 x\\,dx\n$$",
  );
});

test("lists keep nesting, numbering and task boxes", () => {
  const root = el(
    "div",
    {},
    el(
      "ul",
      {},
      el("li", {}, el("input", { type: "checkbox", checked: true }), " shipped"),
      el("li", {}, el("input", { type: "checkbox", checked: false }), " pending"),
      el(
        "li",
        {},
        "steps",
        el("ol", { start: "3" }, el("li", {}, "third"), el("li", {}, "fourth")),
      ),
    ),
  );
  assert.equal(
    selectionToMarkdown(all(root), root),
    "- [x] shipped\n- [ ] pending\n- steps\n  3. third\n  4. fourth",
  );
});

test("a table selection keeps its header, even when the selection starts below it", () => {
  const table = el(
    "table",
    {},
    el("thead", {}, el("tr", {}, el("th", {}, "Name"), el("th", {}, "Value"))),
    el(
      "tbody",
      {},
      el("tr", {}, el("td", {}, "alpha"), el("td", {}, "1")),
      el("tr", {}, el("td", {}, "beta | gamma"), el("td", {}, "2")),
      el("tr", {}, el("td", {}, "delta"), el("td", {}, "3")),
    ),
  );
  const root = el("div", {}, el("div", { class: "docs-table-wrap" }, table));
  // From inside "beta" to the end of "2": one body row, two cells.
  const bounds = select(textNode(root, "beta"), 0, textNode(root, "2"), 1);
  assert.equal(
    selectionToMarkdown(bounds, root),
    "| Name | Value |\n| --- | --- |\n| beta \\| gamma | 2 |",
  );
  // Inside a single cell, it is just text.
  assert.equal(
    selectionToMarkdown(select(textNode(root, "delta"), 1, textNode(root, "delta"), 4), root),
    "elt",
  );
});

test("partial selections clip text, and any part of code or math brings the structure", () => {
  const code = el("pre", {}, el("code", { class: "language-py" }, "print('hi')\nx = 1\n"));
  const math = katex("a^2 + b^2", "a2+b2");
  const root = el(
    "div",
    {},
    el("p", {}, "The quick brown fox"),
    code,
    el("p", {}, "Inline ", math, " here"),
  );
  assert.equal(
    selectionToMarkdown(select(textNode(root, "quick"), 4, textNode(root, "quick"), 15), root),
    "quick brown",
  );
  // One token inside a code block is still code.
  const token = textNode(code, "print");
  assert.equal(selectionToMarkdown(select(token, 0, token, 5), root), "```py\nprint\n```");
  // Three glyphs from the middle of an equation are the equation.
  const glyphs = math.childNodes[0].childNodes[1].childNodes[0];
  assert.equal(selectionToMarkdown(select(glyphs, 1, glyphs, 3), root), "$a^2 + b^2$");
  // A selection spanning paragraphs, ending inside the equation.
  assert.equal(
    selectionToMarkdown(select(textNode(root, "fox"), 16, glyphs, 2), root),
    "fox\n\n```py\nprint('hi')\nx = 1\n```\n\nInline $a^2 + b^2$",
  );
});

test("element boundary points select whole children, as a Range does", () => {
  const list = el("ul", {}, el("li", {}, "one"), el("li", {}, "two"), el("li", {}, "three"));
  const root = el("div", {}, list);
  assert.equal(selectionToMarkdown(select(list, 1, list, 3), root), "- two\n- three");
});

test("callouts, quotes, images and fences that contain backticks", () => {
  const root = el(
    "div",
    {},
    el(
      "aside",
      { class: "docs-callout", "data-tone": "info" },
      el("span", { class: "docs-callout-mark", "aria-hidden": "true" }, el("svg", {})),
      el(
        "div",
        { class: "docs-callout-body" },
        el("p", { class: "docs-callout-label" }, "Note"),
        el("p", {}, "Check the units."),
      ),
    ),
    el("blockquote", {}, el("p", {}, "Quoted"), el("p", {}, "twice")),
    el(
      "p",
      {},
      el("img", { src: "https://example.com/a.png", alt: "Chart" }),
      " ",
      el("img", { src: "blob:local/123", alt: "Local scan" }),
    ),
    el("pre", {}, el("code", {}, "```md\nfenced\n```")),
    el("p", {}, el("code", {}, "a `tick`")),
  );
  assert.equal(
    selectionToMarkdown(all(root), root),
    [
      "> [!NOTE]\n> Check the units.",
      "> Quoted\n>\n> twice",
      "![Chart](https://example.com/a.png) Local scan",
      "````\n```md\nfenced\n```\n````",
      "`` a `tick` ``",
    ].join("\n\n"),
  );
});

test("an equation that failed or is still typesetting copies its source", () => {
  const root = el(
    "div",
    {},
    el(
      "div",
      { class: "docs-math-error" },
      el("span", { class: "docs-math-error-badge" }, "LaTeX error"),
      el("pre", { class: "docs-math-source" }, "\\frac{1}{"),
    ),
    el("p", {}, "Pending ", el("code", { class: "docs-math-pending" }, "x_1"), "."),
  );
  assert.equal(selectionToMarkdown(all(root), root), "$$\n\\frac{1}{\n$$\n\nPending $x_1$.");
});

test("a selection of nothing convertible is empty, so the caller can fall back", () => {
  const root = el("div", {}, el("div", { class: "docs-mermaid" }, el("svg", {}, "A --> B")));
  assert.equal(selectionToMarkdown(all(root), root), "");
});

// ---- the snapshot model ----------------------------------------------------------

// ---- the Notes list ------------------------------------------------------------

const DOC = [
  "# Install",
  "",
  "Run the installer once.",
  "",
  "```yellownote Setup",
  "installer",
  "```",
  "",
  "# Configure",
  "",
  "Set the output directory.",
  "",
  "```note",
  "Use **dist/** for builds.",
  "```",
].join("\n");

const doc = (id: string, content: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: `${id}.md`,
  content,
  ...extra,
});

test("entries come from the documents, by file order then place, with stable ids", () => {
  const entries = notebookEntries([
    doc("b", DOC),
    doc("pdf", "```note\nnot markdown\n```", { kind: "pdf" }),
    doc("binned", "```note\nin the bin\n```", { deletedAt: 1 }),
    doc("a", "Plain.\n\n```note\nsecond file\n```\n"),
  ]);
  assert.deepEqual(
    entries.map((e) => [e.id, e.kind, e.body]),
    [
      ["b#0", "highlight", "installer"],
      ["b#1", "note", "Use **dist/** for builds."],
      ["a#0", "note", "second file"],
    ],
  );
  assert.equal(entries[0].color, "yellow");
  assert.equal(entries[0].label, "Setup");
  assert.ok(entries[0].target, "the highlight found its passage");
});

test("an unchanged document is read once; an edited one again", () => {
  const first = documentEntries("cached", DOC);
  assert.equal(documentEntries("cached", DOC), first);
  const edited = documentEntries("cached", `${DOC}\n\n\`\`\`note\nmore\n\`\`\`\n`);
  assert.notEqual(edited, first);
  assert.equal(edited.length, 3);
});

test("search matches every word across text, label, document name and page", () => {
  const entries = notebookEntries([doc("guide", DOC)]);
  const name = (id: string) => (id === "guide" ? "Setup guide.md" : undefined);
  const file = doc("guide", DOC);
  const section = (e: (typeof entries)[number]) => pageOf(file, e.span.start)?.title;
  const ids = (query: string) => searchEntries(entries, query, name, section).map((e) => e.id);
  assert.deepEqual(ids(""), ["guide#0", "guide#1"]);
  assert.deepEqual(ids("dist builds"), ["guide#1"]);
  assert.deepEqual(ids("setup installer"), ["guide#0"]);
  assert.deepEqual(ids("configure"), ["guide#1"]);
  assert.deepEqual(ids("guide.md"), ["guide#0", "guide#1"]);
  assert.deepEqual(ids("missing"), []);
});

test("an entry's page is the section its fence sits in", () => {
  const file = doc("guide", DOC);
  const [mark, note] = notebookEntries([file]);
  assert.equal(pageOf(file, mark.target!.start)?.title, "Install");
  assert.equal(pageOf(file, note.span.start)?.title, "Configure");
});

test("the merged notes file is every entry's Markdown, in list order", () => {
  const entries = notebookEntries([doc("guide", DOC)]);
  assert.equal(notesToMarkdown(entries), "installer\n\nUse **dist/** for builds.\n");
  assert.equal(notesToMarkdown([]), "");
});
