# Connected notes

Markdown notes can link to another file in the current workspace using `[[Concept]]`, `[[Folder/Concept]]`, or `[Concept](Folder/Concept.md)`. Standard reference-style Markdown links are indexed too. `[[Concept|display name]]` changes the displayed label; a note's YAML `aliases` property supplies alternative names. Common scalar, inline-list and indented-list aliases are supported.

Type `[[` or `![[` in either editing mode for file and alias completion. Add `#` for heading completion, including nested headings, or `#^` for block identifiers. Suggestions include folder paths, and insertion balances the closing brackets. Completion stays out of fenced and inline code.

`[[Concept#Details]]` opens the target heading; `[[Concept#^proof]]` opens the block marked `^proof`. Heading fragments accept the heading text or its deduplicated GitHub slug. `![[Concept]]`, `![[Concept#Details]]`, and `![[Concept#^proof]]` embed a whole note, heading section, or block. A heading section stops before the next heading of the same or higher level. Existing embed recursion limits still apply.

Resolution first checks the source folder, then a workspace-root path, then a unique file name or alias. A leading `/` gives an explicit root path. Duplicate titles with no unique path show a choice of files instead of opening an arbitrary note. Deleted files are excluded. Following a missing wiki link creates the requested Markdown note and any missing folders, then opens its editor.

The **Connections** footer in Preview shows backlinks grouped by source note, source-line snippets, outgoing references, embeds, and missing or ambiguous targets. The index includes wikilinks and local Markdown links and excludes code, comments, escaped links, equations, and external URLs. Source scanning is cached per file; path and alias lookups are cached per workspace snapshot. It updates after the editor's existing autosave debounce.

File rename, folder rename, moves and folder deletion repair affected references by target identity. Wiki display labels and heading/block fragments remain intact. Markdown destinations remain relative to the source folder and encode spaces; shared reference definitions are rewritten once. Open editor drafts and their Cancel baselines receive the same reference repairs, including keystrokes still awaiting autosave. Unsupported or unresolved references remain as authored.

The semantic index and note navigation cover the active workspace. Existing cross-workspace artifact embeds continue through the artifact resolver. This does not add a graph view, metadata query language, or cross-workspace refactoring.

Implementation: `src/lib/markdown/note-links.ts`, `remark-note-links.ts`, `WorkspaceLinksContext.tsx`, `ConnectedLink.tsx`, `NoteConnections.tsx`, and `note-completion.ts`. Verification: `tests/note-links.test.ts` and `tests/e2e/connected-notes.spec.ts`.
