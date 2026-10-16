"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

import { cn } from "@/lib/utils";

/**
 * The one BottomSheet for the whole app. Radix Dialog anchored to the bottom
 * edge, sliding up from below, with a grab handle, rounded top, and safe-area
 * padding. Like Modal it renders at the top of the stacking order (--z-modal),
 * so it overlays everything. Reuse this for every bottom sheet instead of
 * hand-rolling `Sheet side="bottom"` variants.
 */

export interface BottomSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  footer?: React.ReactNode;
  showHandle?: boolean;
  /** Extra classes for the sheet surface. */
  className?: string;
  /** Extra classes for the scrollable body wrapper. */
  bodyClassName?: string;
  children?: React.ReactNode;
}

export function BottomSheet({
  open,
  onOpenChange,
  title,
  description,
  footer,
  showHandle = true,
  className,
  bodyClassName,
  children,
}: BottomSheetProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-(--z-modal) bg-foreground/25 backdrop-blur-sm",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          )}
        />
        <DialogPrimitive.Content
          onInteractOutside={(event) => {
            // Toast actions (such as Undo) remain usable without closing the sheet.
            if (event.target instanceof Element && event.target.closest("[data-sonner-toast]"))
              event.preventDefault();
          }}
          className={cn(
            "fixed inset-x-0 bottom-0 z-(--z-modal) flex max-h-[88dvh] flex-col rounded-t-3xl border-t border-border bg-background shadow-2xl outline-none",
            "px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom data-[state=closed]:duration-200 data-[state=open]:duration-300",
            className,
          )}
        >
          {showHandle && (
            <div
              aria-hidden
              className="mx-auto mb-3 h-1.5 w-10 shrink-0 rounded-full bg-muted-foreground/30"
            />
          )}

          {/* Radix requires an accessible title; hide it when none is shown. */}
          {title ? (
            <DialogPrimitive.Title className="text-lg font-semibold text-foreground">
              {title}
            </DialogPrimitive.Title>
          ) : (
            <DialogPrimitive.Title className="sr-only">Sheet</DialogPrimitive.Title>
          )}
          {description && (
            <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">
              {description}
            </DialogPrimitive.Description>
          )}

          <div
            className={cn(
              "min-h-0 flex-1 overflow-y-auto",
              (title || description) && "mt-4",
              bodyClassName,
            )}
          >
            {children}
          </div>

          {footer && (
            <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              {footer}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export const BottomSheetClose = DialogPrimitive.Close;
