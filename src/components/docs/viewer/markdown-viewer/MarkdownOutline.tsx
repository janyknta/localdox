import { useLayoutEffect, useMemo, useRef } from "react";
import { FileText } from "lucide-react";
import { parseHeadings, type MdHeading } from "@/lib/markdown/markdown-utils";

export function MarkdownOutline({
  source,
  fileId,
  fileName,
  onOpen,
}: {
  source: string;
  fileId: string;
  fileName: string;
  onOpen: (headingId: string) => void;
}) {
  const headings = useMemo(() => parseHeadings(source, fileId), [source, fileId]);
  const diagramRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const diagram = diagramRef.current;
    // Wide trees can be explored horizontally; open on the root, rather than
    // on the leftmost branch, even on a phone.
    if (diagram) diagram.scrollLeft = (diagram.scrollWidth - diagram.clientWidth) / 2;
  }, [headings]);
  const renderBranch = (branch: MdHeading[]) => (
    <ul className="md-outline-branch">
      {branch.map((heading) => (
        <li key={heading.id}>
          <button
            type="button"
            onClick={() => onOpen(heading.id)}
            className="md-outline-node flex min-h-16 w-44 flex-col items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-3 py-3 text-center text-sm font-medium text-foreground shadow-sm transition-colors hover:border-primary/50 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="shrink-0 font-mono text-[10px] font-medium text-muted-foreground">
              H{heading.level}
            </span>
            <span className="w-full wrap-break-word">{heading.text}</span>
          </button>
          {heading.children.length > 0 && renderBranch(heading.children)}
        </li>
      ))}
    </ul>
  );
  return (
    <nav aria-label="Markdown outline" className="w-full min-w-0">
      <div
        ref={diagramRef}
        role="region"
        aria-label="Markdown tree diagram"
        tabIndex={0}
        className="overflow-x-auto rounded-xl border border-border/50 bg-muted/10 p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-6"
      >
        <div className="md-outline-tree w-max min-w-full py-2">
          <div className="md-outline-root mx-auto flex min-h-20 w-52 flex-col items-center justify-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-center text-sm font-semibold text-foreground">
            <FileText aria-hidden="true" className="h-4 w-4 shrink-0 text-primary" />
            <span className="w-full wrap-break-word">{fileName}</span>
          </div>
          {headings.length > 0 && renderBranch(headings)}
        </div>
      </div>
      {headings.length ? (
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Select a section to open it in Preview.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          This document has no headings. Add Markdown headings to see its outline here.
        </p>
      )}
    </nav>
  );
}
