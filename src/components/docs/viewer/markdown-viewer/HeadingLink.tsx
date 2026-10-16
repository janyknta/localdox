import { useContext, type ComponentProps, type ReactNode } from "react";
import type { ExtraProps } from "react-markdown";
import { ChevronDown } from "lucide-react";
import { slugify } from "@/lib/markdown/markdown-utils";
import { CollapseContext } from "./contexts";

type HeadingProps = ComponentProps<"h1"> &
  ExtraProps & {
    as: "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
    highlight?: (text: string) => ReactNode;
  };

export function HeadingLink({ as: Tag, children, id, highlight, ...rest }: HeadingProps) {
  const collapse = useContext(CollapseContext);
  const text = Array.isArray(children)
    ? children.map((c) => (typeof c === "string" ? c : "")).join("")
    : String(children ?? "");
  const finalId = id || slugify(text);
  const collapsed = collapse?.isCollapsed(finalId) ?? false;
  return (
    <Tag id={finalId} {...rest} className="group relative scroll-mt-24">
      {/* Out in the margin, not in the text.
          This used to sit inline before the heading, which put a control in the
          middle of the prose on every single heading — permanent chrome the
          reader had to read past. It lives to the left of the reading column
          now and only appears when the heading is hovered or focused, so an
          untouched page is just the document. A collapsed section keeps its
          chevron visible regardless: that is the only way back. */}
      {collapse && (
        <button
          onClick={() => collapse.toggle(finalId)}
          /* The hover-reveal above assumes a pointer that can hover. On a touch
             tablet — where this is shown, being >=md — there is none, so an
             expanded section's chevron never appeared and a reader could not
             collapse anything; only re-expanding worked, because a collapsed
             one is pinned visible. `coarse:opacity-100` gives touch the same
             affordance a mouse gets. The ::before pads the 24px target out to
             44px without moving it: the margin it sits in is narrower than 44px
             at this breakpoint, so growing the box itself would push it off the
             side of the screen. */
          className={`${collapse.showControls ? "relative mr-2 inline-flex h-6 w-6 align-middle" : "absolute -left-7 top-1/2 hidden h-6 w-6 -translate-y-1/2 md:flex"} items-center justify-center rounded text-muted-foreground transition-opacity hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:opacity-100 coarse:before:absolute coarse:before:-inset-2.5 coarse:before:content-[''] ${
            collapsed || collapse.showControls
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 coarse:opacity-100"
          }`}
          aria-expanded={!collapsed}
          aria-controls={`${finalId}-section`}
          title={collapsed ? "Expand section" : "Collapse section"}
          aria-label={collapsed ? "Expand section" : "Collapse section"}
        >
          <ChevronDown
            className={`h-4 w-4 transition-transform ${collapsed ? "-rotate-90" : ""}`}
          />
        </button>
      )}
      {typeof children === "string" ? (highlight?.(children) ?? children) : children}
    </Tag>
  );
}
