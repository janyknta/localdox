import assert from "node:assert/strict";
import { test } from "node:test";
import { unified } from "unified";
import remarkParse from "remark-parse";
import {
  scanNoteLinks,
  noteAliases,
  resolveNoteLink,
  noteTargetSpan,
  noteEmbedContent,
  rewriteNoteLinks,
  NoteLinkIndex,
  NOTE_URL_PREFIX,
} from "../src/lib/markdown/note-links.ts";
import { remarkNoteLinks } from "../src/lib/markdown/remark-note-links.ts";
import type { PersistedFile, FolderRecord } from "../src/lib/workspace/persistence.ts";
const file = (
  id: string,
  name: string,
  content = "",
  folderId: string | null = null,
): PersistedFile => ({ id, name, content, folderId });
const folders: FolderRecord[] = [
  { id: "a", name: "Course", createdAt: 1 },
  { id: "b", name: "Other", createdAt: 1 },
];

test("scan real links with spans, excluding code, comments, escapes, math and external URLs", () => {
  const source =
    "[[Concept#Details|meaning]] ![[Concept#^proof]] [normal](Concept.md#Details) [web](https://example.com)\n`[[code]]` \\[[escaped]] $[[math]]$ <!-- [[comment]] -->\n~~~md\n[[fenced]]\n~~~\n    [[indented]]\n";
  const links = scanNoteLinks(source);
  assert.deepEqual(
    links.map((l) => [l.reference, l.embed]),
    [
      ["Concept#Details", false],
      ["Concept#^proof", true],
      ["Concept.md#Details", false],
    ],
  );
  assert.equal(source.slice(links[0].targetFrom, links[0].targetTo), "Concept#Details");
  assert.equal(source.slice(links[2].targetFrom, links[2].targetTo), "Concept.md#Details");
});

test("resolve names, paths, aliases, local fragments and ambiguity without selecting an arbitrary file", () => {
  const source = file("s", "Source.md");
  const first = file("t", "Concept.md", "---\naliases: [\"Idea\", 'Thinking']\n---\n", "a");
  const second = file("u", "Concept.md", "", "b");
  assert.equal(
    resolveNoteLink("Concept", source, [source, first, second], folders).status,
    "ambiguous",
  );
  assert.equal(
    resolveNoteLink("Course/Concept#Details", source, [source, first, second], folders).status,
    "found",
  );
  const alias = resolveNoteLink("Idea", source, [source, first, second], folders);
  assert.equal(alias.status === "found" && alias.file.id, "t");
  assert.equal(resolveNoteLink("#Details", source, [source], folders).status, "found");
  assert.equal(
    resolveNoteLink("Concept", { ...source, folderId: "a" }, [source, first, second], folders)
      .status,
    "found",
  );
  assert.equal(
    resolveNoteLink("Concept", source, [source, { ...first, deletedAt: 2 }], folders).status,
    "missing",
  );
  assert.deepEqual(noteAliases("---\naliases:\n  - First\n  - 'Second idea'\n---\n"), [
    "First",
    "Second idea",
  ]);
});

test("heading and block spans support duplicate slugs and bounded transclusion", () => {
  const source =
    "# Guide\n\n## Details\n\nA proof. ^proof\n\n### Child\n\nChild body.\n\n## Details\n\nSecond.\n\n## Last\n\nA multi-line\nblock.\n^block\n";
  const span = noteTargetSpan(source, "^proof")!;
  assert.equal(source.slice(span.start, span.end), "A proof.");
  assert.equal(
    source.slice(noteTargetSpan(source, "details-1")!.start).startsWith("## Details\n\nSecond."),
    true,
  );
  assert.equal(
    noteEmbedContent(source, "Details"),
    "## Details\n\nA proof. ^proof\n\n### Child\n\nChild body.",
  );
  assert.equal(noteEmbedContent(source, "^block"), "A multi-line\nblock.");
  assert.equal(noteEmbedContent(source, "missing"), null);
  assert.equal(
    noteEmbedContent("# Heading\n\nFirst line\nSecond line. ^multi\n\nNext block.", "^multi"),
    "First line\nSecond line.",
  );
});

test("rename repairs Markdown/wiki links and embeds while preserving aliases, fragments and code", () => {
  const content =
    "[[Concept#Details|read]] ![[Concept#^proof]] [read](Concept.md#Details)\n`[[Concept]]`";
  const before = [file("s", "Source.md", content), file("t", "Concept.md")];
  const after = rewriteNoteLinks(
    before,
    [before[0], { ...before[1], name: "New name.md" }],
    [],
    [],
  );
  assert.equal(
    after[0].content,
    "[[/New name#Details|read]] ![[/New name#^proof]] [read](New%20name.md#Details)\n`[[Concept]]`",
  );
  assert.equal(before[0].content, content);
});

test("moving a source repairs its outgoing relative links; folder rename repairs inbound paths", () => {
  const before = [
    file("s", "Source.md", "[read](Concept.md)", "a"),
    file("t", "Concept.md", "", "a"),
    file("i", "Index.md", "[[Course/Concept]]"),
  ];
  const moved = rewriteNoteLinks(
    before,
    before.map((f) => (f.id === "s" ? { ...f, folderId: "b" } : f)),
    folders,
    folders,
  );
  assert.equal(moved[0].content, "[read](../Course/Concept.md)");
  const renamed = rewriteNoteLinks(
    before,
    before,
    folders,
    folders.map((f) => (f.id === "a" ? { ...f, name: "Physics" } : f)),
  );
  assert.equal(renamed[2].content, "[[/Physics/Concept]]");
  assert.equal(renamed[0].content, before[0].content);
});

test("reference-style links index each occurrence and rename their shared definition once", () => {
  const content =
    '[first][concept] [concept][] and [concept].\n\n[concept]: <Concept.md#Details> "Title"\n';
  const before = [file("s", "Source.md", content), file("t", "Concept.md")];
  assert.equal(scanNoteLinks(content).length, 3);
  const after = rewriteNoteLinks(
    before,
    [before[0], { ...before[1], name: "New name.md" }],
    [],
    [],
  );
  assert.equal(after[0].content, content.replace("Concept.md#Details", "New%20name.md#Details"));
});

test("formatted and Setext headings resolve and bound embeds", () => {
  const content =
    "# `Code` **heading**\r\n\r\nSubtitle\r\n---\r\n\r\nBody.\r\n\r\n## Next\r\n\r\nUnrelated.";
  assert.equal(noteTargetSpan(content, "code-heading")?.start, 0);
  assert.equal(noteEmbedContent(content, "Subtitle"), "Subtitle\r\n---\r\n\r\nBody.");
});

test("index follows edited links, aliases, renames and deletions", () => {
  const index = new NoteLinkIndex();
  const source = file("s", "Source.md", "[[Idea]] [[Missing]]");
  const target = file("t", "Concept.md", "---\naliases: Idea\n---\n");
  assert.deepEqual(
    index.update([source, target]).map((l) => l.status),
    ["found", "missing"],
  );
  assert.deepEqual(
    index.update([source, { ...target, content: "" }]).map((l) => l.status),
    ["missing", "missing"],
  );
  assert.deepEqual(
    index.update([{ ...source, content: "[[Concept]]" }, target]).map((l) => l.targetId),
    ["t"],
  );
  assert.equal(index.update([{ ...source, deletedAt: 2 }, target]).length, 0);
});

test("remark renders wiki links without changing source or linking escaped/code text", () => {
  const source = "Text [[Concept#Details|meaning]] then \\[[escaped]] and `[[code]]`.";
  const processor = unified().use(remarkParse).use(remarkNoteLinks);
  const result = processor.runSync(processor.parse(source), { value: source }) as any;
  const nodes = result.children[0].children;
  const links = nodes.filter((node: any) => node.type === "link");
  assert.equal(links.length, 1);
  assert.equal(links[0].url, NOTE_URL_PREFIX + encodeURIComponent("Concept#Details"));
  assert.equal(links[0].children[0].value, "meaning");
});
