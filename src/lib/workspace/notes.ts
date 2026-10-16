// The Notes list: every note and highlight kept in the workspace's documents.
//
// Notes and highlights are not stored here, or anywhere beside the documents.
// Each is a fenced block in its document's Markdown (lib/markdown/annotations.ts),
// so this module only reads them out, in a stable order, for the panel:
//
//  - by document, in the workspace's file order, then by place in the document;
//  - with an id of `${fileId}#${n}`, the n-th annotation in that document,
//    which stays put while the reader types anywhere but between annotations;
//  - documents in the Bin are left out: their notes return with them.
//
// Reading is cached per document by its content, so an autosave of one
// document re-reads that document alone.

import { parseAnnotations, type Annotation } from "../markdown/annotations.ts";
import { fileSubtopics, type MdChunk } from "../markdown/markdown-utils.ts";

/** One row of the Notes list: an annotation and the document it is in. */
export interface NotebookEntry extends Annotation {
  id: string;
  fileId: string;
}

interface NotebookFile {
  id: string;
  content: string;
  kind?: string;
  deletedAt?: number | null;
}

const cache = new Map<string, { content: string; entries: NotebookEntry[] }>();

/** The annotations of one document, as Notes-list entries. */
export function documentEntries(fileId: string, content: string): NotebookEntry[] {
  const hit = cache.get(fileId);
  if (hit && hit.content === content) return hit.entries;
  const entries = parseAnnotations(content).map((annotation, n) => ({
    ...annotation,
    id: `${fileId}#${n}`,
    fileId,
  }));
  cache.set(fileId, { content, entries });
  return entries;
}

/** Whether a file's content is Markdown the reader annotates. */
const annotatable = (file: NotebookFile) =>
  file.deletedAt == null && (!file.kind || file.kind === "markdown" || file.kind === "text");

/** Every note and highlight in the workspace, by document then by place. */
export function notebookEntries(files: readonly NotebookFile[]): NotebookEntry[] {
  const live = new Set<string>();
  const entries: NotebookEntry[] = [];
  for (const file of files) {
    if (!annotatable(file)) continue;
    live.add(file.id);
    entries.push(...documentEntries(file.id, file.content));
  }
  // Forget documents that are gone, so the cache can't outgrow the workspace.
  for (const id of cache.keys()) if (!live.has(id)) cache.delete(id);
  return entries;
}

/**
 * Entries matching every word of `query`: their text, label, document name or
 * page. `nameOf` gives a document's current name, so a rename is searchable.
 */
export function searchEntries(
  entries: readonly NotebookEntry[],
  query: string,
  nameOf: (fileId: string) => string | undefined = () => undefined,
  sectionOf: (entry: NotebookEntry) => string | undefined = () => undefined,
): NotebookEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...entries];
  return entries.filter((entry) => {
    const hay = [entry.body, entry.label ?? "", nameOf(entry.fileId) ?? "", sectionOf(entry) ?? ""]
      .join("\n")
      .toLowerCase();
    return words.every((word) => hay.includes(word));
  });
}

/** Where each page starts and ends in the document source. */
export function chunkRanges(content: string, chunks: MdChunk[]) {
  const ranges: Array<{ id: string; from: number; to: number }> = [];
  let cursor = 0;
  for (const chunk of chunks) {
    const at = content.indexOf(chunk.content, cursor);
    if (at < 0) continue;
    cursor = at + chunk.content.length;
    ranges.push({ id: chunk.id, from: at, to: cursor });
  }
  return ranges;
}

/** The page (H1 section) an offset in a document falls on. */
export function pageOf(
  file: { content: string; name: string; subtopics?: MdChunk[] },
  offset: number,
): MdChunk | undefined {
  const chunks = fileSubtopics(file);
  const id = chunkRanges(file.content, chunks).find(
    (range) => offset >= range.from && offset <= range.to,
  )?.id;
  return chunks.find((chunk) => chunk.id === id) ?? chunks[0];
}
