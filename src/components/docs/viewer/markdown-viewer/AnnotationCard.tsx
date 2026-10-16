import type { CSSProperties, ReactNode } from "react";
import { Highlighter, NotebookPen } from "lucide-react";
import { colorHex, type AnnotationColor } from "@/lib/markdown/annotations";

/**
 * A note kept in the document (```note), or a highlight whose passage is gone
 * (see remark-annotations.ts). Attributes arrive exactly as the remark pass
 * wrote them, as for the math elements.
 *
 * The heading row is viewer chrome (`data-viewer-ui`): copying a selection or
 * addressing it reads the note's own text, never "Note".
 */
export function AnnotationCard(props: {
  children?: ReactNode;
  "data-kind"?: string;
  "data-color"?: string;
  "data-label"?: string;
  "data-orphan"?: string;
}) {
  const orphan = props["data-orphan"] === "true";
  const color = props["data-color"] as AnnotationColor | undefined;
  const label = props["data-label"];
  const title = orphan ? "Highlight · passage not found" : "Note";
  const Icon = orphan ? Highlighter : NotebookPen;
  return (
    <div
      role="note"
      aria-label={label ? `${title}: ${label}` : title}
      className="docs-annotation"
      data-orphan={orphan ? "" : undefined}
      style={color ? ({ "--annotation": colorHex(color) } as CSSProperties) : undefined}
    >
      <p className="docs-annotation-label" data-viewer-ui="">
        <Icon className="h-3 w-3 shrink-0" aria-hidden />
        <span>{title}</span>
        {label && <span className="docs-annotation-tag">{label}</span>}
      </p>
      {props.children}
    </div>
  );
}
