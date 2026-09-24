import { GripVertical } from "lucide-react";
import { Group, Panel, Separator } from "react-resizable-panels";

import { cn } from "@/lib/utils";

/**
 * The group lays itself out from its `orientation` prop: react-resizable-panels
 * writes `flex-flow` straight onto the element's style attribute, so there is
 * nothing here to switch on direction.
 */
const ResizablePanelGroup = ({ className, ...props }: React.ComponentProps<typeof Group>) => (
  <Group className={cn("flex h-full w-full", className)} {...props} />
);

const ResizablePanel = Panel;

/**
 * The bar between two panes.
 *
 * Which way it runs is read from `aria-orientation`, which the library sets on
 * the separator itself: `vertical` is the upright bar between side-by-side
 * panes, `horizontal` the one between stacked panes. This used to key off
 * `data-panel-group-direction`, an attribute this version never emits — so the
 * stacked case silently kept the upright styling and appeared as a 1x16px nub
 * against the left edge instead of a divider across the pane.
 *
 * The hit area is the `after:` pseudo-element rather than the bar itself: a
 * visible 1px line with an invisible band over it is how the divider stays a
 * hairline while still being catchable. That band widens under a finger, where
 * 4px is not a target anyone can hit.
 */
const ResizableHandle = ({
  withHandle,
  className,
  ...props
}: React.ComponentProps<typeof Separator> & {
  withHandle?: boolean;
}) => (
  <Separator
    className={cn(
      "relative flex items-center justify-center bg-border focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1",
      // Upright: between side-by-side panes.
      "aria-[orientation=vertical]:w-px aria-[orientation=vertical]:after:absolute aria-[orientation=vertical]:after:inset-y-0 aria-[orientation=vertical]:after:left-1/2 aria-[orientation=vertical]:after:w-1 aria-[orientation=vertical]:after:-translate-x-1/2 aria-[orientation=vertical]:coarse:after:w-6",
      // Flat: between stacked panes.
      "aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:after:absolute aria-[orientation=horizontal]:after:inset-x-0 aria-[orientation=horizontal]:after:top-1/2 aria-[orientation=horizontal]:after:h-1 aria-[orientation=horizontal]:after:-translate-y-1/2 aria-[orientation=horizontal]:coarse:after:h-6",
      // The grip glyph is drawn upright, so it turns with a flat divider.
      "[&[aria-orientation=horizontal]>div]:rotate-90",
      className,
    )}
    {...props}
  >
    {withHandle && (
      <div className="z-10 flex h-4 w-3 items-center justify-center rounded-sm border bg-border coarse:h-6 coarse:w-4">
        <GripVertical className="h-2.5 w-2.5" />
      </div>
    )}
  </Separator>
);

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
