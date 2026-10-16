import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import {
  noteAliases,
  noteName,
  noteHeadings,
  resolveNoteLink,
  splitNoteReference,
} from "@/lib/markdown/note-links";
import { filePath } from "@/lib/markdown/media-references";
import type { MediaContext } from "@/lib/markdown/media-context";

export function noteCompletion(getContext: () => MediaContext | undefined) {
  return (context: CompletionContext): CompletionResult | null => {
    const match = context.matchBefore(/!?\[\[[^\]\n]*$/);
    const media = getContext();
    if (!match || !media?.sourceFile || !media.workspaceFiles) return null;
    for (
      let node = syntaxTree(context.state).resolveInner(context.pos, -1);
      node;
      node = node.parent!
    ) {
      if (["FencedCode", "CodeBlock", "InlineCode"].includes(node.name)) return null;
    }
    const opening = match.text.startsWith("!") ? 3 : 2;
    const typed = match.text.slice(opening);
    const from = match.from + opening;
    const apply =
      (insert: string) => (view: EditorView, _completion: unknown, start: number, end: number) => {
        const closing = view.state.sliceDoc(end, end + 2) === "]]" ? 2 : 0;
        view.dispatch({
          changes: { from: start, to: end + closing, insert: `${insert}]]` },
          selection: { anchor: start + insert.length + 2 },
          userEvent: "input.complete",
        });
      };
    const hash = typed.indexOf("#");
    if (hash >= 0) {
      const resolved = resolveNoteLink(
        typed.slice(0, hash),
        media.sourceFile,
        media.workspaceFiles,
        media.workspaceFolders ?? [],
      );
      if (resolved.status !== "found") return null;
      const block = typed.slice(hash + 1).startsWith("^");
      const labels = block
        ? [...resolved.file.content.matchAll(/\s\^([\w-]+)\s*$/gm)].map((m) => `^${m[1]}`)
        : noteHeadings(resolved.file.content).map((heading) => heading.text);
      return {
        from: from + hash + 1,
        options: labels.map((label) => ({
          label,
          type: "text",
          detail: block ? "Block" : "Heading",
          apply: apply(label),
        })),
        validFor: /^[^\]\n]*$/,
      };
    }
    const options: Completion[] = media.workspaceFiles
      .filter((file) => !file.deletedAt)
      .flatMap((file) => {
        const path = noteName(filePath(file, media.workspaceFolders ?? []));
        return [
          {
            label: noteName(file.name),
            detail: filePath(file, media.workspaceFolders ?? []),
            type: "text",
            apply: apply(`/${path}`),
          },
          ...noteAliases(file.content).map((alias) => ({
            label: alias,
            detail: filePath(file, media.workspaceFolders ?? []),
            type: "text",
            apply: apply(`/${path}|${alias}`),
          })),
        ];
      });
    if (
      typed.trim() &&
      !typed.includes("|") &&
      resolveNoteLink(
        splitNoteReference(typed).name,
        media.sourceFile,
        media.workspaceFiles,
        media.workspaceFolders ?? [],
      ).status === "missing"
    )
      options.push({
        label: typed,
        detail: "New note · follow the link to create",
        type: "text",
        boost: -99,
        apply: apply(typed),
      });
    return { from, options, validFor: /^[^#|\]\n]*$/ };
  };
}
