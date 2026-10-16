# Notes panel

Select text in a Markdown document and choose **Copy selection to notes**. The
passage is written into the document as clean Markdown, in a ` ```note ` block
right after it, and listed in a panel beside the document together with every
highlight. Notes and highlights are kept in the documents themselves; the
panel stores nothing. The format, and why, is in
[annotations.md](annotations.md).

## The problem

A **highlight** marks the document's own words. A reader also wants the other
thing: the passage _in their own words_, editable, searchable, and easy to
copy out. That is a note. It starts as a clean copy of the selection, and the
reader rewrites it.

## Mental model

A note is a sticky note pressed onto the page, right under the paragraph it
came from. It is part of the page, so it is wherever the document is:
downloaded, copied, shared (by opt-in), or moved to another workspace. The
panel is a table of contents of every sticky note and highlight in the
workspace, not a separate notebook.

## Data model

There is no `Note` record. `lib/workspace/notes.ts` reads entries out of the
documents:

```ts
interface NotebookEntry extends Annotation {
  // lib/markdown/annotations.ts
  id: string; // `${fileId}#${n}`: the n-th annotation in its document
  fileId: string;
  // kind ("note" | "highlight"), color, label, body, span, bodySpan, target
}
```

- **Order:** by document in the workspace's file order, then by position.
  There are no creation times in a Markdown file, so the list is no longer
  newest-first.
- **Cached by content:** `documentEntries` re-reads a document only when its
  text changed, so an autosave of one document re-reads that one alone. The
  panel reads anything at all only while it is open.
- **Live documents only:** documents in the Bin, and non-Markdown files, are
  left out. A binned document's notes come back with it.

## Flow: copying a selection

```
mouseup in the article → MarkdownViewer.openCreateMenu
   keeps a cloned Range in the menu state
"Copy selection to notes" → copyToNotes
   selectionToMarkdown(range, container)       ← clean Markdown
   addressOfRange → the passage's file span    ← where the note goes
   addNote(content, span, body)                ← annotations.ts
   onContentChange(file.id, content)           ← same path as a checkbox
   onAnnotated → toast, card marked in the panel
```

The Range is cloned when the menu opens because the live selection is lost as
soon as the reader clicks or types in the menu. If a re-render has replaced the
nodes it points into, the range is rebuilt from the stored offsets.

### Clean Markdown (`src/lib/markdown/selection-markdown.ts`)

`Selection.toString()` flattens tables into tabs, drops list markers and fences,
and spells an equation out three times (KaTeX's visual spans, its MathML, its
annotation). So the selection is converted in two steps:

1. **capture**: walk the DOM in document order between the two boundary
   points, clipping text at the ends. Viewer chrome is dropped: buttons, SVG
   icons, `aria-hidden` decoration, equation numbers, callout icons and labels,
   anything marked `data-viewer-ui`. Any equation the selection touches becomes
   its LaTeX source.
2. **render**: paragraphs, headings, lists (with `[x]` task boxes and `start`
   numbers), GFM tables (`|` escaped), fenced code with its language, block
   quotes, `> [!NOTE]` callouts, emphasis, inline code, links and `$…$` /
   `$$…$$` math.

Context rules for partial selections:

| Selection                                      | Result                                                   |
| ---------------------------------------------- | -------------------------------------------------------- |
| Part of one paragraph, list item or table cell | that text, no wrapper                                    |
| Any part of a code block                       | a fenced block of what was selected                      |
| Any part of an equation                        | the whole equation's LaTeX                               |
| Cells across rows                              | a table, with the header row added if it wasn't selected |

LaTeX comes from what KaTeX and Temml embed in their MathML. The app's
sanitizer (`services/math/sanitize.ts`) unwraps `<semantics>` and `<annotation>`
but keeps their text, so on the page the source is a bare text node directly
inside `<math>`, beside the `<mrow>`. `latexOf` reads that, and still accepts a
real `<annotation encoding="application/x-tex">` should the sanitizer change. An
equation still typesetting, or one that failed, shows its source as text.
**MathJax keeps no source in the DOM**, so a MathJax equation falls back to its
MathML text.

Both steps read nodes through a structural interface (`DomNodeLike`), not
browser globals, so the conversion is unit-tested in Node.

## Flow: opening an entry

```
click a card → DocsApp.openEntry(entry)
  findAnnotation(file.content, entry)     the same block in the current text
  span = highlight ? target : bodySpan
  handleSelect(file, pageOf(file, span))  open the page that holds it
  setPendingSaved({ span })               → rangeOfAddress → scroll + flash
```

A highlight opens on the passage it marks. A note, or a highlight whose passage
is gone, opens on its own card. Because the entry is a file span, the jump is
exact even when the same sentence appears twice
([source-addressing.md](source-addressing.md)).

## Highlights in the list

A highlight is listed among the notes, because it is also the reader keeping a
passage.

- **Shown as a note, not painted.** A column of yellow and pink blocks is
  tiring to read beside a document, and the colour only has to say "this is a
  highlight". The card shows the passage's text (its Markdown reduced with
  `visibleInline`), with an 8px dot of its colour beside the actions. A
  highlight whose passage is gone says so under its text.
- **No edit button.** The text is the document's own. Recolouring and labels
  stay on the mark in the document. Search covers text, label, document name
  and page title (`searchEntries`).
- **Delete** removes the fence from the document, which unpaints the mark. The
  toast offers **Undo**.

## Changing a note from the panel

Edit, Delete and Move to rough work rewrite the document through DocsApp's
`rewriteDocument`. It reads text still in an open editor first and rewrites
that editor in place, so the editor's next autosave can't restore the old
block. Each action finds its block again with `findAnnotation` (same kind and
body, nearest position). If the block was edited in between, nothing is
written and the reader is told so.

## UI

The **Notes** tab offers **Cards** and **File** views. File view merges every
note and highlight into one read-only `notes.md`, in the same order as the
cards, preserving the notes' original Markdown (a highlight contributes the
source text it marks). Entries flow as
continuous content with blank lines between them; no generated headings,
source labels, highlight labels, or separator lines are added.
File view shows clean, rendered content with a copy icon at its top-right to
copy the merged Markdown. The expand button opens a larger view, and the download
button in either view saves the whole file. Card search never limits the content,
copy, or download. The merged file
updates as notes change and does not create or modify a workspace document.

Each note and highlight card also has a **Move to rough work** icon beside its
copy and delete actions. It transfers the text to a new scratchpad linked to
the document, removes the note or highlight from the document, and opens the
**Rough work** tab. Existing scratchpads are preserved. The toast offers **Undo**;
if the new scratchpad has been edited, Undo puts the block back in the document
and keeps those edits in rough work.

The panel has three tabs: **Notes**, **Rough work** (scratchpads; see
rough-work.md) and **Compute** (an on-device math engine; see
math-compute.md). A note saved from rough work is appended to the end of the
pad's document, or to the workspace's `Notes.md` (created on first use) when
the pad has no document.

- **Desktop (≥1024px):** a docked column (`w-80`, `xl:w-88`) right of the
  reading column, sticky to the viewport. It stays open across documents and
  reloads.
- **Narrower:** the app's `BottomSheet`. Clicking a card closes the sheet,
  since it would cover the passage.
- Open with the notebook button in the viewer header (`aria-pressed`). Each
  note shows its rendered Markdown (folded past 288px, with equations and diagrams
  drawn; see below) and Copy / Move to rough work / Edit / Delete. Clicking the
  card opens it in its document. Action icons, links,
  editing controls, and text selection do not trigger a source jump. Edit opens a Markdown
  textarea: ⌘/Ctrl+Enter saves, Esc cancels. Delete is immediate, with **Undo**
  in the toast. Search matches every word across content, label, the
  document's current name and the page.
- The panel downloads on first open (`NotesPanelLazy`, via `deferredModule` so
  a reload with the panel open doesn't pay React's 300 ms Suspense reveal
  throttle). Cards are memoized, so autosave re-renders don't re-parse every
  note.

## Equations and diagrams in notes

A note stores **source**: `$…$` / `$$…$$` LaTeX, and ` ```mermaid ` /
` ```mindmap ` fences. The panel draws them (`note-blocks.tsx`), under one
rule: it must cost the document nothing. That means no slice of the reader's
12 ms-per-task math budget, no long frames, no new bundle, and no stored HTML.

**Copying a diagram.** On the page, a diagram is an SVG of node labels plus
Mermaid's injected stylesheet, which carries a per-render id. Neither is what
the author wrote. `MermaidBlock` and the mind-map block register their element
in `lib/markdown/diagram-sources.ts`, a `WeakMap` from element to
`{ lang, source }`. A `data-` attribute would put a second copy of a
multi-megabyte source into the DOM. The registering wrapper is
`display: contents`, so layout is unchanged. `selectionToMarkdown` takes the
lookup as `diagramOf`. Like an equation, touching any part of a diagram copies
the whole fence.

**Drawing an equation** (`NoteMath`):

```
on screen?  (useOnScreen: layout-effect check, then one shared IntersectionObserver)
  no  → LaTeX source in <code>
  yes → peekRenderedMath(latex, mode, renderer)   the reader's render cache
          hit  → markup, in the same commit (no flash of source)
          miss → idleTypesetter.typeset(…)        services/math/idle-typeset.ts
                   requestIdleCallback; one KaTeX render at a time while
                   timeRemaining() > 4 ms (one per timed-out callback)
                   → renderMathIdle → shared cache → markup
```

`renderMathIdle` (renderer.ts) is `renderMathSync` without the per-task
budget. It is never charged to that budget and never refused by it, because
idle callbacks only run when the browser has nothing else to do. It fills the
same cache, so the document's own copy of an equation becomes free too. It is
KaTeX only: an expression KaTeX can't draw stays as source rather than pulling
in MathJax (~1 MB) for a side panel, unless the document already drew it, in
which case the cache has it. The cache key includes the reader's renderer
preference, which DocsApp passes as `mathRenderer`.

**Drawing a diagram** (`NoteDiagram`): only when on screen, in an idle callback,
through the reader's `renderMermaid` cache. A diagram copied from a document is
the SVG the document already made. The SVG's id is suffixed per instance,
because Mermaid scopes its styles and arrowhead markers by that id, and two
copies on one page would otherwise share or steal them. A diagram the reader
itself would hand to its GPU engine, flatten to an image, or hold back as too
heavy (`decideDiagramRender(...) !== "svg"`, or `isRenderedDiagramTooLarge`) is
shown as source. Mind maps use the reader's `MindMapBlock`, lazily, when on
screen.

**First render waits for idle.** When the panel is open across a reload, it
mounts together with the document. The note list renders in an idle callback
of its own, not in the document's first React task.

### Measured

Production build, 300-equation note copied from a 300-equation document,
docked panel. Long animation frames ≥30 ms, 3 runs each:

| Step                                  | Before           | After                                     |
| ------------------------------------- | ---------------- | ----------------------------------------- |
| Open the panel (cache hits)           | 130 + 69 + 72 ms | none (9 equations drawn: those on screen) |
| Expand, then scroll all 300 into view | —                | none (all 300 drawn)                      |
| Reload with panel open (cold caches)  | 53–60 ms         | none, same as panel closed                |

Attribution (Long Animation Frames API): "before" was inserting 300 equations'
KaTeX markup, mostly hidden behind the fold. The same note shown as source had
no long frames. On reload, the panel's Markdown parse ran in the same React task
as the document's first render. After reload, the note's equations appear
≈665 ms in, once the document has typeset its own.

## Debugging

- **A note is missing from the panel.** Its fence isn't recognised (indented,
  inside a list or quote, or a misspelt info word), or its document is in the
  Bin. `parseAnnotations(file.content)` shows what the panel sees.
- **The right page opens but nothing flashes.** `rangeOfAddress` couldn't
  place the span: the content has no `data-src` stamps (converted HTML), or
  the note's body is empty.
- **An equation stays as source.** Off screen (by design); KaTeX can't parse
  it, or the renderer preference isn't KaTeX and the document hasn't drawn it
  (`renderMathIdle` returns `undefined`); or KaTeX failed to download.
  `mathRenderStats()` and `idleTypesetter.pending` show the cache and queue.
- **A diagram shows "could not be drawn".** `renderMermaid` threw. The same
  source fails in the reader too. A diagram shown as "Large diagram" was
  routed away from SVG by `decideDiagramRender`.
- **Copied Markdown contains UI text.** A component draws chrome without a
  button, `aria-hidden` or `data-viewer-ui`. Mark it, and add a case to
  `tests/notes.test.ts`.

## Known limits

- Embeds and media copy as nothing. A selection of only those falls back to
  the plain selected text. Diagrams copy as their fenced source.
- The panel draws diagrams in Mermaid's own theme. The reader's semantic node
  colouring is applied by its interactive stage after render, and isn't
  repeated here.
- Equations that need MathJax are drawn in a note only if the document has
  drawn them this session; otherwise they show as LaTeX.
- Local images (blob URLs) copy as their alt text. The URL dies with the page.
- With no documents left in the workspace, the empty-workspace screen has no
  viewer, so the Notes panel can't be opened until a document is added.
- Deleting a document deletes its notes: they are part of it.
- Notes and highlights can only be made in Markdown and text documents.

## Tests

- `tests/notes.test.ts`: clean copy (formatting, chrome removal, lists,
  tables, code, math, callouts, element boundaries), and the list read out of
  documents (order, ids, caching, Bin and non-Markdown files left out, search,
  pages, merged file).
- `tests/annotations.test.ts`: the fence format itself (see annotations.md).
- `tests/e2e/notes.spec.ts`: copy to notes → the ` ```note ` fence in the stored
  file and a card in the document → reload → panel search, edit, delete and
  Undo. Plus the narrow-screen sheet, and a note with an equation and a
  Mermaid diagram drawn from the cache.
- `tests/notes-rendering.test.ts` (8 cases): the idle typesetter (nothing
  outside idle time, deadline respected, guaranteed progress on timeout, one
  job per equation, KaTeX downloaded first), `renderMathIdle` never spending
  the reader's budget (a mutation that charges it fails the test), and diagram
  and mind-map fences in the clean copy.
