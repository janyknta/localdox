// Full-screen view of one equation.
//
// A dense equation gets the width of a reading column, which is the one place
// it is least legible — the same problem diagrams and JSON trees have in this
// reader, and solved the same way. Scale is stepped rather than continuous so
// keyboard and touch reach every level.

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Minus, Plus, RotateCcw, X } from "lucide-react";
import { ESCAPE_DEPTH, useNavEscape } from "@/hooks/use-nav-history";

const STEPS = [1, 1.5, 2, 3, 4] as const;

export function MathZoom({
  html,
  latex,
  number,
  onClose,
}: {
  html: string;
  latex: string;
  number?: string;
  onClose: () => void;
}) {
  const [step, setStep] = useState(1);
  const scale = STEPS[step];

  // Escape closes, and participates in the app's own back-navigation stack so
  // the browser's Back button closes it too rather than leaving the reader's
  // document.
  useNavEscape(true, onClose, ESCAPE_DEPTH.overlay);

  const zoomIn = useCallback(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), []);
  const zoomOut = useCallback(() => setStep((s) => Math.max(s - 1, 0)), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        zoomIn();
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        zoomOut();
      } else if (event.key === "0") {
        event.preventDefault();
        setStep(0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomIn, zoomOut]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="docs-math-zoom"
      role="dialog"
      aria-modal="true"
      aria-label={number ? `Equation ${number}, zoomed` : "Equation, zoomed"}
      onClick={(event) => {
        // Click the backdrop, not the equation, to dismiss.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="docs-math-zoom-bar">
        <span className="docs-math-zoom-label">
          {number ? `Equation (${number})` : "Equation"} · {Math.round(scale * 100)}%
        </span>
        <div className="docs-math-zoom-controls">
          <button type="button" onClick={zoomOut} disabled={step === 0} aria-label="Zoom out">
            <Minus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={zoomIn}
            disabled={step === STEPS.length - 1}
            aria-label="Zoom in"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => setStep(0)} aria-label="Reset zoom">
            <RotateCcw className="h-4 w-4" />
          </button>
          <button type="button" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Scrolls in both axes: a 4× equation is meant to overflow, and panning
          to the part you care about is the point of zooming in. */}
      <div className="docs-math-zoom-stage" tabIndex={0}>
        <span
          className="docs-math-zoom-content"
          style={{ fontSize: `${scale}em` }}
          // Already sanitized by the renderer.
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>

      <pre className="docs-math-zoom-source">
        <code>{latex}</code>
      </pre>
    </div>,
    document.body,
  );
}
