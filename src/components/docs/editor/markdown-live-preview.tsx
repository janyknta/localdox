import { createRoot, type Root } from "react-dom/client";
import ReactMarkdown from "react-markdown";
import {
  StateField,
  StateEffect,
  EditorSelection,
  type EditorState,
  type Range,
} from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { useMarkdownPlugins } from "@/lib/markdown/markdown-plugins";
import { remarkMedia, mediaUrlTransform } from "@/lib/markdown/markdown-media";
import { prepareWorkspaceEmbeds } from "@/lib/workspace/workspace-artifacts";
import { scanNoteLinks, noteUrl } from "@/lib/markdown/note-links";
import { markdownComponents } from "../viewer/markdown-viewer/markdown-components";
import { MarkdownRenderContext } from "../viewer/markdown-viewer/contexts";
import { WorkspaceLinksContext } from "../workspace/WorkspaceLinksContext";
import { MathProvider } from "@/services/math/MathContext";
import { buildEquationRegistry, type EquationRegistry } from "@/services/math/equation-registry";
import { DEFAULT_MATH_PREFERENCES } from "@/services/math/types";
import type { MathPreferences } from "@/services/math/types";
import type { MediaContext } from "@/lib/markdown/media-context";
import { remarkInteractiveBlockMeta } from "../viewer/markdown-viewer/remark-interactive-block-meta";
import { useRef, type ContextType } from "react";

const EXTRA = [remarkMedia, remarkInteractiveBlockMeta];
export const refreshLivePreview = StateEffect.define<null>();
export interface LivePreviewContext {
  media?: MediaContext;
  workspace: ContextType<typeof WorkspaceLinksContext>;
  preferences?: MathPreferences;
  registry?: EquationRegistry;
}

function RenderedMarkdown({ source, context }: { source: string; context: LivePreviewContext }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const prepared = prepareWorkspaceEmbeds(source);
  const plugins = useMarkdownPlugins(prepared, EXTRA);
  const file = context.media?.sourceFile ?? { id: "preview", name: "", content: source };
  return (
    <WorkspaceLinksContext.Provider value={context.workspace}>
      <MarkdownRenderContext.Provider
        value={{
          file,
          media: context.media ?? {},
          anchorTargets: {},
          contentRef,
          onNav: (_id, fragment) => context.workspace?.follow(`#${fragment ?? ""}`, file.id),
          openLightbox: () => {},
        }}
      >
        <MathProvider
          source={file.content}
          registry={context.registry}
          preferences={context.preferences ?? DEFAULT_MATH_PREFERENCES}
        >
          <div ref={contentRef}>
            <ReactMarkdown
              {...plugins}
              components={markdownComponents}
              urlTransform={mediaUrlTransform}
            >
              {prepared}
            </ReactMarkdown>
          </div>
        </MathProvider>
      </MarkdownRenderContext.Provider>
    </WorkspaceLinksContext.Provider>
  );
}

/** Only mounted widgets render Markdown. The active block is always editable source. */
class MarkdownWidget extends WidgetType {
  private root?: Root;
  constructor(
    readonly source: string,
    readonly context: LivePreviewContext,
    readonly block: boolean,
  ) {
    super();
  }
  eq(other: MarkdownWidget) {
    return (
      this.source === other.source &&
      this.block === other.block &&
      this.context.workspace === other.context.workspace &&
      this.context.preferences === other.context.preferences &&
      this.context.registry === other.context.registry
    );
  }
  toDOM(view: EditorView) {
    const host = document.createElement(this.block ? "div" : "span");
    host.className = this.block ? "cm-live-block docs-prose" : "cm-live-inline docs-prose";
    host.setAttribute("contenteditable", "false");
    const content = document.createElement(this.block ? "div" : "span");
    host.append(content);
    this.root = createRoot(content);
    this.root.render(<RenderedMarkdown source={this.source} context={this.context} />);
    const edit = () => {
      const position = view.posAtDOM(host);
      view.dispatch({ selection: EditorSelection.cursor(position), scrollIntoView: true });
      view.focus();
    };
    if (this.block) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cm-live-edit";
      button.textContent = "Edit";
      button.setAttribute("aria-label", "Edit rendered Markdown block");
      button.addEventListener("click", edit);
      host.append(button);
    }
    host.addEventListener("dblclick", (event) => {
      if (!(event.target as Element).closest("a,button,input")) {
        event.preventDefault();
        edit();
      }
    });
    return host;
  }
  destroy() {
    const root = this.root;
    queueMicrotask(() => root?.unmount());
  }
  ignoreEvent() {
    return true;
  }
}

export function livePreview(getContext: () => LivePreviewContext) {
  let registrySource = "",
    registryNumbering: boolean | undefined,
    registry: EquationRegistry | undefined;
  const build = (state: EditorState): DecorationSet => {
    const context = getContext();
    const source = state.doc.toString();
    const numbering = (context.preferences ?? DEFAULT_MATH_PREFERENCES).numberEquations;
    if (!registry || source !== registrySource || numbering !== registryNumbering) {
      registry = buildEquationRegistry(source, { numbering });
      registrySource = source;
      registryNumbering = numbering;
    }
    const widgetContext = { ...context, registry };
    const ranges: Range<Decoration>[] = [];
    const blocks: { from: number; to: number }[] = [];
    for (let line = 1; line <= state.doc.lines; line++) {
      const current = state.doc.line(line);
      if (!current.text.trim())
        ranges.push(Decoration.line({ class: "cm-live-empty" }).range(current.from));
    }
    const active = (from: number, to: number) =>
      state.selection.ranges.some(
        (selection) =>
          state.doc.lineAt(selection.from).from <= to && state.doc.lineAt(selection.to).to >= from,
      );
    const hide = (from: number, to: number) => {
      if (to > from) ranges.push(Decoration.replace({}).range(from, to));
    };
    const render = (
      from: number,
      to: number,
      block: boolean,
      source = state.sliceDoc(from, to),
    ) => {
      if (active(from, to)) return false;
      ranges.push(
        Decoration.replace({
          widget: new MarkdownWidget(source, widgetContext, block),
          block,
        }).range(from, to),
      );
      blocks.push({ from, to });
      return true;
    };
    syntaxTree(state).iterate({
      enter(node) {
        const { name, from, to } = node;
        if (
          [
            "FencedCode",
            "Table",
            "CodeBlock",
            "BulletList",
            "OrderedList",
            "HorizontalRule",
            "SetextHeading1",
            "SetextHeading2",
            "Blockquote",
          ].includes(name)
        ) {
          render(from, to, true);
          return false;
        }
        if (
          name === "Paragraph" &&
          (/^\s*\$\$[\s\S]*\$\$\s*$/.test(state.sliceDoc(from, to)) ||
            /^\s*!\[.*\]\s*$/.test(state.sliceDoc(from, to)) ||
            /^\s*!\[[\s\S]*\]\([^\n]*\)\s*$/.test(state.sliceDoc(from, to)))
        ) {
          render(from, to, true);
          return false;
        }
        if (active(from, to)) return;
        if (/^ATXHeading[1-6]$/.test(name))
          ranges.push(
            Decoration.line({ class: `cm-live-h${name.at(-1)}` }).range(
              state.doc.lineAt(from).from,
            ),
          );
        if (["HeaderMark", "EmphasisMark", "CodeMark", "StrikethroughMark"].includes(name))
          hide(from, to);
        if (name === "StrongEmphasis")
          ranges.push(Decoration.mark({ class: "cm-live-strong" }).range(from, to));
        if (name === "Emphasis")
          ranges.push(Decoration.mark({ class: "cm-live-emphasis" }).range(from, to));
        if (name === "Strikethrough")
          ranges.push(Decoration.mark({ class: "cm-live-strike" }).range(from, to));
        if (name === "InlineCode")
          ranges.push(Decoration.mark({ class: "cm-live-code" }).range(from, to));
        if (name === "Link" || name === "Image") {
          render(from, to, false);
          return false;
        }
      },
    });
    // Math and wikilinks are not Lezer nodes. Scan parsed prose only, so
    // code and unfinished syntax never become a rendered replacement.
    syntaxTree(state).iterate({
      enter(node) {
        if (["FencedCode", "CodeBlock", "InlineCode", "Link", "Image", "Table"].includes(node.name))
          return false;
        if (node.name !== "Paragraph") return;
        if (
          blocks.some((block) => node.from >= block.from && node.to <= block.to) ||
          active(node.from, node.to)
        )
          return false;
        const source = state.sliceDoc(node.from, node.to);
        for (const link of scanNoteLinks(source))
          if (link.kind === "wiki")
            render(
              node.from + link.from,
              node.from + link.to,
              false,
              link.embed
                ? source.slice(link.from, link.to)
                : `[${link.label}](${noteUrl(link.reference)})`,
            );
        for (const match of source.matchAll(/(?<!\\)\$[^$\n]+\$/g)) {
          const from = node.from + match.index!,
            to = from + match[0].length;
          let excluded = false;
          for (
            let parent = syntaxTree(state).resolveInner(from, 1);
            parent;
            parent = parent.parent!
          ) {
            if (["InlineCode", "Link", "Image"].includes(parent.name)) {
              excluded = true;
              break;
            }
          }
          if (!excluded && !blocks.some((block) => from < block.to && to > block.from))
            render(from, to, false, match[0]);
        }
        return false;
      },
    });
    return Decoration.set(ranges, true);
  };
  const field = StateField.define<DecorationSet>({
    create: build,
    update(value, transaction) {
      return transaction.docChanged ||
        transaction.selection ||
        syntaxTree(transaction.startState) !== syntaxTree(transaction.state) ||
        transaction.effects.some((effect) => effect.is(refreshLivePreview))
        ? build(transaction.state)
        : value;
    },
    provide: (field) => EditorView.decorations.from(field),
  });
  return [field, EditorView.editorAttributes.of({ class: "cm-live-preview" })];
}
