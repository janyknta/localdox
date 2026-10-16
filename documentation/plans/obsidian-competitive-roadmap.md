# LocalDox vs Obsidian: feature and UI roadmap

Reviewed 6 October 2026. This is a planning document; no application features were implemented by this review.

LocalDox's strongest opportunity is an integrated learning and research workspace: read a source, write and connect an idea, work through an equation or drawing, practise it, and review what needs attention. The present implementation has substantial reading and study capabilities, but important parts of Obsidian's everyday knowledge-management workflow are missing. Adding more specialised tools alone will not make it a stronger Obsidian replacement.

## Evidence and limits

All four supplied transcripts were read in full:

- [Obsidian 80 Tips (1)](../../Obsidian%2080%20Tips%20%281%29.txt): capture speed, plain-file ownership, links and backlinks, rename safety, navigation, templates, properties, Bases, Canvas, and keeping the setup simple. Despite the filename, this is an essential-features walkthrough, not an enumerated list of eighty tips.
- [Obsidian in 24 Minutes](../../Obsidian%20in%2024%20Minutes.txt): AI retrieval, agents writing to a knowledge store, and an AI-managed wiki with immutable sources, generated pages, a schema, an index and an append-only activity log. These are workflows built around Obsidian and external tools, not evidence that all of them are native Obsidian features. The sponsored email segment is excluded from the competitor feature inventory.
- [Obsidian Learning Tools Guide](../../Obsidian%20Learning%20Tools%20Guide.txt): source notes, short independent idea notes, topic hubs, templates, meaningful links, writing in one's own words, and avoiding setup perfectionism. These are supported workflows, not a mandatory folder structure for our users.
- [Obsidian After 9 Months Full-Time Physics Student](../../Obsidian%20After%209%20Months%20Full-Time%20Physics%20Student.txt): fast keyboard access, LaTeX, cross-subject connections, dissatisfaction with plugin clutter, mobile sync cost and handwriting. These are one student's experiences, not a current exhaustive feature audit.

The app comparison uses the current working tree, including existing staged and unstaged work, implementation files, feature documentation and test coverage. References below describe source evidence, not tests run during this review. A local preview started, but the computer-use tool reported no enabled browsers; visual appearance, interaction quality and performance were therefore not verified in a rendered browser. UI findings are implementation-based recommendations. Proposed performance and usability targets are future acceptance criteria, not current measurements.

Current official Obsidian documentation was checked to avoid treating old transcript claims as today's baseline:

- Obsidian already supports wikilinks, Markdown links, heading/block references, link completion and automatic link updates on rename. [Internal links](https://obsidian.md/help/links).
- Obsidian already has Live Preview and Source mode. A polished live editor would close a parity gap. [Views and editing mode](https://obsidian.md/help/edit-and-read).
- Bases already offers database-like views over files and properties; its documentation lists table, list, cards, Kanban and map layouts. Some layouts can come from community plugins. [Introduction to Bases](https://obsidian.md/help/bases).
- Canvas already connects notes, media and web pages in an open `.canvas` format. A drawing board by itself does not replace linked knowledge cards. [Canvas](https://obsidian.md/help/Plugins/Canvas).
- Obsidian already has an official Web Clipper and a CLI. Neither a clipper nor agent access is a unique differentiator on its own. [Web Clipper](https://obsidian.md/clipper), [CLI](https://obsidian.md/help/cli).
- Sync currently starts at US$4 per user/month billed annually or US$5 billed monthly, with a 40% education/nonprofit discount. The physics transcript's US$10/month complaint should not anchor current pricing decisions. Sync includes end-to-end encryption and version history. [Pricing](https://obsidian.md/pricing).

We cannot substantiate a claim of superiority over every Obsidian community plugin from these materials. The practical competitive target is stronger integrated workflows with less setup, while closing the essential core gaps.

## What we already have

| Area | Current LocalDox evidence | Remaining gap |
| --- | --- | --- |
| Local operation and recovery | IndexedDB workspaces, offline shell/optional downloads, draft journal, save/conflict state, browser storage protection, recoverable Bin | A workspace is not a normal filesystem vault. No device-sync service or user-facing revision browser was found. |
| Editor and reading | CodeMirror Markdown source editor, formatting, autosave, undo, folding, preview, pagination/single-page mode, heading tree and wrapped sections | No in-place Live Preview editing or internal-link completion was found. The heading tree is an outline, not a graph of notes. |
| Navigation and search | Nested folders, drag moves, cross-workspace literal search, exact source jumps, browser history, resizable split panes | Cmd/Ctrl+K opens search, not an action palette. Pane tab state exists, but the displayed split UI deliberately has no tab strip. |
| Links and media | Local path/artifact resolution, Markdown document embeds, images, PDF/other document previews, audio/video playback and packaged HTML/media export | No wikilink/backlink index, aliases, block transclusion or rename-safe rewriting of references was found. `renameFile` changes the name/kind only. |
| Notes and rough work | Source-linked copied passages, highlights, editable note cards, combined notes view, scratchpads and insertion into a document | These are not a complete linked atomic-note workflow. Bookmarks/stars survive in storage but their user-facing creation and display were removed. |
| Drawing | Native infinite board, shapes, connectors, images, text, pressure-sensitive pen/highlighter, undo and exports | No live note cards or references were found. Freehand drawing exists; a paged notebook and PDF ink workflow remain opportunities. |
| STEM and interactive learning | Multiple math renderers, equation references, visual math keyboard, worker-based local computation, Mermaid/mind maps, sandboxed interactive React/HTML | Do not rebuild these. Connect them to notes, practice and review. Compute supports a bounded set of arithmetic/algebra/basic calculus, not a general CAS. |
| Exams and practice | `.xam` papers, `.xrule` rules, `.xp` immediate-feedback practice, timed/resumable attempts, scoring and answer/solution review; diagnostics engine retained | No note-linked spaced-repetition system was found. Rich diagnostics are not exposed as a complete learner dashboard. Exam data lives in separate feature stores and is excluded from the document-workspace JSON backup. |
| AI | Native BYOK OpenAI/Google actions, selection/document/explicit multi-document context, streaming, output insertion/new document | Context is capped at 12,000 characters with head/tail truncation. No automatic workspace retrieval with verifiable passage citations, local-model endpoint, or managed wiki workflow was found. |
| Appearance and accessibility | Light/dark modes, reading fonts and width controls, touch adaptations, focus/ARIA work, responsive settings, quiet sidebar | Build on this foundation. Consistent capture, open-document navigation, tool discovery and mobile flows are more consequential than decorative themes. |

Implementation anchors:

- [Workspace persistence](../../src/lib/workspace/persistence.ts), [storage protection](../../src/components/docs/pages/settings/StorageProtection.tsx), [draft journal](../../src/lib/workspace/draft-journal.ts).
- [Pane operations](../../src/lib/workspace/panes.ts), [app shell and rename/create/search handling](../../src/components/docs/DocsApp.tsx), [literal search index](../../src/lib/search/document-index.ts), [search panel](../../src/components/docs/workspace/sidebar/SearchPanel.tsx).
- [Source editor](../../src/components/docs/editor/MarkdownSource.tsx), [Markdown plugin pipeline](../../src/lib/markdown/markdown-plugins.ts), [preview modes](../features/markdown-preview-modes.md), [source addressing](../features/source-addressing.md).
- [Artifact resolution and embeds](../../src/lib/workspace/workspace-artifacts.ts), [media](../features/markdown-media.md), [legacy saved items](../../src/lib/workspace/saved-items.ts), [combined notes](../../src/lib/workspace/notes-markdown.ts).
- [Boards](../features/boards.md), [rough work](../features/rough-work.md), [math computation](../features/math-compute.md), [interactive examples](../features/interactive-examples.md).
- [Exam sessions and backup limitations](../features/exam-sessions.md), [result UI](../../src/services/exams/Reports.tsx), [AI context selection](../../src/services/ai/context.ts), [AI actions](../../src/services/ai/actions.ts).

## Priorities

P0 means an essential requirement before claiming to be a dependable Obsidian replacement. P1 means the next high-value parity or differentiation work. P2 broadens workflows once the foundations work. P3 is low priority until usage establishes a need. These are product priorities, not incident severity or promised delivery dates. Order within a tier is the suggested implementation sequence; dependencies can move work earlier.

Effort is relative: S = contained addition; M = multiple components/data paths; L = substantial subsystem; XL = platform/service work. These are rough planning estimates, not time commitments.

### P0 — core replacement requirements

| ID | Feature | Current state | What to implement and how to judge completion | Effort |
| --- | --- | --- | --- | --- |
| 01 | Connected-note foundation — implemented | Workspace note index, wikilinks and Markdown links, aliases, completion, heading/block links and embeds, missing-note creation, Connections footer, rename/move reference repair | Delivered for the active workspace. Duplicate titles show an explicit choice; open drafts receive reference repairs. See [Connected notes](../features/connected-notes.md) for behavior and scope. | L |
| 02 | Instant capture, action palette and quick switcher | Creation uses a blocking name prompt; Cmd/Ctrl+K searches content | Create an untitled note immediately, focus its editor, and rename in place. Provide fuzzy file switching and a searchable action registry with discoverable/remappable shortcuts. Core capture, open, split, template and link actions must work from the keyboard. | M |
| 03 | Live Preview editor — implemented | Source and Live Preview editing modes share one CodeMirror document and undo history | Delivered with active-block source editing, rendered math/media/callouts/tables/code, remembered mode, and bounded visible widgets. See [Markdown Live Preview](../features/markdown-live-preview.md). | L |
| 04 | Portable vaults and Obsidian migration | IndexedDB plus file exports/workspace backups | Import/export a folder-shaped vault with Markdown, original attachments, folder paths and portable companion metadata. Preserve frontmatter, links and unsupported files; report unresolved items. Add bidirectional folder access on supported platforms, with universal ZIP export/import as a fallback. A representative vault must survive a round trip without silent losses. | L |
| 05 | Complete history, backup and restore | Draft recovery, Bin and manual backup exist; exam history excluded | Add user-facing revisions with diffs/restoration and recoverable automated backups covering documents, notes, boards, practice progress, attempts and required feature-store data. Offer a plain-files export alongside a full-fidelity backup. Restore must recover the full learning workspace, including attempts. | L |
| 06 | Dependable, affordable encrypted device sync | No remote sync implementation found; sharing is snapshot handoff | Sync notes, attachments, annotations, boards and study state across desktop/tablet/phone. Include offline edits, conflict review, deletion tombstones, retries, recovery keys and visible sync status. Test divergent edits and interrupted uploads. Set pricing only after storage/bandwidth costs and the current discounted competitor price are understood. | XL |
| 07 | Coherent workspace UI and accessible navigation | Quiet sidebar, split columns, mobile drawer and responsive settings exist | Add a compact open-document switcher/tab option, optional path breadcrumbs, consistent panel/inspector rules and reachable mobile capture. Consolidate tool patterns while retaining focused exam mode. Complete focus/shortcut/touch/screen-reader workflows across reader, editor, board and study views. Show separate local-save and remote-sync state. | L |

P0 features 04–06 depend on a clear storage contract. Folder interoperability must not be advertised as universally available through a browser API; unsupported browsers need an explicit fallback or native integration. Offline caches and persistent-storage grants do not replace an independent backup. Sync is not a backup either.

### P1 — high priority: knowledge workflows and learning advantages

| ID | Feature | Current state | What to implement and how to judge completion | Effort |
| --- | --- | --- | --- | --- |
| 08 | Typed properties, tags and aliases | No general metadata editor/index found | Preserve YAML and add text/list/number/date/checkbox/link properties, nested tags, aliases and a tag browser. Suggest existing tags; allow controlled rename/merge. Unknown properties must survive edits and export. | M |
| 09 | Advanced search and discovery | Literal case-insensitive search with precise occurrence jumps | Add fuzzy title lookup separately from exact text search, property/tag/path/type filters, Boolean/phrase options, saved queries and previews. Include annotations and extracted document text when available; explain search scope and indexing state. | M |
| 10 | Reusable templates, daily notes and quick inbox | Exam/practice starter templates and scratchpads exist | Add user-editable note templates with date/title variables, a configurable default location, daily/weekly notes and capture inbox. Ship optional course/source/idea/project presets without requiring a setup wizard. | M |
| 11 | Source → idea → topic-hub workflow | Source-linked notes and combined view exist | Promote a selected passage or scratchpad to an independent idea note with a preserved citation; connect it to related notes and a map of content. Allow topic notes to grow into curated hubs. Keep the reader's words distinct from source quotes and generated content. | M |
| 12 | Useful local knowledge graph | Mind maps and heading tree exist, not a note graph | Use the link index to show local neighbours, cross-course connections, missing references and orphans with filters and a readable list alternative. Every node must navigate somewhere meaningful. Avoid rendering the entire library by default. | M |
| 13 | Canvas with live knowledge cards | Drawing board exists | Add searchable live note/section/PDF-page cards, link-aware connectors and jump-back actions to the native board. Source edits should update cards; circular references must remain bounded. Preserve drawing and portable serialization. | L |
| 14 | Tablet notebooks and PDF ink | Pressure-sensitive board pen exists; dedicated PDF ink not found | Extend the board engine with page backgrounds, notebook navigation, pen-first input, robust palm handling, PDF highlights/ink and source-linked handwritten explanations. Judge latency and pen behaviour on real iPad/Android hardware. Handwriting-to-text/math can follow later. | L |
| 15 | Workspace-wide AI with verifiable citations | Native document/multi-document actions exist; capped/truncated context | Retrieve relevant passages automatically instead of concatenating whole files. Give answers clickable source anchors, explicit scope and clear handling of insufficient evidence. Reuse the source-addressing system. Let users inspect source passages before accepting generated notes or edits. | L |
| 16 | Native active recall and spaced repetition | Exams and immediate-feedback practice exist; no recall scheduler found | Create editable question/answer or cloze cards from notes, include math/images, schedule reviews, keep progress and link every card back to its source. Suggested AI cards remain editable drafts. Due dates/progress must survive backup and sync. | L |
| 17 | Connected study dashboard and mistake notebook | Attempts, scoring and diagnostics engine exist; learner dashboard incomplete | Surface due reviews, recent mistakes, supporting explanations and next practice in one optional view. Connect questions to concept notes, and turn mistakes into targeted review items. Distinguish observed performance from inferred mastery; explain recommendations. | M |
| 18 | Bookmarks, collections and saved searches | Saved-item data retained but no current UI | Restore a deliberately scoped bookmarking surface for files, passages, hubs and queries; support collections and pinned starting points. Recover existing bookmark data visibly. Keep this distinct from highlights and copied notes. | M |

### P2 — medium priority: broader product depth

| ID | Feature | Current state | What to implement and how to judge completion | Effort |
| --- | --- | --- | --- | --- |
| 19 | Bases-style collections | Spreadsheet viewer exists; no views over note properties found | Build saved table/list/gallery/Kanban views over properties with filter/sort/group and later formulas. Edits write back to source metadata. Provide visual query controls so users do not need a query language. Existing spreadsheet viewing is not this feature. | L |
| 20 | Unified tasks and optional planning | Markdown task checkboxes and study records exist | Aggregate tasks with due dates, recurrence and source jumps; add an optional agenda/calendar and focused session timer. Keep planning usable without forcing journals or converting the app into a life-management system. | M |
| 21 | Web/research capture | File import/conversion exists; no clipper found | Save selected web text, readable article content, URL/title/date and citations from desktop/mobile capture. De-duplicate sources and place them in an inbox. This closes an official Obsidian Clipper gap; source-to-practice integration supplies differentiation. | L |
| 22 | Voice capture and time-linked transcripts | Audio/video playback exists | Record voice notes; optionally transcribe with explicit processing choices. Link summaries/notes to timestamps and retain the original recording. Handle permission denial, long recordings and interrupted saves. | M |
| 23 | Unified PDF/image/transcript search and OCR | PDF-specific text search and conversion exist | Index extracted text across document types; add OCR for scans/images with language selection and provenance. Clearly distinguish original from OCR text; search hits should land on the page/region or timestamp. | L |
| 24 | Local and configurable AI endpoints | OpenAI/Google providers implemented | Add a configurable compatible endpoint and local-model path with connection diagnostics, disclosed processing scope and sensible resource limits. Offline reading/capture must continue without any AI configuration. | M |
| 25 | Reviewable AI-managed wiki | Generated text can be inserted/saved; no lifecycle found | Support immutable raw sources, generated concept pages, schema, maintained index and append-only log. Implement ingest/query/lint as visible jobs, citation checks, stale/contradictory claim review and per-job rollback. Keep human-authored notes protected by default. | L |
| 26 | Agent API, CLI and integration protocol | No app-level external agent interface found | Expose scoped read/search/create/update operations, stable identities, revision checks, idempotent writes and change logs. Provide a CLI and optionally an MCP interface through the same contract. Obsidian already has a CLI; our advantage must be safe access to the complete learning workflow. | L |
| 27 | Academic references and citation tools | Reader/export tools and source note anchors exist | Add DOI/BibTeX/CSL-oriented metadata, page-level quotations, bibliography generation and reference-manager import/export. Verify citations against stored source data; do not let AI invent publication details. | M |
| 28 | Writing and assignment workbench | Markdown editing and PDF/DOCX/HTML export exist | Assemble referenced notes into an outline/draft, compare source and draft, rearrange sections and export consistently. Keep original notes reusable and retain attribution through compilation. | M |
| 29 | Purposeful appearance presets | Light/dark, fonts and reading controls exist | Add a few coherent paper/contrast/compact presets, system-theme following, density and token-based customisation. Preview changes before committing; maintain contrast and reduced-motion behaviour. Typography consistency matters more than theme count. | M |
| 30 | Native desktop/mobile integration | Browser application/offline assets exist | Add installation/onboarding polish and, where warranted, a native wrapper for filesystem vaults, external file watches, global capture, OS share flows and background work. Choose platforms from actual demand; browser limitations cannot be solved by a wrapper label alone. | XL |
| 31 | Small, permissioned extension SDK | Built-in tools and sandboxed interactive fences exist | Define narrow commands, views, parsers/importers and storage capabilities with versioning, isolation and permission declarations. Start with first-party examples. Interactive document execution is not already a general plugin system. | L |
| 32 | Large-library storage and import scale | Lazy Blob bodies, worker search and progressive rendering exist; open text library held in state | Measure 10k-note and large-attachment libraries, page metadata, load documents on demand and tune import/storage limits with safe accounting. Current uploads cap at 30 MiB/file and workspace use at 5% of browser quota; reconsider only with measured constraints and clear user controls. | L |

### P3 — low priority until demand is demonstrated

| ID | Feature | Why later | Scope if implemented | Effort |
| --- | --- | --- | --- | --- |
| 33 | Public plugin/theme marketplace | SDK, compatibility and maintenance processes must exist first | Curated discovery, signing/review, update controls, permissions and rollback. Do not promise drop-in compatibility with Obsidian's entire plugin ecosystem. | XL |
| 34 | Shared libraries and live collaboration | Personal capture, portability and sync are the immediate replacement needs | Shared permissions, comments/annotations and eventually simultaneous editing with clear conflict semantics. Shared sync and real-time collaboration are separate capabilities. | XL |
| 35 | Hosted publishing and course portals | Snapshot share links and HTML export already cover some handoff needs | Stable published URLs, selective publishing, access control, updates/revocation and linked-document navigation. Current share links are not a complete publishing service. | L |
| 36 | Broad external calendar/task/health integrations | Can recreate the transcript's clutter and distract from the learning workflow | Add only integrations demanded by a validated workflow, with an explicit read/write scope and import/export fallback. | L |
| 37 | Global graph analytics and animation | A local graph with actionable links delivers value earlier | Opt-in whole-vault graph, centrality/clustering and evolution views, with performance bounds and a useful list alternative. | M |
| 38 | Vim mode and advanced power editing | Core keyboard operations and Live Preview come first | Optional Vim mappings, multi-cursor/refactoring helpers and detailed command customisation. Avoid replacing the existing editor solely for these. | M |
| 39 | Random rediscovery and writing-habit statistics | Helpful but not a replacement blocker | Revisit selected older notes and show optional writing/review statistics without gamifying every action. | S |
| 40 | Decorative customisation and elaborate motion | Does little to improve capture, thinking or learning | Extra accent palettes, decorative surfaces and ornamental animation only when accessible and inexpensive. | S |

## UI direction

The intended UI advantage is lower effort to complete real work. A screenshot alone cannot establish that LocalDox is better.

1. **Capture opens directly into writing.** Replace the name-first `window.prompt` flow with an editable title and an immediate editor. Keep file creation available from an empty workspace, a keyboard command and a mobile control. Existing board creation already demonstrates the immediate-open pattern.
2. **The sidebar answers where I am; the switcher answers what I opened.** Preserve the quiet tree, improve reveal-current-file and provide visible open-document state when useful. Let users opt into tabs rather than filling every pane with permanent chrome. A file list is not the same as an open-document list.
3. **One predictable place for context.** Use a collapsible context inspector for links/properties/source information and an explicit Notes/Rough work/Compute working panel. On small screens, preserve the active document and last panel while using a sheet/full-screen tool as appropriate. New tools must not accumulate as unrelated floating buttons.
4. **One visual language across specialised tools.** Reuse control dimensions, spacing, icons, focus/error/loading states and command names across reading, editing, drawing and study. Keep exam-taking intentionally focused while making setup and results feel part of the same product.
5. **Help appears at the moment of need.** Suggest a template on a blank note, related notes when creating a link, and source details when promoting a passage. Keep Study/Research/Write starters optional and editable. Do not require users to choose a taxonomy before writing.
6. **Reading tools remain reading tools.** Preserve good typography, paginated/continuous choices, folding and outlines. A preview tree should not be relabelled as a knowledge graph. Add source/live/reading mode controls that preserve position and make their purpose clear.
7. **Trust is legible.** Show whether edits are saved locally, syncing, conflicted or backed up. AI actions identify what was read and what changed. Storage errors preserve a recoverable copy. Accessibility and performance are completion requirements for every feature, not later cosmetic upgrades.

## Suggested delivery sequence and dependencies

- **Foundation A:** 01 connected-note index, 02 capture/commands and 07 navigation. Start 05 full backup/history early because it protects migrations and subsequent automated edits.
- **Foundation B:** 03 Live Preview and 04 portable vault contract. Validate an Obsidian import/export corpus before expanding metadata and automation.
- **Cross-device release:** 06 sync over the established storage/revision contract. Ship this before claiming a dependable desktop/tablet/phone replacement. Native integration from 30 may need to move earlier if the selected platforms cannot meet this contract through the web application.
- **Knowledge release:** 08 properties, 09 search, 10 templates, 11 source/idea/hub flow and 18 bookmarks. Reuse the same link/property index for 12 local graph and 13 linked canvas.
- **Learning release:** 14 ink, 15 cited AI, 16 recall and 17 study dashboard. Start from the existing board, source anchors, practice and diagnostics modules rather than creating parallel subsystems.
- **Depth release:** 19–32 in demand order. Properties unlock collection views; citations/revisions unlock wiki automation; a stable command/storage contract unlocks agent and plugin APIs.
- **Ecosystem release:** 33–40 only after core workflows and usage justify them.

## How to demonstrate a competitive advantage

These are proposed evaluation gates. Record hardware, browser, library size, cold/warm state and percentile data; do not quote these numbers as measured today.

| Workflow | Suggested completion target |
| --- | --- |
| Capture | A returning user starts typing a new note with one command; no blocking name dialog. |
| Link and rename | A user creates a concept reference without leaving the editor; rename/move retains links, backlinks, embeds and exported references. |
| Retrieve | Fuzzy file switching and exact search remain distinct; warm search and file open should target p95 under 300 ms on a defined 10k-note reference library. Track indexing and cold-start separately. |
| Write | Target p95 input response under 50 ms on a defined math/media-heavy document. Verify IME, selection, undo, screen-reader output and small-screen behaviour. |
| Read → think | Select a passage, create an independent idea note with citation, connect it and revisit the precise source without manual copying between apps. |
| Study | Create/edit a recall item, complete a review, follow a mistake to an explanation and resume from another device with progress intact. |
| Draw | Measure visible pen response on physical tablets; target p95 under 30 ms on selected hardware and validate palm handling and PDF attachment anchors. |
| Trust | Recover from a crash, restore an older revision, restore the entire workspace including exams, and resolve a divergent two-device edit without silent overwrite. |
| AI | Evaluate representative questions for source support, correct anchors, explicit insufficient-evidence answers, sensible cost and reversible accepted edits. A citations badge alone is insufficient. |
| Simplicity | New users complete create/link/find/source-note/review tasks without configuring plugins. Compare completion rate/time and user preference against current Obsidian with comparable workflows. |

The strongest positioning to validate is: **connected, portable notes with a native read → explain → draw/compute → practise → review loop.** Core Obsidian parity gets users through the door; coherent learning workflows give them a reason to stay.
