import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Expand, LoaderCircle, Minimize2, Minus, Plus, Star } from "lucide-react";
import { toast } from "sonner";
import type { MermaidAnimator as MermaidAnimatorInstance } from "mermaid-animator";
import { useSaveAction } from "./save-action";
import { describeRenderError } from "./render-error";
import { largeDiagramMermaidConfig } from "./mermaid-config";
import { renderMermaid } from "./mermaid-render-cache";
import { DiagramNodeColorPopover } from "./DiagramNodeColorPopover";
import {
  COLORABLE_NODES,
  applyOne,
  applyOverrides,
  diagramKey,
  loadOverrides,
  nodeKey,
  saveOverride,
  type NodeOverrides,
} from "@/lib/diagram-node-colors";
import {
  isRenderedDiagramTooLarge,
  optimizeSvgForImageRendering,
  readSvgViewBox,
  shouldUseDiagramPerformanceMode,
} from "./mermaid-performance";
import {
  MAX_STAGE_RATIO,
  MIN_STAGE_RATIO,
  clampStageRatio,
  isTallStage,
  stageBoxStyle,
  stageWidthCap,
  type DiagramSize,
} from "./stage-ratio";

/** A tall stage takes the full column, so it gets no width cap at all. */
function widthCap(ratio: number): string | undefined {
  const cap = stageWidthCap(ratio);
  return cap ? `calc(${cap})` : undefined;
}

/**
 * Explainer mode renders through plain `mermaid` rather than the animator, so
 * it is a separate chunk. Splitting it keeps a reader who never switches modes
 * from downloading the planner and player at all.
 */
const MermaidExplainer = lazy(() =>
  import("./MermaidExplainer").then((m) => ({ default: m.MermaidExplainer })),
);

/**
 * How a diagram is presented.
 *
 * `raw` is Mermaid exactly as it renders, with no motion. `stepped` walks the
 * graph one edge at a time, revealing each node as the arrow reaches it — the
 * explainer. `flow` is the continuous animation: packets travelling every edge
 * at once, plus the `flow:` choreography and WebM export that belong to it.
 *
 * Ordered as the reader would escalate: the picture, then the walk through it,
 * then the thing in motion.
 */
export type MermaidMode = "raw" | "stepped" | "flow";

const MODE_ORDER: MermaidMode[] = ["raw", "stepped", "flow"];
const MODE_LABEL: Record<MermaidMode, string> = {
  raw: "Raw",
  stepped: "Stepped",
  flow: "Flow",
};
const MODE_HINT: Record<MermaidMode, string> = {
  raw: "The diagram, no animation",
  stepped: "Walk the graph one step at a time",
  flow: "Continuous flow along every edge",
};

/**
 * The three presentations, as one segmented control.
 *
 * A tablist rather than a cycling button: the modes are siblings, and a reader
 * should be able to see all three and pick one, not discover them by pressing
 * the same key repeatedly. Labels are words because "Raw" and "Stepped" have no
 * icon anyone would read correctly.
 */
function ModeTabs({
  mode,
  onChange,
  unavailable,
}: {
  mode: MermaidMode;
  onChange: (next: MermaidMode) => void;
  /** Modes this diagram cannot offer, with the reason, shown disabled. */
  unavailable?: Partial<Record<MermaidMode, string>>;
}) {
  const blocked = (option: MermaidMode) => Boolean(unavailable?.[option]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    // Step over anything disabled rather than landing on it, so the arrow keys
    // can only reach a tab that will actually do something.
    let index = MODE_ORDER.indexOf(mode);
    for (let hops = 0; hops < MODE_ORDER.length; hops++) {
      index = (index + delta + MODE_ORDER.length) % MODE_ORDER.length;
      if (!blocked(MODE_ORDER[index])) {
        onChange(MODE_ORDER[index]);
        return;
      }
    }
  };

  return (
    <div
      role="tablist"
      aria-label="Diagram presentation"
      onKeyDown={onKeyDown}
      // `shrink-0`: this sat in a `justify-between` row beside the action tray
      // and, being the flexible one, was the item that gave way when the two no
      // longer fit. Below ~360px it lost about 30px — enough that "Flow" was
      // clipped by the `overflow-hidden` here and could not be tapped at all.
      // The row it lives in wraps now, so neither group has to yield.
      className="pointer-events-auto flex shrink-0 items-center overflow-hidden rounded-lg border border-border/70 bg-background/85 p-0.5 shadow-sm ring-1 ring-black/2 backdrop-blur-md"
    >
      {MODE_ORDER.map((option) => {
        const selected = option === mode;
        const reason = unavailable?.[option];
        return (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={selected}
            // `aria-disabled` rather than `disabled`: the tab stays focusable
            // and keeps its tooltip, so a reader can find out *why* it is off
            // instead of meeting a control that ignores them silently.
            aria-disabled={reason ? true : undefined}
            // Only the active tab is in the tab order; arrow keys move between
            // them, which is how a tablist is meant to behave.
            tabIndex={selected ? 0 : -1}
            title={reason ?? MODE_HINT[option]}
            onClick={() => !reason && onChange(option)}
            className={`inline-flex h-7 items-center rounded-md px-2.5 text-[11px] font-medium transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring coarse:h-11 coarse:px-3.5 coarse:text-xs ${
              reason
                ? "cursor-not-allowed text-muted-foreground/40"
                : selected
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {MODE_LABEL[option]}
          </button>
        );
      })}
    </div>
  );
}

// mermaid's erDiagram lexer reserves words like CLASS. Keep the existing
// compatibility fallback, but only apply it after the unmodified source fails.
function quoteErEntities(src: string): string {
  const q = (token: string) => (/^".*"$/.test(token) ? token : `"${token}"`);
  return src
    .split("\n")
    .map((line) => {
      const rel = line.match(/^(\s*)([\w".:-]+)(\s+)(\S*--\S*)(\s+)([\w".:-]+)(\s*:\s*.*)$/);
      if (!rel) return line;
      return rel[1] + q(rel[2]) + rel[3] + rel[4] + rel[5] + q(rel[6]) + rel[7];
    })
    .join("\n");
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function baseName(name: string) {
  return name.replace(/\.(mmd|mermaid|md|markdown)$/i, "") || "diagram";
}

export function Mermaid({
  code,
  name = "diagram",
  mode: initialMode = "raw",
}: {
  code: string;
  name?: string;
  /** Starting presentation. Readers can switch from the tray. */
  mode?: MermaidMode;
}) {
  const [fullscreen, setFullscreen] = useState(false);
  // Raw mode draws a plain SVG with no pan/zoom handler behind it — the
  // animated stages get theirs from the animator. Scaling the host box is the
  // equivalent that works for a static diagram, inline and fullscreen alike.
  const [rawZoom, setRawZoom] = useState(1);
  const [mode, setMode] = useState<MermaidMode>(initialMode);
  const [dark, setDark] = useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  );
  // Semantic colouring is a reader preference, published on <html> the same way
  // theme and font are. A diagram lives deep inside rendered markdown with no
  // props reaching it, so the attribute is the channel.
  const [colored, setColored] = useState(
    () =>
      typeof document === "undefined" ||
      document.documentElement.getAttribute("data-diagram-colors") !== "off",
  );
  const [renderError, setRenderError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  // Measured by the inline stage; the frame needs it too, to narrow with a tall
  // diagram instead of drawing a full-width border around empty space.
  const [stageRatio, setStageRatio] = useState<number | null>(null);
  // Present when the markdown viewer has delegated its save star to this tray.
  const saveAction = useSaveAction();
  // Trimming a multi-megabyte source on every state update is measurable. The
  // prop changes only when the document changes, so retain the normalized view.
  const source = useMemo(() => code.trim(), [code]);
  const sourceTooLarge = useMemo(() => shouldUseDiagramPerformanceMode(source), [source]);
  /**
   * Set when the rendered SVG turned out to be too large even though the
   * source scan cleared it. Held separately from the source verdict so the two
   * stages of the gate stay legible, and combined below.
   */
  const [renderTooLarge, setRenderTooLarge] = useState(false);
  const handleOversized = useCallback(() => setRenderTooLarge(true), []);
  // A new diagram deserves a fresh verdict; the old one's may not apply.
  useEffect(() => setRenderTooLarge(false), [source]);
  const performanceMode = sourceTooLarge || renderTooLarge;
  const [performanceImageUrl, setPerformanceImageUrl] = useState<string | null>(null);
  const handlePerformanceImage = useCallback((url: string | null) => {
    setPerformanceImageUrl(url);
  }, []);
  const frameCap = stageRatio ? (widthCap(stageRatio) ?? null) : null;

  /**
   * A diagram with no sequence to walk — a sequence diagram, a timeline, an
   * xychart — has nothing for stepped mode to do.
   *
   * The tab is disabled rather than the mode being switched out from under the
   * reader. Silently flipping to Raw made the Stepped tab look broken (you
   * pressed it and it bounced back, unexplained), and because the report
   * arrives from the stage's own async render, calling `setMode` there updated
   * the parent while the child was still mounting.
   */
  const [steppedUnavailable, setSteppedUnavailable] = useState(false);
  const handleUnsupported = useCallback(() => setSteppedUnavailable(true), []);
  // A new diagram deserves a fresh verdict; the old one's may not apply.
  useEffect(() => setSteppedUnavailable(false), [source]);

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      setDark(root.classList.contains("dark"));
      setColored(root.getAttribute("data-diagram-colors") !== "off");
    });
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["class", "data-diagram-colors"],
    });
    return () => observer.disconnect();
  }, []);

  // A syntax error removes the stage. Clear it when the source, theme or mode
  // changes so editing the diagram — or switching renderer — immediately gets a
  // fresh render attempt rather than staying stuck on the previous failure.
  useEffect(() => setRenderError(null), [source, dark, mode]);

  // A zoom belongs to the diagram it was applied to. Leaving it set across an
  // edit or a mode switch would re-open the next render already magnified, with
  // no indication why.
  useEffect(() => setRawZoom(1), [source, mode]);

  // Full screen is the frame's own, through the Fullscreen API, rather than an
  // overlay painted over the page. An overlay is only ever as large as the
  // viewport the browser chrome leaves behind, and a diagram is exactly the
  // thing worth handing the whole display.
  //
  // The state follows the document rather than the button: Escape and the
  // browser's own exit both leave full screen without going through the
  // control, and the flag has to agree either way.
  const frameRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement === frameRef.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = frameRef.current;
    if (!el) return;
    if (document.fullscreenElement === el) void document.exitFullscreen();
    else void el.requestFullscreen?.().catch(() => setFullscreen(false));
  }, []);

  // One download, one format. The animation *is* the artifact, and WebM is the
  // only export that carries it; GIF and a still SVG were each a lossy answer to
  // a question nobody asked at the download button.
  const exportDiagram = useCallback(async () => {
    if (!source || exporting) return;
    setExporting(true);
    try {
      const exporter = await import("mermaid-animator/export");
      const blob = await exporter.exportVideo(source, {
        theme: dark ? "dark" : "light",
        width: 1200,
        height: 800,
        mermaid: largeDiagramMermaidConfig(),
      });
      download(blob, `${baseName(name)}.webm`);
      toast.success("Downloaded animated Mermaid as WebM");
    } catch (error) {
      toast.error("Could not export WebM", {
        description: error instanceof Error ? error.message : "The browser could not encode it.",
      });
    } finally {
      setExporting(false);
    }
  }, [dark, exporting, name, source]);

  if (!source) {
    return (
      <div className="my-6 flex min-h-40 items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 text-sm text-muted-foreground">
        Add Mermaid source to preview the animation.
      </div>
    );
  }

  const downloadControl = (
    <TrayButton onClick={() => void exportDiagram()} label="Download WebM video" busy={exporting}>
      {exporting ? (
        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Download className="h-3.5 w-3.5" />
      )}
    </TrayButton>
  );

  // Saving is something you do *to* this diagram, like downloading it, so it
  // joins that segment rather than floating in the corner as its own surface.
  const saveControl = saveAction ? (
    <TrayButton
      onClick={saveAction.toggle}
      label={saveAction.label}
      title={saveAction.title}
      active={saveAction.saved}
    >
      <Star className={`h-3.5 w-3.5 ${saveAction.saved ? "fill-gold text-gold" : ""}`} />
    </TrayButton>
  ) : null;

  const unavailable: Partial<Record<MermaidMode, string>> | undefined = performanceMode
    ? {
        stepped: "Disabled for very large diagrams to keep rendering responsive",
        flow: "Disabled for very large diagrams to protect device performance",
      }
    : steppedUnavailable
      ? { stepped: "This diagram has no sequence to step through" }
      : undefined;

  const visibleMode = performanceMode ? "raw" : mode;
  const modeControl = <ModeTabs mode={visibleMode} onChange={setMode} unavailable={unavailable} />;

  // Kept inside the same bounds the animated stages use, so a diagram cannot be
  // zoomed into a state the other modes could not show.
  const rawZoomBy = (factor: number) =>
    setRawZoom((z) => Math.min(ZOOM_LIMIT.max, Math.max(ZOOM_LIMIT.min, z * factor)));
  const rawZoomControls = (
    <>
      <TrayButton onClick={() => rawZoomBy(1 / 1.3)} label="Zoom out">
        <Minus className="h-3.5 w-3.5" />
      </TrayButton>
      <TrayButton onClick={() => setRawZoom(1)} label="Fit diagram">
        <span className="text-[10px] font-semibold tabular-nums">{Math.round(rawZoom * 100)}%</span>
      </TrayButton>
      <TrayButton onClick={() => rawZoomBy(1.3)} label="Zoom in">
        <Plus className="h-3.5 w-3.5" />
      </TrayButton>
    </>
  );

  // An unsupported diagram still has to show something: render it raw while
  // leaving the reader's chosen tab alone.
  const effectiveMode: MermaidMode =
    performanceMode || (mode === "stepped" && steppedUnavailable) ? "raw" : mode;

  /**
   * The bar above the diagram: what mode you are in, and what you can do to the
   * diagram as an object.
   *
   * Deliberately fixed rather than hover-revealed. Switching presentation is
   * navigation, and navigation you cannot see is navigation nobody finds — the
   * previous floating tray hid the tabs until the pointer happened to land on
   * the picture. Playback stays down on the artwork, next to the thing it
   * drives; this row is chrome.
   *
   * The WebM export appears in `flow` alone: it encodes the travelling-packet
   * animation, so offering it beside a still picture or a step-through would
   * hand back a file of something the reader is not looking at.
   */
  const header = (
    // Wraps to a second line rather than squeezing its two groups. A diagram
    // inside the reading column is only ~270px wide on a small phone, which is
    // less than the mode tabs and the action tray need side by side; when they
    // were forced to share it the tabs were silently cut off. Wrapping keeps
    // every control full-size and reachable, and on any screen wide enough for
    // both it still renders as the single row it always was.
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-border/70 bg-background/40 px-2 py-1.5">
      {modeControl}
      {/* Plain icons rather than an overflow menu. There are only ever two or
          three of these, and a menu made the reader open something to find out
          it held almost nothing. Each one appears only where it applies, so
          nothing needs hiding. */}
      <Tray>
        {saveControl}
        {effectiveMode === "flow" ? downloadControl : null}
        {/* Raw is the one mode with no pan/zoom handler of its own, so it gets
            these. The animated stages carry their own pair down on the
            artwork. */}
        {effectiveMode === "raw" ? rawZoomControls : null}
        <TrayButton
          onClick={toggleFullscreen}
          label={fullscreen ? "Exit full screen" : "Fullscreen"}
        >
          {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Expand className="h-3.5 w-3.5" />}
        </TrayButton>
      </Tray>
    </div>
  );

  const stageFor = (stageFill: boolean) => {
    // Nothing is passed down any more: the surrounding controls live in the
    // header, and each stage renders only its own playback.
    const controls = undefined;
    if (effectiveMode === "stepped") {
      return (
        <Suspense fallback={<StageSpinner label="Loading explainer…" />}>
          <MermaidExplainer
            code={source}
            dark={dark}
            colored={colored}
            fill={stageFill}
            controls={controls}
            onError={setRenderError}
            onRatio={stageFill ? undefined : setStageRatio}
            onUnsupported={handleUnsupported}
          />
        </Suspense>
      );
    }
    if (effectiveMode === "raw") {
      return (
        <StaticStage
          code={source}
          dark={dark}
          colored={colored && !performanceMode}
          fill={stageFill}
          controls={controls}
          zoom={rawZoom}
          onError={setRenderError}
          onRatio={stageFill ? undefined : setStageRatio}
          performanceMode={performanceMode}
          onPerformanceImage={handlePerformanceImage}
          onOversized={handleOversized}
        />
      );
    }
    return (
      <AnimatorStage
        code={source}
        dark={dark}
        fill={stageFill}
        controls={controls}
        onError={setRenderError}
        onRatio={stageFill ? undefined : setStageRatio}
      />
    );
  };

  return (
    <>
      {/* The frame hugs the stage rather than the column: a tall diagram is
          capped to a screenful and narrower than the text, and a full-width card
          around it would just re-draw the dead space the sizing removed. The cap
          is the stage's, mirrored here, because `w-fit` would instead collapse a
          wide diagram to its intrinsic width and shrink the picture. */}
      <div
        ref={frameRef}
        className={`mermaid-frame overflow-hidden border-border bg-muted/30 ${
          fullscreen
            ? "flex h-screen w-screen flex-col rounded-none border-0"
            : "my-6 rounded-xl border mx-auto"
        }`}
        style={fullscreen ? undefined : frameCap ? { maxWidth: frameCap } : undefined}
        data-performance-mode={performanceMode ? "" : undefined}
      >
        {header}
        {/* One stage, which simply grows into the screen when the frame does.
            There used to be a second copy inside an overlay, and the inline one
            was torn down while it was open to avoid paying for two live SVGs at
            once; with the frame itself going full screen there is only ever one
            diagram mounted, so nothing has to be swapped out or measured to
            stop the surrounding text from jumping. */}
        {renderError ? (
          <MermaidError error={renderError} />
        ) : fullscreen ? (
          <div className="min-h-0 flex-1">
            {performanceMode ? (
              performanceImageUrl ? (
                <PerformanceDiagramImage src={performanceImageUrl} name={baseName(name)} fill />
              ) : (
                <StageSpinner label="Preparing large diagram…" />
              )
            ) : (
              stageFor(true)
            )}
          </div>
        ) : (
          stageFor(false)
        )}
      </div>
    </>
  );
}

// The animator stretches its SVG to the full box and lets preserveAspectRatio
// letterbox the remainder, so a wide diagram in a tall frame is read as a band
// of art floating in dead space. Measuring the rendered viewBox lets the inline
// stage take the diagram's own proportions instead, within bounds that keep a
// very wide or very tall graph from collapsing or running off the screen.
//
// The floor is low deliberately: a left-to-right flow of four or five nodes is
// genuinely around 0.3, and clamping it to something squarer reintroduces the
// exact dead band this measurement exists to remove.
// The ratio band every stage sizes itself by lives in its own module, so all
// three stages share one definition. See stage-ratio.ts for why it is clamped.
// The control row floats over the diagram's bottom edge. Adding its height to
// the stage keeps it off the artwork instead of parked on the last node.
const TRAY_GUTTER = 56;

const ZOOM_LIMIT = { min: 0.2, max: 8 };

/** Zoom through the animator's own PanZoom handler.
 *
 *  Writing the SVG viewBox directly looks equivalent but desynchronises the
 *  package: PanZoomHandler seeds a private `viewBox` field once at construction
 *  and never re-reads the DOM, so its pan handler would resume from the
 *  pre-zoom framing and overwrite the attribute on the first drag — the zoom
 *  visibly snapped back. That instance is private, but the package's own
 *  KeyboardHandler is wired to it and listens on the container, so "+"/"-"
 *  reach zoomIn()/zoomOut() and keep cache and DOM in step. */
function zoomStage(container: HTMLElement | null, direction: "in" | "out") {
  if (!container) return;
  container.dispatchEvent(
    new KeyboardEvent("keydown", { key: direction === "in" ? "+" : "-", bubbles: false }),
  );
}

function AnimatorStage({
  code,
  dark,
  fill,
  controls,
  onError,
  onRatio,
}: {
  code: string;
  dark: boolean;
  fill?: boolean;
  controls?: React.ReactNode;
  onError: (message: string | null) => void;
  /** Reports the diagram's measured aspect ratio so the frame can match it. */
  onRatio?: (ratio: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const animatorRef = useRef<MermaidAnimatorInstance | null>(null);
  const renderChainRef = useRef<Promise<void>>(Promise.resolve());
  const renderGenerationRef = useRef(0);
  const ownerGenerationRef = useRef(0);
  const [loading, setLoading] = useState(true);
  const [ratio, setRatio] = useState<number | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const generation = ++renderGenerationRef.current;
    let disposed = false;
    setLoading(true);
    onError(null);
    const create = async () => {
      const options = {
        theme: dark ? "dark" : "light",
        pan: true,
        // Wheel zoom hijacked the page scroll: scrolling past a diagram zoomed it
        // instead of moving on. Zoom is deliberate now — the tray's + and −.
        zoom: false,
        inspect: true,
        minZoom: ZOOM_LIMIT.min,
        maxZoom: ZOOM_LIMIT.max,
        mermaid: largeDiagramMermaidConfig(),
      } as const;
      try {
        const { MermaidAnimator } = await import("mermaid-animator");
        if (disposed || generation !== renderGenerationRef.current) return;
        let animator: MermaidAnimatorInstance;
        try {
          animator = await MermaidAnimator.create(container, code, options);
        } catch (error) {
          const alternative = /^\s*(?:---[\s\S]*?---\s*)?erDiagram\b/.test(code)
            ? quoteErEntities(code)
            : code;
          if (alternative === code) throw error;
          animator = await MermaidAnimator.create(container, alternative, options);
        }
        if (disposed || generation !== renderGenerationRef.current) {
          animator.destroy();
          return;
        }
        animatorRef.current = animator;
        ownerGenerationRef.current = generation;
        // The untouched viewBox is the diagram's natural frame: it is both the
        // aspect ratio the inline stage should take and the zoom baseline.
        const svg = container.querySelector("svg");
        const view = svg?.viewBox.baseVal;
        if (svg && view?.width && view.height) {
          svg.dataset.maBaseView = `${view.x} ${view.y} ${view.width} ${view.height}`;
          const measured = Math.min(
            MAX_STAGE_RATIO,
            Math.max(MIN_STAGE_RATIO, view.height / view.width),
          );
          setRatio(measured);
          onRatio?.(measured);
        }
        setLoading(false);
      } catch (error) {
        if (!disposed) {
          setLoading(false);
          onError(error instanceof Error ? error.message : "Failed to render diagram");
        }
      }
    };
    // React Strict Mode mounts effects twice in development. MermaidAnimator
    // mutates and clears its container, so two overlapping create() calls can
    // let the stale instance erase the live one. Serialize renders per stage;
    // a superseded generation is cleaned up before the next one starts.
    renderChainRef.current = renderChainRef.current
      .catch(() => undefined)
      .then(async () => {
        if (!disposed) await create();
      });
    return () => {
      disposed = true;
      if (ownerGenerationRef.current === generation) {
        animatorRef.current?.destroy();
        animatorRef.current = null;
        ownerGenerationRef.current = 0;
      }
    };
    // `fill` is deliberately absent: it changes how the diagram is *framed*,
    // not what it contains, and listing it here made opening fullscreen
    // destroy the animator and lay the whole diagram out again — twice per
    // toggle, since closing did it too. Framing is applied by the effect below
    // instead, against the instance that is already running.
  }, [code, dark, onError, onRatio]);

  // Re-frame an existing animator when the stage changes shape. Cheap: it
  // writes a viewBox, where a re-create would re-run Mermaid's layout.
  useEffect(() => {
    if (!fill || loading) return;
    const frame = requestAnimationFrame(() => animatorRef.current?.fitToView());
    return () => cancelAnimationFrame(frame);
  }, [fill, loading]);

  return (
    <div
      className="group/stage relative h-full w-full"
      // A tall diagram is capped to a screenful and so ends up narrower than the
      // column. The wrapper narrows with it, so the control row stays anchored
      // to the picture's own corner rather than floating out in the margin.
      style={fill || !ratio ? undefined : { maxWidth: widthCap(ratio), marginInline: "auto" }}
    >
      {/* Flow runs continuously and frames itself; zoom is the only thing left
          worth reaching for, so it is all this tray carries. */}
      <div
        className={`pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-wrap items-center justify-end gap-2 p-3 ${
          fill
            ? ""
            : "opacity-0 transition-opacity duration-150 group-hover/stage:opacity-100 group-focus-within/stage:opacity-100 [@media(hover:none)]:opacity-100"
        }`}
      >
        <Tray>
          <TrayButton onClick={() => zoomStage(containerRef.current, "out")} label="Zoom out">
            <Minus className="h-3.5 w-3.5" />
          </TrayButton>
          <TrayButton onClick={() => zoomStage(containerRef.current, "in")} label="Zoom in">
            <Plus className="h-3.5 w-3.5" />
          </TrayButton>
        </Tray>
        {controls}
      </div>
      {loading && (
        <div className="absolute inset-0 z-1 flex items-center justify-center text-sm text-muted-foreground">
          <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> Rendering animation…
        </div>
      )}
      <div
        ref={containerRef}
        tabIndex={0}
        aria-label="Animated Mermaid diagram"
        // Keep the package class in React's declared className. The animator
        // also adds it imperatively, but a later loading-state render would
        // otherwise make React restore only the utility classes.
        className={fill ? "ma-container h-full min-h-0 w-full" : "ma-container w-full box-content"}
        // Inline: hold the diagram's own proportions so there is no letterboxed
        // dead band above and below it, with the control row's gutter added as
        // padding rather than taken out of the picture (hence `box-content`, so
        // the ratio still describes the diagram alone). Before the first
        // measurement a neutral ratio reserves roughly the right room, so the
        // surrounding text does not jump when the diagram appears.
        style={
          fill
            ? undefined
            : {
                aspectRatio: `1 / ${ratio ?? 0.42}`,
                paddingBottom: TRAY_GUTTER,
                // A tall diagram would otherwise grow past a screenful. The
                // wrapper caps the width in the same proportion, so this height
                // cap is only a backstop and never letterboxes the picture.
                maxHeight: "min(32rem, 70vh)",
                minHeight: "9rem",
              }
        }
      />
    </div>
  );
}

/**
 * Mark every node a reader can recolour.
 *
 * The attribute is what `diagram-colors.css` hangs the hover affordance on, and
 * the tooltip is the only discovery this feature gets — nothing about a
 * rendered box says "clickable" on its own.
 */
function markColorableNodes(svg: SVGSVGElement): void {
  for (const node of svg.querySelectorAll<SVGElement>(COLORABLE_NODES)) {
    node.setAttribute("data-colorable", "");
    // The tooltip goes on the *shape*, never on the node group.
    //
    // An SVG <title> is real text content: appended to the group, it joined the
    // node's own label, so `node.textContent` came back as "Ordinary stepClick
    // to change…". That is not cosmetic — semantics.ts classifies a node by
    // matching keywords against exactly that string, and the colour picker
    // shows it back to the reader as the node's name.
    const shape = node.querySelector("rect, polygon, circle, ellipse, path");
    if (shape && !shape.querySelector("title")) {
      const tip = document.createElementNS("http://www.w3.org/2000/svg", "title");
      tip.textContent = "Click to change this block's colour";
      shape.appendChild(tip);
    }
  }
}

/** Shared placeholder while a stage's chunk or render is in flight. */
function StageSpinner({ label }: { label: string }) {
  return (
    <div className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">
      <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> {label}
    </div>
  );
}

/**
 * Plain Mermaid, no motion.
 *
 * Worth having as its own mode rather than "explainer, paused": some diagrams
 * (a pie chart, a gantt, an ER diagram) aren't a walk through anything, and a
 * reader skimming a long document may simply not want things moving. It shares
 * the sizing behaviour of the animated stages so switching modes doesn't make
 * the surrounding text jump.
 */
function StaticStage({
  code,
  dark,
  colored,
  fill,
  controls,
  zoom = 1,
  onError,
  onRatio,
  performanceMode,
  onPerformanceImage,
  onOversized,
}: {
  code: string;
  dark: boolean;
  /** Colour nodes and edges by meaning; see lib/explainer/semantics.ts. */
  colored?: boolean;
  fill?: boolean;
  controls?: React.ReactNode;
  /** Scale factor from the tray's zoom controls; 1 is the fitted diagram. */
  zoom?: number;
  onError: (message: string | null) => void;
  onRatio?: (ratio: number) => void;
  performanceMode?: boolean;
  onPerformanceImage?: (url: string | null) => void;
  /**
   * Fired when the *rendered* diagram turns out to be too large for live DOM,
   * even though the source scan let it through. The caller uses this to drop
   * the animated modes, exactly as it would for a source-flagged diagram.
   */
  onOversized?: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [ratio, setRatio] = useState<number | null>(null);
  const [size, setSize] = useState<DiagramSize | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const imageUrlRef = useRef<string | null>(null);
  /**
   * Whether this render is being shown as a flattened image.
   *
   * Distinct from the `performanceMode` prop: that is the source-scan verdict,
   * known before rendering, while this also covers a diagram that only
   * revealed its size once Mermaid had laid it out.
   */
  const [asImage, setAsImage] = useState(Boolean(performanceMode));

  /**
   * The reader's own colours for this diagram's nodes.
   *
   * Held in a ref as well as state: the render effect re-applies them to each
   * fresh SVG, and reading them from state there would mean listing them as a
   * dependency and re-rendering the whole diagram every time one box changed.
   */
  const diagram = useMemo(() => diagramKey(code), [code]);
  const [overrides, setOverrides] = useState<NodeOverrides>(() => loadOverrides(diagram));
  const overridesRef = useRef(overrides);
  overridesRef.current = overrides;
  // A different diagram has different overrides; the previous one's must not
  // leak onto it.
  useEffect(() => {
    const next = loadOverrides(diagram);
    overridesRef.current = next;
    setOverrides(next);
  }, [diagram]);

  /** The node whose colour is being picked, if any. */
  const [picker, setPicker] = useState<{ node: string; label: string; rect: DOMRect } | null>(null);
  // A re-render moves every node, so a picker still pointing at the old
  // rectangle would float away from its box.
  useEffect(() => setPicker(null), [code, dark, colored]);

  const pickColor = useCallback(
    (color: string | null) => {
      if (!picker) return;
      const svgEl = hostRef.current?.querySelector("svg");
      if (svgEl) {
        // Repaint immediately rather than waiting on a re-render that is not
        // coming: the SVG is imperative, and nothing else would redraw it.
        applyOne(svgEl as SVGSVGElement, picker.node, color);
        // Clearing an override puts the node back to whatever the semantic
        // palette said, which only a fresh pass can decide.
        if (!color && colored) {
          void import("@/lib/explainer/semantics").then(({ applySemantics }) =>
            applySemantics(svgEl as SVGSVGElement),
          );
        }
      }
      setOverrides(saveOverride(diagram, picker.node, color));
      setPicker(null);
    },
    [colored, diagram, picker],
  );

  /** Open the picker on whichever node was clicked. */
  const onHostClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as Element | null;
    const node = target?.closest?.(COLORABLE_NODES);
    if (!node) return;
    event.preventDefault();
    event.stopPropagation();
    setPicker({
      node: nodeKey(node),
      // The node's own label, not its whole text content: the click-to-recolour
      // tooltip is an SVG <title> living on the shape, and `textContent` would
      // hand the reader "Click to change this block's colourOrdinary step".
      label: (node.querySelector(".nodeLabel") ?? node).textContent?.trim() ?? "",
      rect: node.getBoundingClientRect(),
    });
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!performanceMode && !host) return;
    let disposed = false;
    if (imageUrlRef.current) {
      URL.revokeObjectURL(imageUrlRef.current);
      imageUrlRef.current = null;
      setImageUrl(null);
      onPerformanceImage?.(null);
    }
    setLoading(true);
    onError(null);
    const run = async () => {
      try {
        const { svg } = await renderMermaid(code, dark, Boolean(performanceMode));
        if (disposed) return;
        // Stage two of the size gate. The source scan catches the obvious
        // monsters, but a short, dense diagram — forty ER entities of thirty
        // attributes — only reveals its true size once laid out. Measuring the
        // result and downgrading here is what makes the guarantee hold for the
        // diagrams the pre-scan cannot see.
        const oversized = performanceMode || isRenderedDiagramTooLarge(svg);
        if (oversized) {
          setAsImage(true);
          // Tell the parent only when the source scan had cleared it; a
          // source-flagged diagram has already disabled those modes.
          if (!performanceMode) onOversized?.();
          const view = readSvgViewBox(svg);
          if (view) {
            const measured = clampStageRatio(view.height / view.width);
            setRatio(measured);
            setSize(view);
            onRatio?.(measured);
          }
          const url = URL.createObjectURL(
            new Blob([optimizeSvgForImageRendering(svg)], { type: "image/svg+xml" }),
          );
          if (disposed) {
            URL.revokeObjectURL(url);
            return;
          }
          imageUrlRef.current = url;
          setImageUrl(url);
          onPerformanceImage?.(url);
          setLoading(false);
          return;
        }

        host!.innerHTML = svg;
        const svgEl = host!.querySelector("svg");
        if (svgEl) {
          // Mermaid pins max-width to the intrinsic width, which stops the
          // diagram growing to fill the stage the way the animated modes do.
          svgEl.setAttribute("preserveAspectRatio", "xMidYMid meet");
          if (colored) {
            const { applySemantics } = await import("@/lib/explainer/semantics");
            if (disposed) return;
            applySemantics(svgEl as SVGSVGElement);
          }
          // The reader's own colours go on last, so they beat both the
          // semantic palette and any fill the diagram's author set. The render
          // cache hands back the same SVG string each time, so these have to be
          // re-applied to every fresh copy rather than living in the markup.
          applyOverrides(svgEl as SVGSVGElement, overridesRef.current);
          markColorableNodes(svgEl as SVGSVGElement);
          svgEl.style.maxWidth = "100%";
          svgEl.style.width = "100%";
          svgEl.style.height = "100%";
          const view = svgEl.viewBox.baseVal;
          if (view?.width && view.height) {
            // Clamped for the same reason the animated stages clamp: a tall
            // diagram measured raw builds a box taller than the screen, which
            // maxHeight then crushes into a sliver.
            const measured = clampStageRatio(view.height / view.width);
            setRatio(measured);
            setSize({ width: view.width, height: view.height });
            onRatio?.(measured);
          }
        }
        setLoading(false);
      } catch (error) {
        if (disposed) return;
        setLoading(false);
        onError(describeRenderError(error));
      }
    };
    void run();
    return () => {
      disposed = true;
      if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
      imageUrlRef.current = null;
      onPerformanceImage?.(null);
      if (host) host.innerHTML = "";
    };
  }, [code, dark, colored, onError, onOversized, onPerformanceImage, onRatio, performanceMode]);

  if (asImage) {
    return (
      <div className="relative min-h-64 w-full">
        {loading || !imageUrl ? (
          <StageSpinner label="Rendering large diagram…" />
        ) : (
          <PerformanceDiagramImage src={imageUrl} name="Large Mermaid diagram" />
        )}
      </div>
    );
  }

  return (
    <div
      className="group/stage relative h-full w-full"
      style={fill || !ratio ? undefined : { maxWidth: widthCap(ratio), marginInline: "auto" }}
    >
      <div
        className={`pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-wrap items-center justify-end gap-2 p-3 ${
          fill
            ? ""
            : "opacity-0 transition-opacity duration-150 group-hover/stage:opacity-100 group-focus-within/stage:opacity-100 [@media(hover:none)]:opacity-100"
        }`}
      >
        {/* Passed already grouped: the caller decides what shares a surface,
            because only it knows which controls belong to the live mode. */}
        {controls}
      </div>
      {loading && (
        <div className="absolute inset-0 z-1 flex items-center justify-center text-sm text-muted-foreground">
          <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> Rendering diagram…
        </div>
      )}
      {/* Zoom scales the diagram inside a clipping box rather than growing the
          stage, so a magnified diagram is panned to by scrolling this box and
          the surrounding document never reflows. Transform, not width/height:
          it stays on the compositor and does not restyle the SVG's nodes. */}
      <div className={zoom > 1 ? "h-full w-full overflow-auto" : "contents"}>
        <div
          ref={hostRef}
          onClick={onHostClick}
          data-tall={!fill && ratio && isTallStage(ratio) ? "" : undefined}
          className={`${fill ? "h-full min-h-0 w-full" : "w-full box-content"}${
            colored ? " diagram-colored" : ""
          }`}
          style={{
            ...(fill ? undefined : stageBoxStyle(ratio ?? 0.42, TRAY_GUTTER, size ?? undefined)),
            ...(zoom === 1
              ? undefined
              : { transform: `scale(${zoom})`, transformOrigin: "top left" }),
          }}
        />
      </div>
      {picker && (
        <DiagramNodeColorPopover
          anchor={picker.rect}
          label={picker.label}
          current={overrides[picker.node] ?? null}
          onPick={pickColor}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

/**
 * A large SVG stays outside the live DOM and is decoded as one image. Zooming
 * changes only two box dimensions instead of restyling thousands of SVG nodes.
 */
function PerformanceDiagramImage({
  src,
  name,
  fill,
}: {
  src: string;
  name: string;
  fill?: boolean;
}) {
  const [zoom, setZoom] = useState(1);
  const zoomBy = (factor: number) => setZoom((value) => Math.min(32, Math.max(1, value * factor)));

  return (
    <div
      className={`group/stage relative w-full ${fill ? "h-full" : "h-[min(32rem,70vh)] min-h-64"}`}
    >
      <div className="h-full w-full overflow-auto overscroll-contain">
        <div
          className="relative min-h-full min-w-full"
          style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}
        >
          <img
            src={src}
            alt={name}
            decoding="async"
            draggable={false}
            className="absolute inset-0 h-full w-full select-none object-contain"
          />
        </div>
      </div>
      <div className="absolute bottom-3 right-3 z-10 flex items-center">
        <Tray>
          <TrayButton onClick={() => zoomBy(0.5)} label="Zoom out">
            <Minus className="h-3.5 w-3.5" />
          </TrayButton>
          <TrayButton onClick={() => setZoom(1)} label="Fit diagram">
            <span className="text-[10px] font-semibold">{Math.round(zoom * 100)}%</span>
          </TrayButton>
          <TrayButton onClick={() => zoomBy(2)} label="Zoom in">
            <Plus className="h-3.5 w-3.5" />
          </TrayButton>
        </Tray>
      </div>
    </div>
  );
}

function MermaidError({ error }: { error: string }) {
  return (
    <div className="min-h-40 overflow-auto p-4 text-sm">
      <div className="mb-2 font-semibold text-destructive">Mermaid animation error</div>
      <pre className="whitespace-pre-wrap text-xs text-muted-foreground">{error}</pre>
    </div>
  );
}

/**
 * A segmented control: one rounded surface, hairline dividers between its
 * buttons, no gaps for the diagram to show through. Grouping by meaning — and
 * spacing the groups — is what tells the eye which buttons belong together,
 * so no group needs a label to explain itself.
 *
 * Exported so the star affordance the markdown viewer overlays on a diagram can
 * join the same row instead of being positioned next to it by guesswork.
 */
export function Tray({ children }: { children: React.ReactNode }) {
  return (
    <div className="pointer-events-auto flex shrink-0 items-center overflow-hidden rounded-lg border border-border/70 bg-background/85 shadow-sm ring-1 ring-black/2 backdrop-blur-md [&>*+*]:border-l [&>*+*]:border-border/60">
      {children}
    </div>
  );
}

export function TrayButton({
  onClick,
  label,
  title,
  busy,
  active,
  children,
}: {
  onClick: (event: React.MouseEvent) => void;
  label: string;
  /** Tooltip, when it should differ from the accessible name. */
  title?: string;
  busy?: boolean;
  /** Renders the pressed state for a button that toggles something on. */
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label={label}
      aria-pressed={active}
      title={title ?? label}
      className={`inline-flex h-8 w-8 items-center justify-center transition-colors duration-100 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:bg-accent/80 disabled:pointer-events-none disabled:opacity-60 coarse:h-11 coarse:w-11 ${
        active ? "text-foreground" : "text-muted-foreground"
      }`}
    >
      {children}
    </button>
  );
}
