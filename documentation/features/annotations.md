# Highlights and notes in the Markdown

A reader's highlights and notes are written into the document's own Markdown,
as fenced blocks. Nothing about them is stored anywhere else.

````md
The light reactions convert light into chemical energy stored in ATP.

```yellownote Key idea
chemical energy
```

```note
Light reactions → ATP + NADPH, used by the Calvin cycle.
```
````

| Fence                                                           | Meaning                                                             |
| --------------------------------------------------------------- | ------------------------------------------------------------------- |
| ` ```note `                                                     | A note: Markdown of the reader's own, shown as a card where it sits |
| ` ```yellownote ` (`green`, `blue`, `pink`, `orange`, `purple`) | A highlight: its body is the exact source text it marks             |
| ` ```bluenote Definition `                                      | Anything after the info word is a label                             |

Only **unindented** fences count. Inside a code block, list or quote the same
text is ordinary code, so a document can still show the syntax (as this one
does, inside a ` ````md ` block).

## The problem

Highlights and notes used to be two arrays on the workspace record in
IndexedDB, beside the documents:

- **They didn't travel.** Copying, downloading or sharing a `.md` file left
  them behind. Another Markdown app, or another LocalDox workspace, saw none.
- **They had to be kept in sync by hand.** A highlight stored rendered-text
  offsets plus a quote and its context. Every edit above it shifted the
  offsets, so each paint re-searched the page and wrote "repairs" back to
  storage. Backup, two-tab merge, cross-workspace moves and sharing each needed
  their own code path for both arrays.
- **They cost storage twice.** A note copied the passage into the record, and
  every autosave rewrote the whole record.

## Mental model

Think of a printed book where you write in the margin. The pencil marks are on
the page, so whoever gets the book gets them too. There is no separate
notebook to lose or keep in step.

Checkboxes already work this way ([markdown-checkboxes.md](markdown-checkboxes.md)):
the source is the state, and a click rewrites only the bytes of one marker.
Highlights and notes are the same idea, one size up: a click rewrites only
one fenced block.

**Why a highlight sits after its passage, not around it.** A fence must be a
block of its own, but a highlight is usually part of a sentence. Wrapping the
words would break the paragraph apart. So the passage stays exactly where it
is, and the fence goes after the block that holds it, naming the text it
marks. The reader finds the **nearest copy of that text above the fence**
(its _target_), paints it, and hides the fence. Another Markdown app shows the
fence as a small code block under the paragraph, which is still readable.

## Architecture

```
file.content
   │
   ├─ parseAnnotations()               lib/markdown/annotations.ts   (pure)
   │     → [{ kind, color, label, body, span, bodySpan, target }]
   │
   ├─ remarkAnnotations                lib/markdown/remark-annotations.ts
   │     note            → <docs-annotation> (body parsed by the same processor)
   │     highlight+target → removed (the viewer paints the target)
   │     highlight, gone  → <docs-annotation data-orphan> in its colour
   │
   ├─ MarkdownViewer painter           target span → rangeOfAddress → CSS ::highlight()
   │
   ├─ MarkdownViewer menu              addHighlight / addNote / changeAnnotation /
   │                                   removeAnnotation → onContentChange → autosave
   │
   └─ Notes panel                      notebookEntries(files)  lib/workspace/notes.ts
         edit / delete / move          → rewriteDocument() in DocsApp
```

### `annotations.ts`: the only code that reads or writes the syntax

- **`parseAnnotations(source)`** is one line scan. It tracks every fence (an
  annotation inside a ` ````md ` block is just code) and headings. A cheap regex
  check first means a document without annotations costs a single `test()`.
- **The target** of a highlight is the nearest copy of its body above the
  fence that is in the same section (no heading in between) and not inside
  another annotation. That last rule matters when a note quotes the same words
  between the passage and the highlight. If there is no such copy, `target` is
  undefined and the highlight is _orphaned_.
- **`annotationOffset(source, end)`** decides where a new fence goes: after
  the top-level block holding the passage, and after any annotations already
  attached to it, so they stay in the order they were made. It never splits a
  list or a fenced code block, and headings end a block.
- **`addHighlight`** trims the selection's span and takes in emphasis markers
  hugging it (`**bold words**`, not `bold words**`), so the stored text is
  balanced Markdown. A highlight it overlaps is replaced, as painting over a
  mark does. Removal happens first, then placement on the result, so the two
  edits can't collide.
- **`annotationBlock`** picks a fence longer than any backtick run inside the
  body (a note holding a code block gets ` ```` `), and keeps labels on one
  line.
- **`findAnnotation(source, previous)`** finds "the same annotation" again in
  newer text: same kind and body, nearest position. The panel and the edit
  menu use it right before writing, so an edit made since the last render
  can't make them rewrite the wrong block.

### Rendering a note

`remarkAnnotations` runs first among the remark transforms. It parses a
note's body with **the same processor** (`this.parse`), so math, GFM, task
boxes and wiki links behave exactly as elsewhere in the document. Then it
**shifts every node's position** to where the body sits in the file. Every
later pass reads true file positions as a result: a task box in a note toggles the right line,
and selecting text inside a note gets the right source address
([source-addressing.md](source-addressing.md)).

The card (`AnnotationCard.tsx`) has a small label row marked `data-viewer-ui`,
so copying or addressing a selection reads the note's own text, never "Note".
It uses `role="note"` rather than `<aside>`: a document with forty notes
shouldn't have forty landmarks.

### Painting a highlight

The target is a **file span**, so the viewer asks the page for it with
`rangeOfAddress` (the same lookup note links and search hits use) and paints
it with the CSS Custom Highlight API. There is no re-anchoring and no repair
write-back. Editing text above a highlight moves the fence along with the
passage, and the next paint simply reads the new span.

## Flows

**Highlight a selection**

```
mouseup → openCreateMenu (keeps a clone of the Range)
colour → highlightSelection
         menuAddress()  (addressOfRange) ?? locateInSource(quote, exact)
         addHighlight(content, span, colour, label)
         writeContent → onContentChange(file.id, content)   ← same path as a checkbox
         → DocsApp setFiles + markDirty → autosave (700 ms)
         → re-render → remark hides the fence → painter paints the target
```

**Copy selection to notes**: the same flow, with `selectionToMarkdown` for the
body ([notes-panel.md](notes-panel.md)) and `addNote`. DocsApp's
`onAnnotated` shows "Copied to notes" and marks the new card in the panel.

**Panel actions** (edit, delete, move to rough work) go through
`rewriteDocument(fileId, transform)` in DocsApp. It reads text still sitting
in an open editor first (`readOpenEditor`), applies the change, and rewrites
that editor in place (`rewriteOpenEditor`). Without this, the editor's next
autosave would put its older draft back over the change. Delete and Move offer
**Undo**. Undo restores the document as it was if nothing has changed since,
and otherwise puts the block back where it was.

**Rough work → note** appends a ` ```note ` to the end of the pad's document.
A pad with no live document saves into the workspace's `Notes.md`, which is
created the first time it is needed.

## Where it shows up

| Surface              | Behaviour                                                                                                 |
| -------------------- | --------------------------------------------------------------------------------------------------------- |
| Reader               | Notes and orphaned highlights as cards; highlights painted; fences hidden                                 |
| Editor (source)      | The raw fences, editable like any Markdown                                                                |
| Notes panel          | Every annotation in every live Markdown document, by file then position (`notebookEntries`)               |
| Search               | Note bodies are indexed as Markdown; highlight bodies are skipped, because the passage is already indexed |
| Long documents       | The segmenter never cuts between a passage and its fences (`isAnnotationFence`)                           |
| highlight.js loading | Annotation fences aren't code; a document whose only fences are annotations doesn't fetch it              |
| Download / copy      | The file as written, fences included                                                                      |
| Share                | Fences are stripped unless the sender opts in (`stripAnnotations`), since shares upload to a host         |
| Backup, merge, move  | Nothing special: the fences are file content                                                              |

## Trade-offs

- **The passage text is stored twice** in a highlight's fence. That is the
  price of a format that survives other Markdown apps and needs no offsets. It
  is far smaller than the old record, which stored the quote, its context and
  the offsets on every autosave.
- **A highlight follows text, not position.** If the passage is edited, the
  fence no longer matches and the highlight shows as an orphaned card. It is
  never silently dropped, and it is never moved onto different text. The old
  model re-anchored by quote, which could land on the wrong copy.
- **No creation times.** The panel lists entries by document, then by
  position, rather than newest first.
- **Notes now belong to their document.** Deleting the document deletes its
  notes; while it is in the Bin they are hidden from the panel and come back
  with it.
- **Plain fences, not a new syntax.** ` ```yellownote ` is valid CommonMark
  everywhere. HTML comments or `==mark==` would hide the data, or not parse,
  in many readers.
- **Existing stored highlights and notes were discarded**, not migrated (a
  product decision). Old records, backups and share links still load, and the
  legacy arrays are dropped (`withoutWorkspaceType`, `import-schema.ts`).

## Debugging

- **A highlight shows as "passage not found" but the text is there.** The
  target must sit above the fence, in the same section, outside other
  annotations, and match **byte for byte**, including `**` and line breaks.
  Run `parseAnnotations(file.content)` in the console and compare `body` with
  the source.
- **A fence shows as a code block.** Either it's indented, or it's inside a
  list or quote, or the info word isn't `note` / `<colour>note` (` ```{yellow}note `
  and ` ```notes ` are ordinary code).
- **A highlight isn't painted, but no card shows either.** The target exists,
  but `rangeOfAddress` couldn't place it. Usually the passage is on another
  page (paged mode), or the content has no `data-src` stamps (converted HTML).
- **A panel edit "changed in its document".** `findAnnotation` found no
  annotation with the same kind and body. The text was edited in between.
  Nothing is written in that case.

## Tests

- `tests/annotations.test.ts`: parsing (labels, CRLF, unclosed fences, fences
  ignored inside code, indented, quoted or misnamed), target rules (section,
  notes skipped), placement (lists, code, headings, existing annotations),
  overlap replacement, emphasis balancing, change, remove, strip, find, the
  remark rendering (task-line numbers inside a note), segmenting and search
  rows.
- `tests/notes.test.ts`, `tests/notes-markdown.test.ts`: the panel's entries,
  caching, search, pages and the merged file.
- `tests/backup.test.ts`: legacy arrays dropped on import and on load, and
  share stripping.
- e2e: `highlighting.spec.ts`, `notes.spec.ts` (create, persist, reload, panel
  edit/delete/undo).
