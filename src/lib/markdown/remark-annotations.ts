// Renders the annotations kept in a document's Markdown (see annotations.ts).
//
// - A note becomes `<docs-annotation>` holding its body, parsed as Markdown by
//   this same processor, so math, task boxes, links and diagrams inside a note
//   behave as they do anywhere in the document.
// - A highlight whose passage is still above it renders nothing: the viewer
//   paints the passage itself. One whose passage is gone becomes a card in its
//   colour, so it can be seen, fixed or deleted.
//
// The body's nodes are shifted to the body's place in the file. Every later
// pass then reads true source positions: task boxes toggle the right line,
// and source addressing maps selections inside a note to the note's text.

import { parseAnnotations, type Annotation } from "./annotations.ts";

/** The element a note (or an orphaned highlight) renders as. */
export const ANNOTATION_ELEMENT = "docs-annotation";

interface Point {
  line: number;
  column: number;
  offset?: number;
}

interface Node {
  type: string;
  children?: Node[];
  position?: { start: Point; end: Point };
  data?: { hName?: string; hProperties?: Record<string, unknown> };
}

function shift(node: Node, offset: number, lines: number) {
  const move = (point: Point) => {
    point.line += lines;
    if (point.offset !== undefined) point.offset += offset;
  };
  if (node.position) {
    move(node.position.start);
    move(node.position.end);
  }
  node.children?.forEach((child) => shift(child, offset, lines));
}

export function remarkAnnotations(this: { parse: (document: string) => unknown }) {
  // An arrow function, so `this` is still the processor when it runs.
  return (tree: Node, file: { value: unknown }) => {
    if (!tree.children) return;
    const source = String(file.value);
    const annotations = parseAnnotations(source);
    if (!annotations.length) return;
    const byStart = new Map<number, Annotation>(annotations.map((a) => [a.span.start, a]));

    // Annotations are top-level blocks: an unindented fence can't sit in a
    // list or a quote.
    tree.children = tree.children.flatMap((node) => {
      if (node.type !== "code" || !node.position) return [node];
      const annotation = byStart.get(node.position.start.offset ?? -1);
      if (!annotation) return [node];
      if (annotation.kind === "highlight" && annotation.target) return [];

      const body = this.parse(annotation.body) as Node;
      // Body line 1 is the line after the opening fence.
      body.children?.forEach((child) =>
        shift(child, annotation.bodySpan.start, node.position!.start.line),
      );
      return [
        {
          type: "annotation",
          children: body.children ?? [],
          position: node.position,
          data: {
            hName: ANNOTATION_ELEMENT,
            hProperties: {
              "data-kind": annotation.kind,
              "data-color": annotation.color,
              "data-label": annotation.label,
              "data-orphan": annotation.kind === "highlight" ? "true" : undefined,
            },
          },
        },
      ];
    });
  };
}
