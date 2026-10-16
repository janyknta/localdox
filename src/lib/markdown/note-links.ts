import {
  decodeReference,
  filePath,
  folderPath,
  normalizePath,
  isLocalReference,
  ARTIFACT_URL_PREFIX,
} from "./media-references.ts";
import type { FolderRecord, PersistedFile } from "../workspace/persistence.ts";
import GithubSlugger from "github-slugger";

export const NOTE_URL_PREFIX = "https://workspace-note.local/";
export const noteUrl = (reference: string) => NOTE_URL_PREFIX + encodeURIComponent(reference);
export const isNoteUrl = (url: string) => url.startsWith(NOTE_URL_PREFIX);
export const noteReference = (url: string) => decodeReference(url.slice(NOTE_URL_PREFIX.length));
export interface NoteLink {
  from: number;
  to: number;
  targetFrom: number;
  targetTo: number;
  reference: string;
  label: string;
  embed: boolean;
  kind: "wiki" | "markdown";
}
export const noteName = (name: string) => name.replace(/\.(md|markdown|mdx|txt)$/i, "");
const key = (value: string) => value.normalize("NFC").toLocaleLowerCase();

/** Preserve offsets while excluding code, comments and equations from link scanning. */
export function linkableSource(source: string): string {
  const blank = (s: string) => s.replace(/[^\n\r]/g, " ");
  let fence: string | null = null;
  let masked = source
    .split(/(?<=\n)/)
    .map((line) => {
      const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (marker) {
        if (!fence) fence = marker[1];
        else if (
          marker[1][0] === fence[0] &&
          marker[1].length >= fence.length &&
          /^\s*$/.test(line.slice(marker[0].length))
        )
          fence = null;
        return blank(line);
      }
      return fence || /^( {4}|\t)/.test(line) ? blank(line) : line;
    })
    .join("");
  masked = masked.replace(/<!--[\s\S]*?(?:-->|$)/g, blank);
  masked = masked.replace(/(`+)([\s\S]*?)\1(?!`)/g, blank);
  masked = masked.replace(/(?<!\\)\$\$[\s\S]*?\$\$|(?<!\\)\$[^$\n]+\$/g, blank);
  return masked;
}
const escaped = (source: string, at: number) => {
  let count = 0;
  while (at > 0 && source[--at] === "\\") count++;
  return count % 2 === 1;
};

/** Links carry source spans: edits never replace lookalike text inside code. */
export function scanNoteLinks(source: string): NoteLink[] {
  const masked = linkableSource(source);
  const links: NoteLink[] = [];
  const pattern =
    /!?\[\[([^\]\n]+)\]\]|!?\[([^\]\n]*)\]\((<[^>\n]+>|(?:\\.|[^\s()\n]|\([^()\n]*\))+)(?:\s+["'][^\n]*?["'])?\)/g;
  for (const match of masked.matchAll(pattern)) {
    const from = match.index!;
    if (
      escaped(source, from) ||
      (from > 0 && source[from - 1] === "!" && escaped(source, from - 1))
    )
      continue;
    const embed = match[0].startsWith("!");
    if (match[1] !== undefined) {
      const [reference, ...display] = match[1].split("|");
      const targetFrom = from + (embed ? 3 : 2);
      links.push({
        from,
        to: from + match[0].length,
        targetFrom,
        targetTo: targetFrom + reference.length,
        reference: reference.trim(),
        label: display.join("|") || reference.trim(),
        embed,
        kind: "wiki",
      });
    } else {
      const wrapped = match[3].startsWith("<");
      const dest = wrapped ? match[3].slice(1, -1) : match[3];
      if (!isLocalReference(dest) && !dest.startsWith("#") && !dest.startsWith(ARTIFACT_URL_PREFIX))
        continue;
      const targetFrom = from + match[0].indexOf("](") + 2 + (wrapped ? 1 : 0);
      links.push({
        from,
        to: from + match[0].length,
        targetFrom,
        targetTo: targetFrom + dest.length,
        reference: dest.startsWith(ARTIFACT_URL_PREFIX)
          ? decodeReference(dest.slice(ARTIFACT_URL_PREFIX.length))
          : decodeReference(dest),
        label: match[2],
        embed,
        kind: "markdown",
      });
    }
  }
  // Standard reference-style links share a destination definition. Retain the
  // definition's target span so a rename updates it once for all occurrences.
  const definitions = new Map<string, { from: number; to: number; dest: string }>();
  const labelKey = (label: string) => key(label.trim().replace(/\s+/g, " "));
  const excluded: { from: number; to: number }[] = [];
  const mask = (from: number, to: number) => excluded.push({ from, to });
  for (const match of masked.matchAll(/^ {0,3}\[([^\]\n]+)\]:[ \t]*(<[^>\n]+>|[^\s\n]+)/gm)) {
    const wrapped = match[2].startsWith("<");
    const dest = wrapped ? match[2].slice(1, -1) : match[2];
    const from = match.index! + match[0].lastIndexOf(match[2]) + (wrapped ? 1 : 0);
    if (!definitions.has(labelKey(match[1])) && (isLocalReference(dest) || dest.startsWith("#")))
      definitions.set(labelKey(match[1]), { from, to: from + dest.length, dest });
    mask(match.index!, match.index! + match[0].length);
  }
  for (const link of links) mask(link.from, link.to);
  let offset = 0;
  const parts: string[] = [];
  for (const span of excluded.sort((a, b) => a.from - b.from)) {
    if (span.from < offset) continue;
    parts.push(
      masked.slice(offset, span.from),
      masked.slice(span.from, span.to).replace(/[^\n\r]/g, " "),
    );
    offset = span.to;
  }
  const prose = parts.join("") + masked.slice(offset);
  for (const match of prose.matchAll(/!?\[([^\]\n]+)\](?:\[([^\]\n]*)\])?/g)) {
    const from = match.index!;
    if (escaped(source, from) || prose[from - 1] === "[" || prose[from + match[0].length] === "(")
      continue;
    const definition = definitions.get(labelKey(match[2] || match[1]));
    if (!definition) continue;
    links.push({
      from,
      to: from + match[0].length,
      targetFrom: definition.from,
      targetTo: definition.to,
      reference: decodeReference(definition.dest),
      label: match[1],
      embed: match[0].startsWith("!"),
      kind: "markdown",
    });
  }
  return links.sort((a, b) => a.from - b.from);
}

export function splitNoteReference(reference: string) {
  const clean = reference.trim().split("|")[0];
  const at = clean.indexOf("#");
  return { name: at < 0 ? clean : clean.slice(0, at), fragment: at < 0 ? "" : clean.slice(at + 1) };
}

/** Read the common YAML aliases forms without changing or normalising frontmatter. */
export function noteAliases(source: string): string[] {
  const front = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source)?.[1];
  if (!front) return [];
  const lines = front.split(/\r?\n/);
  const at = lines.findIndex((line) => /^aliases?\s*:/.test(line));
  if (at < 0) return [];
  const scalar = (s: string) => {
    const clean = s.trim();
    if (clean.startsWith('"')) {
      try {
        return JSON.parse(clean) as string;
      } catch {
        return clean.slice(1, -1);
      }
    }
    return clean.replace(/^'|'$/g, "").replace(/''/g, "'");
  };
  const value = lines[at].replace(/^aliases?\s*:\s*/, "").trim();
  if (value.startsWith("["))
    return (value.slice(1, -1).match(/"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[^,]+/g) ?? [])
      .map(scalar)
      .filter(Boolean);
  if (value && !value.startsWith("#")) return [scalar(value)];
  const result: string[] = [];
  for (const line of lines.slice(at + 1)) {
    const item = /^\s+-\s+(.+)/.exec(line);
    if (!item) break;
    result.push(scalar(item[1]));
  }
  return result.filter(Boolean);
}

export type NoteResolution<T = PersistedFile> =
  | { status: "found"; file: T; fragment: string }
  | { status: "missing" | "ambiguous"; fragment: string };

const EMPTY_FOLDERS: FolderRecord[] = [];
const resolvers = new WeakMap<object, WeakMap<object, ReturnType<typeof createNoteResolver>>>();

/** Build path/alias lookups once per immutable workspace snapshot. */
export function createNoteResolver<T extends PersistedFile>(
  files: readonly T[],
  folders: FolderRecord[] = EMPTY_FOLDERS,
) {
  const ids = new Map<string, T>();
  const paths = new Map<string, T[]>();
  const names = new Map<string, T[]>();
  const add = (map: Map<string, T[]>, value: string, file: T) => {
    const label = key(value);
    const matches = map.get(label) ?? [];
    if (!matches.includes(file)) matches.push(file);
    map.set(label, matches);
  };
  for (const file of files) {
    if (file.deletedAt) continue;
    ids.set(file.id, file);
    const path = filePath(file, folders);
    add(paths, path, file);
    add(paths, noteName(path), file);
    for (const name of [file.name, noteName(file.name), ...noteAliases(file.content)])
      add(names, name, file);
  }
  return (reference: string, source: Pick<T, "id" | "folderId">): NoteResolution<T> => {
    const { name, fragment } = splitNoteReference(reference);
    const found = (file?: T): NoteResolution<T> =>
      file ? { status: "found", file, fragment } : { status: "missing", fragment };
    const choose = (matches?: T[]): NoteResolution<T> | null =>
      matches?.length
        ? matches.length === 1
          ? found(matches[0])
          : { status: "ambiguous", fragment }
        : null;
    if (!name) return found(ids.get(source.id));
    const stable = /^@[^/]+\/(.+)$/.exec(name);
    if (stable) return found(ids.get(stable[1]));
    const matchPath = (candidate: string | null) =>
      candidate === null ? null : choose(paths.get(key(candidate)));
    if (!name.startsWith("/")) {
      const nearby = matchPath(normalizePath(`${folderPath(source.folderId, folders)}/${name}`));
      if (nearby) return nearby;
    }
    return (
      matchPath(normalizePath(name)) ??
      (!name.includes("/") ? choose(names.get(key(name))) : null) ?? { status: "missing", fragment }
    );
  };
}

export function resolveNoteLink<T extends PersistedFile>(
  reference: string,
  source: Pick<T, "id" | "folderId">,
  files: readonly T[],
  folders: FolderRecord[] = EMPTY_FOLDERS,
): NoteResolution<T> {
  let byFolders = resolvers.get(files);
  if (!byFolders) {
    byFolders = new WeakMap();
    resolvers.set(files, byFolders);
  }
  let resolve = byFolders.get(folders);
  if (!resolve) {
    resolve = createNoteResolver(files, folders);
    byFolders.set(folders, resolve);
  }
  return resolve(reference, source) as NoteResolution<T>;
}

export function noteHeadings(content: string) {
  const masked = linkableSource(content).replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, (text) =>
    text.replace(/[^\r\n]/g, " "),
  );
  const headings: { start: number; end: number; level: number; text: string; slug: string }[] = [];
  const visible = (text: string) =>
    text
      .replace(/!?\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/<[^>]+>/g, "")
      .replace(/[`*_~]/g, "")
      .replace(/\\([\W])/g, "$1")
      .trim();
  for (const match of masked.matchAll(
    /^ {0,3}(#{1,6})[ \t]+([^\r\n]*?)(?:[ \t]+#+)?[ \t]*\r?$/gm,
  )) {
    const raw = content.slice(match.index!, match.index! + match[0].length).replace(/\r$/, "");
    const title = /^ {0,3}#{1,6}[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/.exec(raw)?.[1] ?? match[2];
    headings.push({
      start: match.index!,
      end: match.index! + match[0].length,
      level: match[1].length,
      text: visible(title),
      slug: "",
    });
  }
  for (const match of masked.matchAll(/^ {0,3}(=+|-+)[ \t]*\r?$/gm)) {
    const end = match.index! - (content[match.index! - 1] === "\n" ? 1 : 0);
    const start = content.lastIndexOf("\n", end - 1) + 1;
    const title = content.slice(start, end).trimEnd();
    if (title.trim() && !/^(?: {4}|\t| {0,3}(?:#|>|[-*+] ))/.test(title))
      headings.push({
        start,
        end: match.index! + match[0].length,
        level: match[1][0] === "=" ? 1 : 2,
        text: visible(title),
        slug: "",
      });
  }
  const slugger = new GithubSlugger();
  return headings
    .sort((a, b) => a.start - b.start)
    .map((heading) => ({ ...heading, slug: slugger.slug(heading.text) }));
}

export function noteTargetSpan(
  content: string,
  fragment: string,
): { start: number; end: number; level?: number } | null {
  if (!fragment) return null;
  const masked = linkableSource(content);
  if (fragment.startsWith("^")) {
    const id = fragment.slice(1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(`(?:^|\\n)([^\\n]*?)[ \\t]*\\^${id}(?=[ \\t]*(?:\\r?\\n|$))`).exec(masked);
    if (!match) return null;
    let start = match.index + (match[0].startsWith("\n") ? 1 : 0);
    let end = start + match[1].length;
    if (!match[1].trim()) {
      end = start;
      while (end > 0 && /\s/.test(content[end - 1])) end--;
      start = content.lastIndexOf("\n\n", end - 1) + 2;
      if (start === 1) start = 0;
    } else {
      const preceding = content.slice(0, start);
      const boundaries = [...preceding.matchAll(/\r?\n\r?\n/g)];
      const boundary = boundaries.at(-1);
      start = boundary ? boundary.index! + boundary[0].length : 0;
    }
    return { start, end };
  }
  const heading = key(fragment.split("#").at(-1)!);
  for (const entry of noteHeadings(content))
    if (key(entry.text) === heading || key(entry.slug) === heading)
      return { start: entry.start, end: entry.end, level: entry.level };
  return null;
}

export interface IndexedNoteLink extends NoteLink {
  sourceId: string;
  targetId?: string;
  status: "found" | "missing" | "ambiguous";
}
export function noteEmbedContent(content: string, fragment: string): string | null {
  if (!fragment) return content;
  const span = noteTargetSpan(content, fragment);
  if (!span) return null;
  if (fragment.startsWith("^")) return content.slice(span.start, span.end);
  const next = noteHeadings(content).find(
    (heading) => heading.start >= span.end && heading.level <= (span.level ?? 1),
  );
  return content.slice(span.start, next?.start).trimEnd();
}
/** Incremental source scan; resolution is rebuilt when names, aliases or paths change. */
export class NoteLinkIndex {
  private scanned = new Map<string, { content: string; links: NoteLink[] }>();
  update(files: readonly PersistedFile[], folders: FolderRecord[] = []) {
    const next = new Map<string, { content: string; links: NoteLink[] }>();
    const result: IndexedNoteLink[] = [];
    for (const file of files) {
      if (file.deletedAt || (file.kind && !["markdown", "text"].includes(file.kind))) continue;
      const cached = this.scanned.get(file.id);
      const entry =
        cached?.content === file.content
          ? cached
          : { content: file.content, links: scanNoteLinks(file.content) };
      next.set(file.id, entry);
      for (const link of entry.links) {
        const resolved = resolveNoteLink(link.reference, file, files, folders);
        result.push({
          ...link,
          sourceId: file.id,
          status: resolved.status,
          targetId: resolved.status === "found" ? resolved.file.id : undefined,
        });
      }
    }
    this.scanned = next;
    return result;
  }
}

/** Re-resolve each old link by identity, then repair references made invalid by a rename/move. */
export function rewriteNoteLinks<T extends PersistedFile>(
  before: readonly T[],
  after: readonly T[],
  oldFolders: FolderRecord[],
  newFolders: FolderRecord[],
): T[] {
  const oldById = new Map(before.map((f) => [f.id, f]));
  const newById = new Map(after.map((f) => [f.id, f]));
  return after.map((source) => {
    const old = oldById.get(source.id);
    if (!old || source.deletedAt || (source.kind && !["markdown", "text"].includes(source.kind)))
      return source;
    const patches: { from: number; to: number; text: string }[] = [];
    for (const link of scanNoteLinks(source.content)) {
      const target = resolveNoteLink(link.reference, old, before, oldFolders);
      if (target.status !== "found") continue;
      const nextTarget = newById.get(target.file.id);
      if (!nextTarget || nextTarget.deletedAt) continue;
      const now = resolveNoteLink(link.reference, source, after, newFolders);
      const relativeSourceMoved =
        link.kind === "markdown" &&
        !link.reference.startsWith("/") &&
        folderPath(old.folderId, oldFolders) !== folderPath(source.folderId, newFolders);
      if (now.status === "found" && now.file.id === target.file.id && !relativeSourceMoved)
        continue;
      const suffix = target.fragment ? `#${target.fragment}` : "";
      let reference: string;
      if (link.kind === "wiki")
        reference = `/${noteName(filePath(nextTarget, newFolders))}${suffix}`;
      else {
        const base = folderPath(source.folderId, newFolders).split("/").filter(Boolean);
        const path = filePath(nextTarget, newFolders).split("/");
        while (base.length && path.length && key(base[0]) === key(path[0])) {
          base.shift();
          path.shift();
        }
        reference =
          [...base.map(() => ".."), ...path].map(encodeURIComponent).join("/") +
          (suffix ? `#${encodeURIComponent(target.fragment)}` : "");
      }
      if (source.content.slice(link.targetFrom, link.targetTo).startsWith(ARTIFACT_URL_PREFIX))
        reference = ARTIFACT_URL_PREFIX + encodeURIComponent(reference);
      if (!patches.some((patch) => patch.from === link.targetFrom))
        patches.push({ from: link.targetFrom, to: link.targetTo, text: reference });
    }
    if (!patches.length) return source;
    let content = source.content;
    for (const patch of patches.sort((a, b) => b.from - a.from))
      content = content.slice(0, patch.from) + patch.text + content.slice(patch.to);
    return { ...source, content, headings: undefined, subtopics: undefined };
  });
}
