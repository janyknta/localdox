# Markdown Live Preview

The editor offers **Live Preview** and **Source** above the formatting toolbar. The selected editing mode is remembered on the device. Source remains the default on first use.

Live Preview keeps the current line or selected block as Markdown source. Inactive content displays heading hierarchy, strong/emphasized/struck text, inline code, navigable links, math, tables, code fences, callouts, and media using the existing Markdown renderers. Hover a rendered block to reveal **Edit**, use keyboard focus to reach it, or double-click its background to reveal its source. Edit controls stay visible on touch devices.

Both modes use the same CodeMirror document, selection, history, formatting operations, draft journal and autosave. Switching modes reconfigures decorations rather than rebuilding the editor. Source mode retains line numbers, syntax highlighting and fold controls. Live Preview uses compact paragraph spacing and the application's reading typography. Cancel restores the opening content with any intervening rename/move reference repairs preserved.

CodeMirror mounts rendered widgets for the visible document region; a long note does not mount a React tree for every paragraph. Equation numbering is derived once from the current full editor source and shared across its visible widgets. Shared renderers retain their existing deferred math, diagram, media and interactive capabilities. Editor prefetching occurs on the Edit action's pointer/focus intent, not every file-menu open.

Implementation: `MarkdownSource.tsx`, `markdown-live-preview.tsx`, `MarkdownEditor.tsx` and scoped `.cm-live-*` styles. Browser verification in `tests/e2e/connected-notes.spec.ts` covers mode switches, source preservation, undo/redo, autosave/reload, rendered tables/callouts/math, block editing, Cancel, a narrow screen, and bounded widgets in a 1,500-paragraph note.
