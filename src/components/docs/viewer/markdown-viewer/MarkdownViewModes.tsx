import { Eye, ListTree, FoldVertical } from "lucide-react";
import { cn } from "@/lib/utils";

export type MarkdownViewMode = "preview" | "tree" | "wrapped";

const MODES = [
  { value: "preview", label: "Preview", icon: Eye },
  { value: "tree", label: "Tree view", icon: ListTree },
  { value: "wrapped", label: "Wrap all sections", icon: FoldVertical },
] as const;

export function MarkdownViewModes({
  mode,
  onChange,
}: {
  mode: MarkdownViewMode;
  onChange: (mode: MarkdownViewMode) => void;
}) {
  return (
    <div className="shrink-0 border-b border-border/50 px-4 py-2 md:px-7">
      <div
        role="group"
        aria-label="Markdown view"
        className="flex w-fit max-w-full gap-1 rounded-lg bg-muted/50 p-1"
      >
        {MODES.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            onClick={() => onChange(value)}
            className={cn(
              "flex min-h-8 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-3 coarse:min-h-11",
              mode === value
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
            )}
          >
            <Icon aria-hidden="true" className="hidden h-3.5 w-3.5 shrink-0 sm:block" />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
