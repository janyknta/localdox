// Highlights and notes, kept in the document's own Markdown.
//
// A reader's highlights and notes used to live beside the document, in arrays
// on the workspace record. They are now part of the file, the way checkboxes
// are (markdown-tasks.ts): the source is the state, and every change rewrites
// only the bytes of one fenced block. A copied or downloaded file carries them,
// and the browser stores nothing extra.
//
//     The light reactions convert light into chemical energy.
//
//     ```yellownote Key idea
//     chemical energy
//     ```
//
//     ```note
//     Light reactions → ATP + NADPH, used by the Calvin cycle.
//     ```
//
// - ```` ```note ```` is a note: Markdown of the reader's own, shown as a card
//   where it sits (right after the passage it was taken from).
// - ```` ```<colour>note ```` is a highlight: its body is the exact source text
//   it marks. The reader paints the nearest copy of that text *above* the fence
//   (its `target`) and hides the fence. If the text has been edited away, the
//   fence has no target and is shown as a card in its colour instead, so a
//   highlight is never lost silently.
// - Anything after the info word is the label: ```` ```bluenote Definition ````.
//
// Only unindented fences count. Inside a code block, a list or a quote, the
// same text is ordinary code, so a document can still show the syntax.

import type { SourceSpan } from "./source-address.ts";

/** Highlight colours, named in the fence. Order and values match the palette. */
export const ANNOTATION_COLORS = [
  { name: "yellow", hex: "#fde047" },
  { name: "green", hex: "#86efac" },
  { name: "blue", hex: "#93c5fd" },
  { name: "pink", hex: "#f9a8d4" },
  { name: "orange", hex: "#fdba74" },
  { name: "purple", hex: "#d8b4fe" },
] as const;

export type AnnotationColor = (typeof ANNOTATION_COLORS)[number]["name"];
export type AnnotationKind = "note" | "highlight";

export const colorHex = (color: AnnotationColor | undefined) =>
  ANNOTATION_COLORS.find((c) => c.name === color)?.hex ?? ANNOTATION_COLORS[0].hex;

export interface Annotation {
  kind: AnnotationKind;
  /** Highlights only. */
  color?: AnnotationColor;
  label?: string;
  /** The text between the fences: a note's Markdown, or a highlight's passage. */
  body: string;
  /** The whole block, from the opening fence to the end of the closing one. */
  span: SourceSpan;
  /** Where `body` sits in the file. */
  bodySpan: SourceSpan;
  /** A highlight's passage: the nearest copy of `body` above the fence. */
  target?: SourceSpan;
}

/** A highlight or note the reader just wrote; `at` is where its fence starts. */
export interface AnnotationEvent {
  kind: AnnotationKind;
  fileId: string;
  at: number;
}

/** Longest note the app writes. A select-all on a huge document stays bounded. */
export const MAX_NOTE_CHARS = 200_000;

const COLOR_NAMES = ANNOTATION_COLORS.map((c) => c.name).join("|");
const INFO_WORD = new RegExp(`^(?:(${COLOR_NAMES}))?note$`, "i");
/** Cheap pre-check, so documents without annotations skip the line scan. */
const MAYBE = new RegExp(`^(?:\`{3,}|~{3,})[ \\t]*(?:${COLOR_NAMES})?note\\b`, "im");
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/;
const LIST_ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;

/** The kind and colour an info string names, or null for any other fence. */
export function annotationInfo(
  info: string,
): { kind: AnnotationKind; color?: AnnotationColor; label?: string } | null {
  const trimmed = info.trim();
  const word = /^\S*/.exec(trimmed)![0];
  const match = INFO_WORD.exec(word);
  if (!match) return null;
  const label = trimmed.slice(word.length).trim() || undefined;
  const color = match[1]?.toLowerCase() as AnnotationColor | undefined;
  return color ? { kind: "highlight", color, label } : { kind: "note", label };
}

/** Whether a line opens an annotation: an unindented fence naming one. */
export function isAnnotationFence(line: string): boolean {
  const fence = /^(`{3,}|~{3,})(.*)$/.exec(line);
  return !!fence && !(fence[1][0] === "`" && fence[2].includes("`")) && !!annotationInfo(fence[2]);
}

interface Line {
  start: number;
  /** End of the line's text, before `\r\n` or `\n`. */
  end: number;
  text: string;
}

function linesOf(source: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  for (;;) {
    const newline = source.indexOf("\n", start);
    const stop = newline < 0 ? source.length : newline;
    const end = stop > start && source[stop - 1] === "\r" ? stop - 1 : stop;
    lines.push({ start, end, text: source.slice(start, end) });
    if (newline < 0) return lines;
    start = newline + 1;
  }
}

interface Scan {
  lines: Line[];
  annotations: Annotation[];
  /** Per line: inside a fenced block, its opening or closing line included. */
  fenced: boolean[];
  /** Per line: closes a fenced block. */
  closes: boolean[];
  /** Line starts of headings outside fences. */
  headings: number[];
}

function scan(source: string): Scan {
  const lines = linesOf(source);
  const annotations: Annotation[] = [];
  const fenced: boolean[] = [];
  const closes: boolean[] = [];
  const headings: number[] = [];
  let open: {
    char: string;
    length: number;
    start: number;
    bodyStart: number;
    info: ReturnType<typeof annotationInfo>;
  } | null = null;

  const finish = (bodyEnd: number, end: number) => {
    if (!open?.info) return;
    const bodyStart = Math.min(open.bodyStart, bodyEnd);
    annotations.push({
      ...open.info,
      body: source.slice(bodyStart, bodyEnd),
      span: { start: open.start, end },
      bodySpan: { start: bodyStart, end: bodyEnd },
    });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (open) {
      fenced.push(true);
      const close = FENCE_CLOSE.exec(line.text);
      const shut = !!close && close[1][0] === open.char && close[1].length >= open.length;
      closes.push(shut);
      if (shut) {
        // The body ends before the line break that precedes the closing fence.
        const before = lines[i - 1];
        finish(before && before.start >= open.bodyStart ? before.end : open.bodyStart, line.end);
        open = null;
      }
      continue;
    }
    const fence = FENCE_OPEN.exec(line.text);
    if (fence && !(fence[1][0] === "`" && fence[2].includes("`"))) {
      fenced.push(true);
      closes.push(false);
      const next = lines[i + 1];
      open = {
        char: fence[1][0],
        length: fence[1].length,
        start: line.start,
        bodyStart: next ? next.start : line.end,
        // Only an unindented fence is an annotation.
        info: line.text.startsWith(fence[1]) ? annotationInfo(fence[2]) : null,
      };
      continue;
    }
    fenced.push(false);
    closes.push(false);
    if (HEADING.test(line.text)) headings.push(line.start);
  }
  // An unclosed fence runs to the end of the document, as in CommonMark.
  if (open) {
    const last = lines[lines.length - 1];
    finish(last.start >= open.bodyStart ? last.end : open.bodyStart, source.length);
  }
  return { lines, annotations, fenced, closes, headings };
}

/**
 * The nearest copy of a highlight's text above its fence, in the same section,
 * and not inside another annotation (a note quoting the same words).
 */
function findTarget(
  source: string,
  annotation: Annotation,
  all: Annotation[],
  headings: number[],
): SourceSpan | undefined {
  const needle = annotation.body.trim();
  if (!needle) return undefined;
  let floor = 0;
  for (const heading of headings) {
    if (heading >= annotation.span.start) break;
    floor = heading;
  }
  let from = annotation.span.start - needle.length;
  while (from >= floor) {
    const at = source.lastIndexOf(needle, from);
    if (at < floor) return undefined;
    const end = at + needle.length;
    const inside = all.find((other) => at < other.span.end && end > other.span.start);
    if (!inside) return { start: at, end };
    from = Math.min(at - 1, inside.span.start - needle.length);
  }
  return undefined;
}

/** Every annotation in the document, in source order, highlights with their targets. */
export function parseAnnotations(source: string): Annotation[] {
  if (!MAYBE.test(source)) return [];
  const { annotations, headings } = scan(source);
  for (const annotation of annotations) {
    if (annotation.kind === "highlight")
      annotation.target = findTarget(source, annotation, annotations, headings);
  }
  return annotations;
}

// ---- writing ------------------------------------------------------------------

const cleanLabel = (label: string | undefined) =>
  label
    ?.replace(/[`\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200) || undefined;

/** The Markdown for one annotation, with a fence longer than any inside it. */
export function annotationBlock(annotation: {
  kind: AnnotationKind;
  color?: AnnotationColor;
  label?: string;
  body: string;
}): string {
  const body = annotation.body.replace(/^(?:[ \t]*\r?\n)+/, "").trimEnd();
  let longest = 0;
  for (const run of body.matchAll(/^ {0,3}(`{3,})/gm)) longest = Math.max(longest, run[1].length);
  const fence = "`".repeat(Math.max(3, longest + 1));
  const word = annotation.kind === "highlight" ? `${annotation.color ?? "yellow"}note` : "note";
  const label = cleanLabel(annotation.label);
  return `${fence}${word}${label ? ` ${label}` : ""}\n${body ? `${body}\n` : ""}${fence}`;
}

export interface TextEdit {
  start: number;
  end: number;
  text: string;
}

/** Non-overlapping edits, all in the original's offsets, applied in one pass. */
export function applyEdits(source: string, edits: readonly TextEdit[]): string {
  let out = source;
  for (const edit of [...edits].sort((a, b) => b.start - a.start))
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  return out;
}

/**
 * `block` as a paragraph of its own at `offset` (a line start, or the end):
 * one blank line on each side, without doubling blank lines already there.
 */
function placeBlock(source: string, offset: number, block: string): TextEdit & { at: number } {
  let start = offset;
  while (start > 0 && /[ \t\r\n]/.test(source[start - 1])) start--;
  let end = offset;
  while (end < source.length && /[\r\n]/.test(source[end])) end++;
  // Keep the indentation of whatever follows.
  while (end > offset && source[end - 1] !== "\n") end--;
  const head = start > 0 ? "\n\n" : "";
  const tail = end < source.length ? "\n\n" : "\n";
  return { start, end, text: head + block + tail, at: start + head.length };
}

function lineIndexAt(lines: Line[], offset: number): number {
  let low = 0;
  let high = lines.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >>> 1;
    if (lines[middle].start <= offset) low = middle;
    else high = middle - 1;
  }
  return low;
}

const blank = (line: Line | undefined) => !!line && !line.text.trim();
const indented = (line: Line) => /^[ \t]/.test(line.text);

/**
 * Where an annotation for a passage ending at `offset` goes: after the
 * top-level block that holds the passage, and after any annotations that
 * already follow that block, so they stay in the order they were made.
 *
 * A block ends at a closing fence, at a heading, before an unindented fence or
 * heading, or at a blank line followed by unindented text. A list keeps going
 * across blank lines while its items do, so a note never splits a list.
 */
export function annotationOffset(source: string, offset: number): number {
  const { lines, fenced, closes, annotations } = scan(source);
  let i = lineIndexAt(lines, Math.max(0, offset - 1));
  if (fenced[i]) {
    while (i < lines.length - 1 && !closes[i]) i++;
  } else if (!HEADING.test(lines[i].text)) {
    let first = i;
    while (first > 0 && !blank(lines[first - 1]) && !fenced[first - 1]) first--;
    while (first > 0 && (indented(lines[first]) || blank(lines[first]))) first--;
    const list = LIST_ITEM.test(lines[first].text);
    for (; i < lines.length - 1; i++) {
      const next = lines[i + 1];
      if (fenced[i + 1] && !indented(next)) break;
      if (!blank(next) && !indented(next) && HEADING.test(next.text)) break;
      if (!blank(next)) continue;
      let k = i + 1;
      while (k < lines.length && blank(lines[k])) k++;
      if (k >= lines.length) break;
      if (indented(lines[k])) continue;
      if (list && LIST_ITEM.test(lines[k].text)) continue;
      break;
    }
  }
  let at = i + 1 < lines.length ? lines[i + 1].start : source.length;
  // Past annotations already attached to this block.
  for (;;) {
    let k = lineIndexAt(lines, at);
    if (at >= source.length) break;
    while (k < lines.length && blank(lines[k])) k++;
    const next = k < lines.length ? annotations.find((a) => a.span.start === lines[k].start) : null;
    if (!next) break;
    const close = lineIndexAt(lines, next.span.end);
    at = close + 1 < lines.length ? lines[close + 1].start : source.length;
  }
  return at;
}

/** Trim whitespace off a span, and take in emphasis markers hugging it. */
function passageSpan(source: string, span: SourceSpan): SourceSpan {
  let { start, end } = span;
  while (start < end && /\s/.test(source[start])) start++;
  while (end > start && /\s/.test(source[end - 1])) end--;
  while (start > 0 && /[*_~]/.test(source[start - 1])) start--;
  while (end < source.length && /[*_~]/.test(source[end])) end++;
  return { start, end };
}

const overlaps = (a: SourceSpan, b: SourceSpan) => a.start < b.end && b.start < a.end;

/** An offset of the original, carried through edits made to it. */
function mapOffset(offset: number, edits: readonly TextEdit[]): number {
  let delta = 0;
  for (const edit of [...edits].sort((a, b) => a.start - b.start)) {
    if (edit.end <= offset) delta += edit.text.length - (edit.end - edit.start);
    else if (edit.start < offset) return edit.start + delta + edit.text.length;
    else break;
  }
  return offset + delta;
}

/**
 * Highlight `span` of the source. A highlight it overlaps is replaced, as
 * painting over a mark replaces it. Returns null when there is nothing to mark.
 */
export function addHighlight(
  source: string,
  span: SourceSpan,
  color: AnnotationColor,
  label?: string,
): { content: string; at: number } | null {
  const first = passageSpan(source, span);
  const removals = parseAnnotations(source)
    .filter((a) => a.kind === "highlight" && a.target && overlaps(a.target, first))
    .map((a) => removalEdit(source, a));
  const content = applyEdits(source, removals);
  const mapped = { start: mapOffset(first.start, removals), end: mapOffset(first.end, removals) };
  // A fence inside the selection (it crossed a note) is not passage text.
  const inside = parseAnnotations(content).find(
    (a) => a.span.start >= mapped.start && a.span.start < mapped.end,
  );
  if (inside) mapped.end = inside.span.start;
  const passage = passageSpan(content, mapped);
  const body = content.slice(passage.start, passage.end);
  if (!body.trim()) return null;
  const place = placeBlock(
    content,
    annotationOffset(content, passage.end),
    annotationBlock({ kind: "highlight", color, label, body }),
  );
  return { content: applyEdits(content, [place]), at: place.at };
}

/** A note taken from the passage at `span`, placed after it; or at the end. */
export function addNote(
  source: string,
  span: SourceSpan | null,
  body: string,
  label?: string,
): { content: string; at: number } | null {
  const text = body.slice(0, MAX_NOTE_CHARS);
  if (!text.trim()) return null;
  const offset = span ? annotationOffset(source, span.end) : source.length;
  const place = placeBlock(source, offset, annotationBlock({ kind: "note", label, body: text }));
  return { content: applyEdits(source, [place]), at: place.at };
}

/** The same annotation with new text, colour or label. */
export function changeAnnotation(
  source: string,
  annotation: Annotation,
  patch: Partial<Pick<Annotation, "body" | "color" | "label">>,
): string {
  const next = { ...annotation, ...patch };
  if (patch.body !== undefined) next.body = patch.body.slice(0, MAX_NOTE_CHARS);
  return applyEdits(source, [
    { start: annotation.span.start, end: annotation.span.end, text: annotationBlock(next) },
  ]);
}

function removalEdit(source: string, annotation: Annotation): TextEdit {
  let { start, end } = annotation.span;
  const after = /^\r?\n(?:[ \t]*\r?\n)?/.exec(source.slice(end));
  if (after) end += after[0].length;
  // Removing the last block leaves the document ending in a single newline.
  if (!source.slice(end).trim()) {
    while (start > 0 && /\s/.test(source[start - 1])) start--;
    return { start, end: source.length, text: start > 0 ? "\n" : "" };
  }
  return { start, end, text: "" };
}

/** The document without this annotation, and without the blank line it left. */
export function removeAnnotation(source: string, annotation: Annotation): string {
  return applyEdits(source, [removalEdit(source, annotation)]);
}

/** The document with every annotation taken out. */
export function stripAnnotations(source: string): string {
  // Last first: each removal only touches text from the end of the one before
  // it, so the earlier spans stay valid.
  let out = source;
  for (const annotation of parseAnnotations(source).reverse())
    out = removeAnnotation(out, annotation);
  return out;
}

/**
 * The same annotation in a newer copy of the document: at the same place if
 * it is still there, else the one of the same kind and text nearest to it.
 */
export function findAnnotation(
  source: string,
  previous: Pick<Annotation, "kind" | "body" | "span">,
): Annotation | null {
  const same = parseAnnotations(source).filter(
    (a) => a.kind === previous.kind && a.body === previous.body,
  );
  if (!same.length) return null;
  return same.reduce((best, a) =>
    Math.abs(a.span.start - previous.span.start) < Math.abs(best.span.start - previous.span.start)
      ? a
      : best,
  );
}
