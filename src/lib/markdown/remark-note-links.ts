import { scanNoteLinks, noteUrl } from "./note-links.ts";

interface Node {
  type: string;
  value?: string;
  url?: string;
  children?: Node[];
  position?: { start: { offset?: number }; end: { offset?: number } };
  data?: { hProperties?: Record<string, unknown> };
}

/** Wiki links become normal anchors without rewriting the document's source positions. */
export function remarkNoteLinks() {
  return (tree: Node, file: { value: unknown }) => {
    const source = String(file.value);
    const links = scanNoteLinks(source).filter((link) => link.kind === "wiki" && !link.embed);
    const visit = (parent: Node) => {
      if (["code", "inlineCode", "link", "image", "html"].includes(parent.type)) return;
      if (!parent.children) return;
      parent.children = parent.children.flatMap((node) => {
        if (node.type !== "text") {
          visit(node);
          return [node];
        }
        const start = node.position?.start.offset;
        const end = node.position?.end.offset;
        if (start === undefined || end === undefined) return [node];
        let low = 0,
          high = links.length;
        while (low < high) {
          const middle = (low + high) >>> 1;
          if (links[middle].from < start) low = middle + 1;
          else high = middle;
        }
        const matches = [];
        for (let at = low; at < links.length && links[at].from < end; at++)
          if (links[at].to <= end) matches.push(links[at]);
        if (!matches.length) return [node];
        const out: Node[] = [];
        let rest = node.value ?? "";
        for (const link of matches) {
          const raw = source.slice(link.from, link.to);
          const at = rest.indexOf(raw);
          if (at < 0) continue;
          if (at) out.push({ type: "text", value: rest.slice(0, at) });
          out.push({
            type: "link",
            url: noteUrl(link.reference),
            children: [{ type: "text", value: link.label }],
            position: node.position,
          });
          rest = rest.slice(at + raw.length);
        }
        if (rest) out.push({ type: "text", value: rest });
        return out;
      });
    };
    visit(tree);
  };
}
