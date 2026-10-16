import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { copyText } from "@/lib/workspace/share";
import type { MathRendererType } from "@/services/math/types";
import { NOTE_COMPONENTS, NOTE_PLUGINS } from "./note-components";
import { NoteRenderContext, type NoteRenderSettings } from "./note-render-context";

/** Continuous, rendered notes with a copy icon at the top-right of the content. */
export function NotesFileView({
  markdown,
  mathRenderer,
}: {
  markdown: string;
  mathRenderer: MathRendererType;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  const render = useMemo<NoteRenderSettings>(
    () => ({ renderer: mathRenderer, visible: true }),
    [mathRenderer],
  );
  return (
    <section aria-label="Combined notes file" className="relative min-w-0">
      <button
        aria-label={copied ? "Copied" : "Copy content"}
        title={copied ? "Copied" : "Copy content"}
        onClick={() => {
          void copyText(markdown).then((ok) => {
            if (ok) setCopied(true);
            else toast.error("Couldn't copy notes. Please try again.");
          });
        }}
        className="absolute right-0 top-0 z-10 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring coarse:h-10 coarse:w-10"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <Copy className="h-3.5 w-3.5" aria-hidden />
        )}
      </button>
      <div
        aria-label="Combined notes content"
        className="docs-note [&>:first-child]:pr-9 coarse:[&>:first-child]:pr-12"
      >
        <NoteRenderContext.Provider value={render}>
          <ReactMarkdown remarkPlugins={NOTE_PLUGINS} components={NOTE_COMPONENTS}>
            {markdown}
          </ReactMarkdown>
        </NoteRenderContext.Provider>
      </div>
    </section>
  );
}
