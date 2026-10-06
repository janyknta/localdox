# Embeds and autosave

## The problem

With two documents side by side, typing in one reloaded the other one's
media. Every pause in typing (the editor autosaves after 600 ms) made every
`![[photo.png]]`, `![[clip.mp4]]` and `![[note.md]]` in every open pane
fetch a new object URL. Images were decoded again, and a video or audio clip
that was playing jumped back to 0 and stopped.

Measured on the production build, in a split with a 400-paragraph document
holding six 900×900 images, an audio clip and an embedded note, typing in
the other pane (see "Measuring and debugging"):

| Per autosave, in the pane not being typed in | Before                    | After             |
| -------------------------------------------- | ------------------------- | ----------------- |
| Object URLs created and revoked              | 12 and 12                 | 0 and 0           |
| `src` attributes replaced (images, audio)    | 10                        | 0                 |
| A playing audio clip                         | reset to 0:00 and stopped | keeps playing     |
| Main-thread time                             | ~20 ms above idle         | ~20 ms above idle |

## What does not happen

A tempting diagnosis is that the autosave makes every pane re-parse its
Markdown. It does not, and the reasons are worth knowing:

- `PaneDocument` filters highlights per pane inside `useMemo`, and typing
  doesn't change highlights, so the filtered list keeps its identity.
- The pane's own file record keeps its identity too. `handleContentChange`
  replaces only the record of the file being typed into
  (`prev.map(f => f.id === id ? {...} : f)`).
- react-markdown sits behind `memo` (`WholeDocument`, `Segment` in
  `ProgressiveMarkdown.tsx`), and its source, plugins and renderers are all
  stable, so it is skipped.

Making the document 10× longer raised the per-autosave cost only from
~20–35 ms to ~37–61 ms. A re-parse would scale with the document.

What does change on every autosave is the `files` array itself. It reaches
every renderer through `MarkdownRenderContext` as `media.workspaceFiles`.

## Why the media reloaded

An embed (`MarkdownMedia`, `InlineArtifact`) resolves its reference
(`photo.png`, `../Media/clip.mp4`, `@workspace/id`) against the workspace's
file list, then turns the file into an object URL. It re-resolved whenever
anything it read changed, including `workspaceFiles` and `workspaceRevision`,
which then included every file's content length. Both changed on every
autosave, so every embed tore down its URL and made a new one.

Embedded notes had a second cause. `EmbeddedMarkdown` built its plugin list
and renderer map inline, so each re-render re-parsed the note. Its renderers
were new component types each time, so React remounted every image in it.

## The mental model

Re-resolve when the answer could have changed, and only then. A reference's
answer depends on:

1. **Which files exist, under which name, in which folder.**
   `fileSetRevision(files)` captures exactly that (id, name, folder, binned)
   and nothing else. `DocsApp` passes it as `workspaceRevision`. An autosave
   leaves it unchanged.
2. **The file it resolved to.** If that record is replaced (edited, renamed,
   moved, re-imported), the embed must follow, so a live embed of a note you
   are typing into still updates. `useResolvedFileRefresh` notices with a
   cheap identity check (`files.includes(record)`) and bumps a counter the
   resolve effect depends on.
3. **The embedding document's folder**, for relative paths. Not its content.

```
autosave ─► setFiles(map one record) ─► files' identity changes
                                          │
             fileSetRevision unchanged ───┤
                                          ▼
              each embed: is the record I resolved to still in `files`?
                 yes ─► nothing (same URL; image and player untouched)
                 no  ─► re-resolve, new URL (the file really changed)
```

Embedded notes now use module-level plugins and renderers, and read their
resolution context from `EmbedMediaContext`. The parsed body is memoized on
the note's content.

## Where the code is

| File                                                      | Role                                                        |
| --------------------------------------------------------- | ----------------------------------------------------------- |
| `src/lib/workspace/workspace-artifacts.ts`                | `fileSetRevision`: what resolution depends on. Unit-tested. |
| `src/components/docs/viewer/use-resolved-file-refresh.ts` | Notices that a resolved record was replaced.                |
| `src/components/docs/viewer/MarkdownMedia.tsx`            | Images, players and links to workspace files.               |
| `src/components/docs/viewer/InlineArtifact.tsx`           | Embedded documents, including `EmbeddedMarkdown`.           |
| `src/components/docs/DocsApp.tsx`                         | Computes `workspaceRevision` once per change to `files`.    |

## Trade-offs

- The resolve effects deliberately leave the file list out of their
  dependencies (they read it, they don't watch it). The eslint exception
  there is intentional. Adding `workspaceFiles` back brings the reloads back.
- Records read from another workspace aren't tracked. That workspace can't
  change while this one is open in the tab, which was already true before.
- Renaming or moving a file still re-resolves every embed, because the
  revision changes. That is rare, and correctness there is worth one reload.
- The renderers that read `MarkdownRenderContext` still re-render on each
  autosave, because `workspaceFiles` is part of it. They bail out quickly.
  Splitting the context would remove that work. It wasn't worth the
  complexity at ~20 ms.

## Measuring and debugging

`tests/e2e/media.spec.ts` "typing in one split pane…" checks that the
reader's image and audio keep their object URLs while its embed of the edited
note follows the edit. It fails on the build before this change.

The probe that produced the table was a throwaway Playwright script. It
wrapped `URL.createObjectURL`/`revokeObjectURL` in an init script, counted
`src` mutations with a `MutationObserver`, and read
`Performance.getMetrics` (`TaskDuration`) over CDP around each autosave.

If media starts reloading while you type, count `URL.createObjectURL` calls
per autosave. Then check whether an effect in `MarkdownMedia` or
`InlineArtifact` has started depending on `workspaceFiles`, `sourceFile` or
an object rebuilt per render.
