import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { remarkTasks } from "@/lib/markdown/markdown-tasks";
import { NoteCode, NotePre } from "./note-blocks";

/**
 * react-markdown renderers for notes, with remark-math parsing `$…$` (which,
 * with no rehype typesetter, arrives as `code.language-math`). A module
 * constant: a fresh object per render would remount every block.
 */
export const NOTE_COMPONENTS = { pre: NotePre, code: NoteCode } as Components;

/**
 * GFM for tables and task lists; remark-math so `$…$` is parsed as math (and
 * drawn by note-blocks.tsx). Read as plain Markdown, `\,` and `_` inside an
 * equation would be eaten as escapes and emphasis. `remarkTasks` reads the
 * reader's own `[]` / `[y]` boxes, which a note kept in a document can hold;
 * here they are shown, not toggled.
 */
export const NOTE_PLUGINS = [remarkGfm, remarkTasks, remarkMath];
