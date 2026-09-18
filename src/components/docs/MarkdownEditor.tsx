import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Eye } from "lucide-react";
import { caretTop } from "@/lib/source-locate";
import type { FormatAction } from "@/lib/markdown-format";
import { TOOLBAR_ITEMS } from "@/lib/markdown-toolbar-items";
import { MarkdownToolbar } from "./MarkdownToolbar";

/**
 * The markdown source editor.
 *
 * The draft text used to be state on `MarkdownViewer`. Every keystroke
 * therefore re-rendered that entire component: the viewer header, the section
 * `<Select>` (which maps over every chunk in the document and word-counts each
 * one), the navigation footer and the saved-item context. Typing in a large
 * document was visibly behind the keyboard.
 *
 * The draft lives here now. A keystroke re-renders this component and nothing
 * else; the parent only hears about it when the reader commits with Done.
 *
 * Nothing is written automatically. A draft is persisted when — and only when —
 * the reader presses Done, and discarded when they press Cancel. There is no
 * debounce and no flush on the way out: an edit the reader did not commit is an
 * edit they did not make.
 */

/** Imperative surface the viewer's "Inspect in source" jump drives. */
export interface MarkdownEditorHandle {
  /** Focus the textarea and select `[start, end)`, scrolled into view. */
  select: (start: number, end: number) => void;
}

interface Props {
  /** Source to edit. Read once per document — the editor owns it after that. */
  initialContent: string;
  /** Identity of the document being edited; remounts the draft when it changes. */
  fileId: string;
  /**
   * Commit the draft and leave the editor. The only path that writes.
   *
   * Takes the id of the document the text came from, not just the text. A
   * commit can land after the parent has already switched files, and a save
   * that only carried content would be applied to whichever document happened
   * to be active by the time it arrived, overwriting it with the previous
   * file's draft. `content` is undefined when the draft never diverged from
   * what the editor opened with — there is nothing to write.
   */
  onDone: (fileId: string, content: string | undefined, cursorIndex?: number) => void;
  /** Leave the editor, discarding the draft. Passes back the cursor's source index. */
  onCancel: (cursorIndex?: number) => void;
  /** Shown when "Inspect in source" couldn't pin the text to a source span. */
  inspectMissed?: boolean;
  /**
   * Fired whenever the draft starts or stops differing from what the editor
   * opened with.
   *
   * The parent needs this to know whether leaving is destructive: navigating
   * away from an untouched editor should be silent, and only a draft with real
   * changes in it is worth stopping the reader for.
   */
  onDirtyChange?: (dirty: boolean) => void;
}

function MarkdownEditorImpl(
  { initialContent, fileId, onDone, onCancel, inspectMissed, onDirtyChange }: Props,
  handleRef: React.Ref<MarkdownEditorHandle>,
) {
  // The draft and the document it belongs to are one piece of state, set
  // together and read together.
  //
  // They used to be separate — `draft` here, `fileId` arriving as a prop — and
  // that is what lost documents. This component is not remounted on a file
  // switch when the parent reuses the instance, so for one commit `draft` still
  // held the previous document's text while `fileId` had already become the new
  // one. Any save firing in that window paired one file's text with another
  // file's id and overwrote it. Keeping them in a single object makes that pair
  // impossible to form: every save checks that the draft's own id still matches
  // the document being edited, and drops the write if it doesn't.
  const [draft, setDraft] = useState(() => ({ fileId, text: initialContent }));
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const setText = useCallback(
    (text: string | ((previous: string) => string)) =>
      setDraft((previous) => ({
        ...previous,
        text: typeof text === "function" ? text(previous.text) : text,
      })),
    [],
  );

  // Read by the commit path, so it doesn't have to be rebuilt on every
  // keystroke to see the latest text.
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // Switching documents re-seeds the draft. `fileId` rather than
  // `initialContent`, so a content echo from the parent doesn't clobber
  // whatever has been typed since.
  useEffect(() => {
    setDraft({ fileId, text: initialContent });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId]);

  useImperativeHandle(
    handleRef,
    () => ({
      select: (start, end) => {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.focus({ preventScroll: true });
        ta.setSelectionRange(start, end);
        ta.scrollTop = Math.max(0, caretTop(ta, start) - ta.clientHeight / 3);
        ta.scrollIntoView({ behavior: "smooth", block: "center" });
      },
    }),
    [],
  );

  // Tell the parent whether there is anything to lose. Held in a ref so an
  // inline callback from the parent doesn't re-run this on every keystroke, and
  // reported only on a transition rather than on every edit.
  const onDirtyChangeRef = useRef(onDirtyChange);
  onDirtyChangeRef.current = onDirtyChange;
  const dirty = draft.fileId === fileId && draft.text !== initialContent;
  useEffect(() => {
    onDirtyChangeRef.current?.(dirty);
  }, [dirty]);
  // Leaving the editor entirely is not "unsaved work" — whatever happens on the
  // way out (a flush, a cancel, a save) has already been decided by then.
  useEffect(() => {
    return () => onDirtyChangeRef.current?.(false);
  }, []);

  /**
   * Run a formatting action against the live selection.
   *
   * The new selection is written back in the same frame as the text, so the
   * reader never sees the caret jump to the end and come back. `setSelectionRange`
   * has to wait for React to commit the new value — setting it against the old
   * text would place it by the wrong offsets.
   */
  const applyFormat = useCallback(
    (action: FormatAction) => {
      const ta = textareaRef.current;
      if (!ta) return;
      const next = action({ text: ta.value, start: ta.selectionStart, end: ta.selectionEnd });
      if (
        next.text === ta.value &&
        next.start === ta.selectionStart &&
        next.end === ta.selectionEnd
      ) {
        return;
      }
      setText(next.text);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus({ preventScroll: true });
        el.setSelectionRange(next.start, next.end);
      });
    },
    [setText],
  );

  // Formatting shortcuts. Bound on the textarea rather than the window: these
  // are edits to *this* field, and a global binding would fire while the reader
  // was typing in the search box or a rename input.
  const onShortcut = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      for (const item of TOOLBAR_ITEMS) {
        if (!item.shortcut) continue;
        const parts = item.shortcut.split("+");
        if (parts.includes("Shift") !== event.shiftKey) continue;
        if (parts.includes("Alt") !== event.altKey) continue;
        // The last segment is the key itself. Compared case-insensitively, and
        // against `event.code` digits too: Alt on macOS rewrites `key` into a
        // symbol (⌥1 becomes "¡"), which would otherwise never match.
        const wanted = parts[parts.length - 1].toLowerCase();
        const matches = key === wanted || (/^\d$/.test(wanted) && event.code === `Digit${wanted}`);
        if (!matches) continue;
        event.preventDefault();
        applyFormat(item.action);
        return;
      }
    },
    [applyFormat],
  );

  const cancel = useCallback(() => {
    setText(initialContent);
    onCancel(textareaRef.current?.selectionStart);
  }, [initialContent, onCancel, setText]);

  /**
   * Commit and leave. The single write path.
   *
   * A draft that still carries the id of a document we have since left is not
   * this document's text, and is dropped rather than written to the wrong file.
   * An unchanged draft commits nothing, so Done on an untouched editor is not a
   * write.
   */
  const done = useCallback(() => {
    const pending = draftRef.current;
    const changed = pending.fileId === fileId && pending.text !== initialContent;
    onDone(fileId, changed ? pending.text : undefined, textareaRef.current?.selectionStart);
  }, [fileId, initialContent, onDone]);

  return (
    <div>
      {/* Sticky exit bar: leaving edit mode stays reachable no matter how far
          the reader scrolls. Single-pane editor keeps typing smooth — no live
          full-document re-render on every keystroke. */}
      <div className="sticky top-16 z-(--z-sticky) -mx-1 mb-4 flex items-center justify-between gap-3 rounded-lg border border-border bg-background/90 px-3 py-2">
        <span className="truncate text-xs font-medium text-muted-foreground">
          Editing — Done saves, Cancel discards
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={cancel}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-muted px-3 py-1.5 text-xs font-medium text-foreground transition-opacity hover:bg-muted/80 active:scale-95"
          >
            Cancel
          </button>
          <button
            onClick={done}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90 active:scale-95"
          >
            <Eye className="h-3.5 w-3.5" /> Done · Save
          </button>
        </div>
      </div>
      {inspectMissed && (
        <div className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-foreground">
          Couldn't pin that text to a spot in the source — the editor is open at the start of this
          section instead.
        </div>
      )}
      {/* Toolbar and field are one surface: the buttons act on the text
          directly below them, and a gap between the two would read as chrome
          belonging to the page rather than to this field.

          The toolbar is a plain header pinned to the top of that surface, not a
          sticky element. It was sticky once, which was wrong twice over: the
          offset had to guess the exit bar's height, and `position: sticky` does
          nothing useful inside this `overflow-hidden` box, which is not itself
          a scroll container — the row simply parked partway down the field. The
          editor scrolls as part of the page, so the header travels with it. */}
      <div className="overflow-hidden rounded-lg border border-border bg-muted/30 focus-within:border-primary/50">
        <div className="border-b border-border bg-background/90">
          <MarkdownToolbar onAction={applyFormat} />
        </div>
        <textarea
          id="markdown-source"
          ref={textareaRef}
          value={draft.text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onShortcut}
          spellCheck={false}
          className="min-h-[70vh] w-full resize-y bg-transparent p-4 font-mono text-sm leading-relaxed outline-none"
        />
      </div>
    </div>
  );
}

export const MarkdownEditor = memo(forwardRef<MarkdownEditorHandle, Props>(MarkdownEditorImpl));
