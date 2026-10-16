import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  Check,
  Copy,
  Download,
  FileInput,
  FileText,
  LayoutGrid,
  Maximize2,
  NotebookPen,
  Pencil,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { searchEntries, type NotebookEntry } from "@/lib/workspace/notes";
import { notesToMarkdown } from "@/lib/workspace/notes-markdown";
import { Modal } from "@/components/ui/modal";
import { colorHex } from "@/lib/markdown/annotations";
import { visibleInline } from "@/lib/search/rows";
import { copyText } from "@/lib/workspace/share";
import {
  cancelIdleCallbackSafe,
  hasModKey,
  requestIdleCallbackSafe,
} from "@/lib/platform/keyboard";
import type { MathRendererType } from "@/services/math/types";
import { NOTE_COMPONENTS, NOTE_PLUGINS } from "./note-components";
import { NoteRenderContext, type NoteRenderSettings } from "./note-render-context";
import { RoughWorkPanel, type RoughWorkProps } from "./RoughWorkPanel";
import { ComputePanel, type ComputeProps } from "./ComputePanel";
import { NotesFileView } from "./NotesFileView";

/** Whether a scratchpad's linked document can still be opened. */
export type NoteSourceState = "live" | "binned" | "missing";

export type NotesTab = "notes" | "rough" | "compute";

export interface NotesPanelProps {
  /**
   * Every note and highlight kept in the workspace's documents, by document
   * then by place (lib/workspace/notes.ts). Highlights are shown as plain text
   * with a dot of their colour, not painted.
   */
  entries: NotebookEntry[];
  /** The document's current name. */
  fileName: (fileId: string) => string | undefined;
  /** The title of the page an entry is on, when it has one worth showing. */
  entrySection: (entry: NotebookEntry) => string | undefined;
  /** Open the document on the note, or on the passage a highlight marks. */
  onOpen: (entry: NotebookEntry) => void;
  /** Rewrite a note's Markdown, in its document. */
  onUpdate: (entry: NotebookEntry, body: string) => void;
  /** Take it out of its document. */
  onRemove: (entry: NotebookEntry) => void;
  onMoveToRoughWork: (entry: NotebookEntry) => void;
  onClose: () => void;
  /** A note just added: scrolled to and marked briefly. */
  freshId?: string | null;
  /** The reader's math preference, so notes hit the same render cache. */
  mathRenderer?: MathRendererType;
  /**
   * `docked` is the desktop column, with its own title bar and scroller;
   * `sheet` sits inside a BottomSheet, which supplies both.
   */
  variant: "docked" | "sheet";
  tab: NotesTab;
  onTabChange: (tab: NotesTab) => void;
  /** The Rough work tab (see RoughWorkPanel). */
  roughWork: RoughWorkProps;
  /** The Compute tab (see ComputePanel). */
  compute: ComputeProps;
}

/**
 * The Notes panel: the notes and highlights kept in the workspace's documents,
 * searchable, editable, and each a link back to its place. Nothing is stored
 * here: every action rewrites the document that holds the note.
 *
 * It is a reading companion rather than a page, so it stays open beside the
 * document as the reader moves between documents.
 */
export function NotesPanel({
  entries,
  fileName,
  entrySection,
  onOpen,
  onUpdate,
  onRemove,
  onMoveToRoughWork,
  onClose,
  freshId,
  variant,
  mathRenderer = "auto",
  tab,
  onTabChange,
  roughWork,
  compute,
}: NotesPanelProps) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"cards" | "file">("cards");
  const [previewOpen, setPreviewOpen] = useState(false);
  // The notes themselves are first rendered in an idle period of their own.
  // When the panel is open across a reload it mounts alongside the document,
  // and parsing its notes in the same task added a ~45 ms frame to the
  // document's first render (measured: none with the panel closed).
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const handle = requestIdleCallbackSafe(() => setReady(true), 500);
    return () => cancelIdleCallbackSafe(handle);
  }, []);
  const total = entries.length;
  const visible = useMemo(
    () => searchEntries(entries, query, fileName, entrySection),
    [entries, query, fileName, entrySection],
  );
  // Build only when the file is requested; card search never limits the export.
  const mergedMarkdown = useMemo(
    () => (view === "file" || previewOpen ? notesToMarkdown(entries) : ""),
    [view, previewOpen, entries],
  );
  const download = () => {
    const markdown = mergedMarkdown || notesToMarkdown(entries);
    const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "notes.md";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const viewControls = total > 0 && (
    <div className={`flex items-center gap-1 pb-3 ${variant === "sheet" ? "pt-3" : "px-3"}`}>
      <div
        role="group"
        aria-label="Notes view"
        className="mr-auto inline-flex rounded-md bg-muted p-0.5"
      >
        {(["cards", "file"] as const).map((mode) => {
          const Icon = mode === "cards" ? LayoutGrid : FileText;
          return (
            <button
              key={mode}
              aria-pressed={view === mode}
              onClick={() => setView(mode)}
              className={`inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring coarse:min-h-10 ${view === mode ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {mode === "cards" ? "Cards" : "File"}
            </button>
          );
        })}
      </div>
      <NoteAction label="Preview all notes" onClick={() => setPreviewOpen(true)}>
        <Maximize2 className="h-3.5 w-3.5" />
      </NoteAction>
      <NoteAction label="Download all notes as Markdown" onClick={download}>
        <Download className="h-3.5 w-3.5" />
      </NoteAction>
    </div>
  );

  const search = total > 0 && (
    <div className={`relative ${variant === "sheet" ? "mt-3" : "px-3 pb-3"}`}>
      <Search
        className={`pointer-events-none absolute top-2.5 h-3.5 w-3.5 text-muted-foreground ${variant === "sheet" ? "left-2.5" : "left-5.5"}`}
        aria-hidden
      />
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && query) {
            e.stopPropagation();
            setQuery("");
          }
        }}
        placeholder="Search notes"
        aria-label="Search notes"
        className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring coarse:h-11"
      />
    </div>
  );

  const list = !ready ? null : total === 0 ? (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <NotebookPen className="mb-3 h-5 w-5 text-muted-foreground" aria-hidden />
      <p className="text-sm font-medium text-foreground">No notes yet</p>
      <p className="mt-1.5 max-w-64 text-xs leading-relaxed text-muted-foreground">
        Select text in a document and choose{" "}
        <span className="font-medium text-foreground">Copy selection to notes</span>, or highlight
        it. Notes are saved in the document itself, so they go wherever the file goes.
      </p>
    </div>
  ) : visible.length === 0 ? (
    <p className="px-6 py-10 text-center text-sm text-muted-foreground">
      No notes match “{query.trim()}”.
    </p>
  ) : (
    <ul className={`space-y-2 ${variant === "docked" ? "px-3 pb-6" : "pb-2"}`} aria-label="Notes">
      {visible.map((entry) => {
        const name = fileName(entry.fileId) ?? "Unknown document";
        if (entry.kind === "highlight")
          return (
            <HighlightCard
              key={entry.id}
              highlight={entry}
              name={name}
              section={entrySection(entry)}
              onOpen={onOpen}
              onRemove={onRemove}
              onMoveToRoughWork={onMoveToRoughWork}
            />
          );
        return (
          <NoteCard
            key={entry.id}
            note={entry}
            name={name}
            fresh={entry.id === freshId}
            mathRenderer={mathRenderer}
            onOpen={onOpen}
            onUpdate={onUpdate}
            onRemove={onRemove}
            onMoveToRoughWork={onMoveToRoughWork}
          />
        );
      })}
    </ul>
  );

  const tabs = <PanelTabs tab={tab} onTabChange={onTabChange} noteCount={total} />;
  const notesContent =
    view === "file" && total > 0
      ? ready && (
          <div className={variant === "docked" ? "px-3 pb-6" : "pb-2"}>
            <NotesFileView markdown={mergedMarkdown} mathRenderer={mathRenderer} />
          </div>
        )
      : list;
  const preview = (
    <Modal
      open={previewOpen}
      onOpenChange={setPreviewOpen}
      title="All notes"
      description={`${total} ${total === 1 ? "entry" : "entries"} merged into notes.md`}
      size="2xl"
      bodyClassName="p-4 sm:p-6"
      footer={
        <button
          onClick={download}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Download className="h-4 w-4" aria-hidden />
          Download Markdown
        </button>
      }
    >
      <NotesFileView markdown={mergedMarkdown} mathRenderer={mathRenderer} />
    </Modal>
  );
  const rough = ready && (
    <RoughWorkPanel {...roughWork} mathRenderer={mathRenderer} variant={variant} />
  );
  const computeTab = ready && (
    <ComputePanel {...compute} mathRenderer={mathRenderer} variant={variant} />
  );
  const other = tab === "rough" ? rough : computeTab;
  const panel = (children: React.ReactNode) => (
    <div id={`notes-tabpanel-${tab}`} role="tabpanel" aria-labelledby={`notes-tab-${tab}`}>
      {children}
    </div>
  );

  if (variant === "sheet") {
    // The sheet scrolls as a whole, so the tabs (and the search) stay pinned.
    return (
      <div>
        <div className="sticky top-0 z-20 bg-background pb-3">
          {tabs}
          {tab === "notes" && viewControls}
          {tab === "notes" && view === "cards" && search}
        </div>
        {panel(tab === "notes" ? notesContent : other)}
        {preview}
      </div>
    );
  }

  const body = panel(
    tab === "notes" ? (
      <>
        {viewControls}
        {view === "cards" && search}
        {notesContent}
      </>
    ) : (
      other
    ),
  );

  return (
    <section aria-label="Notes panel" className="flex h-full min-h-0 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 px-3">
        {tabs}
        <div className="flex-1" />
        <button
          onClick={onClose}
          aria-label="Close notes"
          title="Close notes"
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
      {preview}
    </section>
  );
}

const TAB_ORDER: NotesTab[] = ["notes", "rough", "compute"];

/**
 * Notes, Rough work and Compute: one panel for the reader's own working.
 * Arrow keys move between the tabs (wrapping), as in any tablist.
 */
function PanelTabs({
  tab,
  onTabChange,
  noteCount,
}: {
  tab: NotesTab;
  onTabChange: (tab: NotesTab) => void;
  noteCount: number;
}) {
  const refs = useRef<Partial<Record<NotesTab, HTMLButtonElement | null>>>({});
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = event.key === "ArrowRight" ? 1 : TAB_ORDER.length - 1;
    const next = TAB_ORDER[(TAB_ORDER.indexOf(tab) + step) % TAB_ORDER.length];
    onTabChange(next);
    refs.current[next]?.focus();
  };
  const item = (id: NotesTab, label: string, count?: number) => (
    <button
      ref={(el) => {
        refs.current[id] = el;
      }}
      id={`notes-tab-${id}`}
      role="tab"
      aria-selected={tab === id}
      aria-controls={`notes-tabpanel-${id}`}
      tabIndex={tab === id ? 0 : -1}
      onClick={() => onTabChange(id)}
      className={`relative inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring coarse:h-10 coarse:px-3.5 coarse:text-sm ${
        tab === id
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
      {!!count && <span className="tabular-nums text-muted-foreground">{count}</span>}
      {id === "notes" && tab === "notes" && noteCount > 0 && (
        <svg
          aria-hidden
          width="12"
          height="7"
          viewBox="0 0 12 7"
          className="pointer-events-none absolute left-1/2 top-full -mt-px -translate-x-1/2 overflow-visible"
        >
          <path
            d="M0 0 L6 6 L12 0"
            fill="var(--background)"
            stroke="var(--border)"
            strokeWidth="1"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
  return (
    <div
      role="tablist"
      aria-label="Notes panel"
      onKeyDown={onKeyDown}
      className="inline-flex items-center gap-0.5 rounded-lg bg-muted p-0.5"
    >
      {item("notes", "Notes", noteCount)}
      {item("rough", "Rough work")}
      {item("compute", "Compute")}
    </div>
  );
}

/** Card clicks open the source, while controls, links and text selection stay independent. */
function shouldOpenCard(event: React.MouseEvent<HTMLLIElement>): boolean {
  if (event.defaultPrevented) return false;
  if (
    event.target instanceof Element &&
    event.target.closest(
      "button, a, input, textarea, select, summary, [role='button'], [role='link'], [contenteditable='true']",
    )
  )
    return false;
  const selection = window.getSelection();
  return !(
    selection &&
    !selection.isCollapsed &&
    (event.currentTarget.contains(selection.anchorNode) ||
      event.currentTarget.contains(selection.focusNode))
  );
}

/** Taller than this and a note folds, so one long passage can't bury the rest. */
const FOLDED_HEIGHT = 288;

/**
 * One note. Memoized, with the panel's callbacks passed straight through:
 * the app re-renders on every autosave, and re-parsing every note's Markdown
 * each time would make a long notes list cost something while typing.
 */
const NoteCard = memo(function NoteCard({
  note,
  name,
  fresh,
  mathRenderer,
  onOpen,
  onUpdate,
  onRemove,
  onMoveToRoughWork,
}: {
  note: NotebookEntry;
  name: string;
  fresh: boolean;
  mathRenderer: MathRendererType;
  onOpen: (entry: NotebookEntry) => void;
  onUpdate: (entry: NotebookEntry, body: string) => void;
  onRemove: (entry: NotebookEntry) => void;
  onMoveToRoughWork: (entry: NotebookEntry) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const cardRef = useRef<HTMLLIElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (fresh) cardRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [fresh]);

  // Equations and diagrams are drawn only for notes on (or near) screen, so a
  // long list costs what is visible. Once drawn, a note stays drawn.
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const card = cardRef.current;
    if (!card || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setVisible(true);
        observer.disconnect();
      },
      { rootMargin: "300px 0px" },
    );
    observer.observe(card);
    return () => observer.disconnect();
  }, []);
  const render = useMemo<NoteRenderSettings>(
    () => ({ renderer: mathRenderer, visible }),
    [mathRenderer, visible],
  );

  // Measured rather than guessed from the text: a short note with a table or
  // an image can be taller than a long paragraph — and an equation or diagram
  // changes its height when it is drawn, so it is watched, not measured once.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const measure = () => setOverflows(body.scrollHeight > FOLDED_HEIGHT + 24);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    for (const child of body.children) observer.observe(child);
    return () => observer.disconnect();
  }, [note.body, draft]);

  useEffect(() => {
    if (draft === null) return;
    const field = fieldRef.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight + 2, 480)}px`;
  }, [draft]);

  const editing = draft !== null;
  const startEditing = () => {
    setDraft(note.body);
    requestAnimationFrame(() => fieldRef.current?.focus());
  };
  const save = () => {
    if (draft === null || !draft.trim()) return;
    onUpdate(note, draft);
    setDraft(null);
  };

  const sourceHint = `Go to this note in ${name}`;

  return (
    <li
      ref={cardRef}
      onClick={(event) => {
        if (!editing && shouldOpenCard(event)) onOpen(note);
      }}
      className={`group rounded-lg border bg-card p-3 transition-shadow has-[>button:focus-visible]:ring-2 has-[>button:focus-visible]:ring-ring ${editing ? "" : "cursor-pointer hover:border-primary/30"} ${
        fresh ? "border-primary/50 ring-2 ring-primary/25" : "border-border/70"
      }`}
    >
      {!editing && (
        <button
          type="button"
          onClick={() => onOpen(note)}
          aria-label={sourceHint}
          className="sr-only"
        />
      )}

      {editing ? (
        <div>
          <textarea
            ref={fieldRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && hasModKey(e.nativeEvent)) {
                e.preventDefault();
                save();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setDraft(null);
              }
            }}
            aria-label="Note text (Markdown)"
            spellCheck
            className="block min-h-28 w-full resize-y rounded-md border border-border bg-background p-2 font-mono text-xs leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="mt-2 flex items-center justify-end gap-1.5">
            <button
              onClick={() => setDraft(null)}
              className="h-7 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground coarse:h-10"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={!draft.trim()}
              title="Save (⌘/Ctrl+Enter)"
              className="h-7 rounded-md bg-foreground px-2.5 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40 coarse:h-10"
            >
              Save
            </button>
          </div>
        </div>
      ) : (
        <>
          <div
            ref={bodyRef}
            className="docs-note relative overflow-hidden"
            style={!expanded && overflows ? { maxHeight: FOLDED_HEIGHT } : undefined}
          >
            <NoteRenderContext.Provider value={render}>
              <ReactMarkdown remarkPlugins={NOTE_PLUGINS} components={NOTE_COMPONENTS}>
                {note.body}
              </ReactMarkdown>
            </NoteRenderContext.Provider>
            {!expanded && overflows && (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-linear-to-t from-card to-transparent"
              />
            )}
          </div>
          {overflows && (
            <button
              onClick={() => setExpanded((open) => !open)}
              className="mt-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {expanded ? "Show less" : "Show more"}
            </button>
          )}
        </>
      )}

      {!editing && (
        <div className="mt-2 flex items-center justify-end gap-0.5">
          <NoteAction
            label={copied ? "Copied" : "Copy note"}
            onClick={() => {
              void copyText(note.body).then((ok) => {
                if (!ok) return;
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </NoteAction>
          <NoteAction label="Move to rough work" onClick={() => onMoveToRoughWork(note)}>
            <FileInput className="h-3.5 w-3.5" />
          </NoteAction>
          <NoteAction label="Edit note" onClick={startEditing}>
            <Pencil className="h-3.5 w-3.5" />
          </NoteAction>
          <NoteAction label="Delete note" onClick={() => onRemove(note)} destructive>
            <Trash2 className="h-3.5 w-3.5" />
          </NoteAction>
        </div>
      )}
    </li>
  );
});

/**
 * A highlight, shown the way a note is rather than painted in its colour: a
 * list of yellow and pink blocks is hard to read, and the colour only has to
 * say "this one is a highlight". A small dot beside the actions does that.
 * The text is the document's own, so there is nothing to edit here — clicking
 * the card opens the passage, where it can be recoloured.
 */
const HighlightCard = memo(function HighlightCard({
  highlight,
  name,
  section,
  onOpen,
  onRemove,
  onMoveToRoughWork,
}: {
  highlight: NotebookEntry;
  name: string;
  section: string | undefined;
  onOpen: (entry: NotebookEntry) => void;
  onRemove: (entry: NotebookEntry) => void;
  onMoveToRoughWork: (entry: NotebookEntry) => void;
}) {
  const [copied, setCopied] = useState(false);
  const source = section ? `${name} › ${section}` : name;
  const hint = `Go to this highlight in ${source}`;
  // Its body is the passage's Markdown source; the card shows what it reads as.
  const text = useMemo(
    () => highlight.body.split("\n").map(visibleInline).join("\n"),
    [highlight.body],
  );

  return (
    <li
      onClick={(event) => {
        if (shouldOpenCard(event)) onOpen(highlight);
      }}
      className="group cursor-pointer rounded-lg border border-border/70 bg-card p-3 transition-colors hover:border-primary/30 has-[>button:focus-visible]:ring-2 has-[>button:focus-visible]:ring-ring"
    >
      <button
        type="button"
        onClick={() => onOpen(highlight)}
        aria-label={hint}
        className="sr-only"
      />

      <div className="docs-note">
        <p className="line-clamp-6 whitespace-pre-line">{text}</p>
      </div>
      {!highlight.target && (
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
          This passage is no longer in the document.
        </p>
      )}
      {highlight.label && (
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{highlight.label}</p>
      )}

      <div className="mt-2 flex items-center justify-end gap-0.5">
        <span
          data-highlight-dot
          aria-hidden
          className="mr-auto h-2 w-2 rounded-full ring-1 ring-foreground/10"
          style={{ backgroundColor: colorHex(highlight.color) }}
        />
        <NoteAction
          label={copied ? "Copied" : "Copy highlight"}
          onClick={() => {
            void copyText(text).then((ok) => {
              if (!ok) return;
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </NoteAction>
        <NoteAction label="Move to rough work" onClick={() => onMoveToRoughWork(highlight)}>
          <FileInput className="h-3.5 w-3.5" />
        </NoteAction>
        <NoteAction label="Delete highlight" onClick={() => onRemove(highlight)} destructive>
          <Trash2 className="h-3.5 w-3.5" />
        </NoteAction>
      </div>
    </li>
  );
});

function NoteAction({
  label,
  onClick,
  destructive,
  children,
}: {
  label: string;
  onClick: () => void;
  destructive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors coarse:h-10 coarse:w-10 ${
        destructive
          ? "hover:bg-destructive/10 hover:text-destructive"
          : "hover:bg-accent hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
