import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, LoaderCircle, Pause, Play, RotateCcw } from "lucide-react";
import { readGraph } from "@/lib/explainer/graph";
import { canExplain, planExplainer } from "@/lib/explainer/plan";
import { applySemantics } from "@/lib/explainer/semantics";
import { renderMermaid } from "./mermaid-render-cache";
import { describeRenderError } from "./render-error";
import { ExplainerPlayer, type PlayerState } from "@/lib/explainer/player";
import { homeFrame } from "@/lib/explainer/camera";
import { Tray, TrayButton, ZoomControls } from "./Mermaid";
import { useSvgViewport } from "./use-svg-viewport";
import {
  clampStageRatio,
  isTallStage,
  stageBoxStyle,
  stageWidthCap,
  type DiagramSize,
} from "./stage-ratio";
import "./explainer.css";

const SPEEDS = [0.5, 1, 1.5, 2] as const;

/** A tall stage takes the full column, so it gets no width cap at all. */
function widthCap(ratio: number): string | undefined {
  const cap = stageWidthCap(ratio);
  return cap ? `calc(${cap})` : undefined;
}

/**
 * Explainer mode: a Mermaid diagram narrated as a sequence.
 *
 * Mermaid still renders the picture — this component never draws a node or
 * routes an edge itself. It renders once, reads the topology back out of the
 * SVG, plans an order, and then animates the elements Mermaid produced. That
 * split is the whole design: layout and appearance stay upstream's problem, and
 * we only decide *when* each piece appears.
 *
 * The diagram is rendered exactly once per source change. Playback mutates
 * inline styles on existing elements, so scrubbing a 30-node diagram costs no
 * re-render and no relayout.
 */
export function MermaidExplainer({
  code,
  dark,
  colored,
  camera = true,
  fill,
  controls,
  onError,
  onRatio,
  onUnsupported,
}: {
  code: string;
  dark: boolean;
  /** Colour nodes and edges by meaning; see lib/explainer/semantics.ts. */
  colored?: boolean;
  /** Let the camera close in on each beat; off holds the whole diagram. */
  camera?: boolean;
  fill?: boolean;
  controls?: React.ReactNode;
  onError: (message: string | null) => void;
  onRatio?: (ratio: number) => void;
  /**
   * Fired when the diagram has no sequence to explain (a sequence diagram, a
   * timeline, an xychart). Reports the fact rather than acting on it, so the
   * caller can mark the tab unavailable instead of silently changing mode.
   */
  onUnsupported?: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<ExplainerPlayer | null>(null);
  const [loading, setLoading] = useState(true);
  const [ratio, setRatio] = useState<number | null>(null);
  // The diagram's own dimensions, needed to size a tall stage at natural scale
  // rather than stretching it to an aspect ratio.
  const [size, setSize] = useState<DiagramSize | null>(null);
  const [speed, setSpeed] = useState<number>(1);
  const [following, setFollowing] = useState(false);
  const {
    viewportRef,
    state: viewState,
    attach,
    detach,
    zoomIn,
    zoomOut,
    reset,
  } = useSvgViewport();
  const [state, setState] = useState<PlayerState>({
    time: 0,
    duration: 0,
    playing: false,
    index: 0,
    stepCount: 0,
    beat: 0,
    beatCount: 0,
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    setLoading(true);
    onError(null);

    const run = async () => {
      try {
        // Shared with the static stage and with the fullscreen copy of this
        // one, so switching modes or opening fullscreen reuses the render
        // instead of laying the diagram out again.
        const { svg } = await renderMermaid(code, dark, false);
        if (disposed) return;

        host.innerHTML = svg;
        const svgEl = host.querySelector("svg");
        if (!svgEl) throw new Error("Mermaid produced no SVG");

        // Let the SVG fill the stage rather than keeping Mermaid's intrinsic
        // pixel size, and letterbox instead of distorting when the stage's
        // clamped proportions differ from the diagram's own.
        svgEl.setAttribute("preserveAspectRatio", "xMidYMid meet");
        if (colored) applySemantics(svgEl as SVGSVGElement);

        const view = svgEl.viewBox.baseVal;
        if (view?.width && view.height) {
          // Clamped, not raw: a tall diagram measured straight would build a
          // stage taller than the screen, which maxHeight then crushes into an
          // unreadable sliver.
          const measured = clampStageRatio(view.height / view.width);
          setRatio(measured);
          setSize({ width: view.width, height: view.height });
          onRatio?.(measured);
        }

        // Pan and zoom work whether or not the diagram can be explained: a
        // diagram that falls back to a still picture is still one to explore.
        const tall =
          !fill && view?.width && view.height
            ? isTallStage(clampStageRatio(view.height / view.width))
            : false;
        const viewport = attach(host, svgEl as SVGSVGElement, { wheelPan: !tall });

        const graph = readGraph(svgEl as SVGSVGElement);
        if (!graph || !canExplain(graph)) {
          // Nothing to sequence — or so much to sequence that stepping through
          // it would take an hour and cost more than the reader's tab can
          // afford. Either way the static render stays on screen and the
          // caller is told, so it can drop the transport rather than offering
          // controls that do nothing.
          setLoading(false);
          onUnsupported?.();
          return;
        }

        const plan = planExplainer(graph);
        // "Fit" is the camera's wide shot, margin included, so resetting the
        // view and the camera's closing pull-back land on the same framing.
        viewport.setBase(homeFrame(graph));
        const player = new ExplainerPlayer(graph, plan, setState, {
          camera,
          // Through the viewport, so a reader who has taken the view keeps it.
          onFrame: (frame) => viewport.follow(frame),
        });
        playerRef.current = player;
        setFollowing(player.following);
        player.setSpeed(speed);
        setLoading(false);
        player.play();
      } catch (error) {
        if (disposed) return;
        setLoading(false);
        onError(describeRenderError(error));
      }
    };
    void run();

    return () => {
      disposed = true;
      playerRef.current?.destroy();
      playerRef.current = null;
      detach();
      setFollowing(false);
      host.innerHTML = "";
    };
    // `speed` is applied imperatively below; re-rendering the diagram when it
    // changes would restart the animation mid-watch. `fill` only decides the
    // wheel rule for a tall stage and must not re-render on full screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, dark, colored, camera, onError, onRatio, onUnsupported]);

  useEffect(() => {
    playerRef.current?.setSpeed(speed);
  }, [speed]);

  const caption = playerRef.current?.describe(state.beat) ?? "";

  const restart = () => {
    // Replaying is a fresh start: the camera gets the view back.
    viewportRef.current?.reset();
    playerRef.current?.restart();
  };

  /**
   * Presenter keys, on the stage once it has focus: Space plays and pauses,
   * the arrows step a beat (unless zoomed in, where the viewport has already
   * claimed them for panning), Home restarts.
   */
  const onKeyDown = (event: React.KeyboardEvent) => {
    const player = playerRef.current;
    if (!player || event.altKey || event.ctrlKey || event.metaKey) return;
    if ((event.target as Element).closest("button, input, select, textarea")) return;
    switch (event.key) {
      case " ":
      case "k":
        player.toggle();
        break;
      case "ArrowRight":
      case ".":
        player.step(1);
        break;
      case "ArrowLeft":
      case ",":
        player.step(-1);
        break;
      case "Home":
        restart();
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  return (
    <div
      className="group/stage relative h-full w-full"
      style={fill || !ratio ? undefined : { maxWidth: widthCap(ratio), marginInline: "auto" }}
      onKeyDown={onKeyDown}
    >
      <div
        className={`pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-wrap items-center justify-end gap-2 p-3 ${
          fill
            ? ""
            : "opacity-0 transition-opacity duration-150 group-hover/stage:opacity-100 group-focus-within/stage:opacity-100 [@media(hover:none)]:opacity-100"
        }`}
      >
        {state.stepCount > 0 && (
          <>
            {/* The caption names the step under the playhead. On a diagram of
                any size the transport alone doesn't tell you what you're
                looking at, and this is cheaper than a legend. */}
            <div
              aria-live="polite"
              className="pointer-events-auto mr-auto flex min-w-0 max-w-[55%] items-center gap-2 overflow-hidden rounded-lg border border-border/70 bg-background/85 px-2.5 py-1 text-[11px] text-muted-foreground shadow-sm backdrop-blur-md"
            >
              {state.beatCount > 1 && (
                <span className="shrink-0 tabular-nums text-muted-foreground/70">
                  {state.beat < 0 ? state.beatCount : state.beat + 1}/{state.beatCount}
                </span>
              )}
              {/* Keyed by beat so each new caption plays its entrance. */}
              <span key={state.beat} className="explainer-caption truncate text-foreground/85">
                {caption}
              </span>
            </div>
            <Tray>
              <TrayButton onClick={() => playerRef.current?.step(-1)} label="Step back (←)">
                <ChevronLeft className="h-3.5 w-3.5" />
              </TrayButton>
              <TrayButton
                onClick={() => playerRef.current?.toggle()}
                label={state.playing ? "Pause animation (Space)" : "Play animation (Space)"}
              >
                {state.playing ? (
                  <Pause className="h-3.5 w-3.5" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
              </TrayButton>
              <TrayButton onClick={() => playerRef.current?.step(1)} label="Step forward (→)">
                <ChevronRight className="h-3.5 w-3.5" />
              </TrayButton>
              <TrayButton onClick={restart} label="Restart animation">
                <RotateCcw className="h-3.5 w-3.5" />
              </TrayButton>
            </Tray>
            <Tray>
              <button
                type="button"
                onClick={() => setSpeed(SPEEDS[(SPEEDS.indexOf(speed as 1) + 1) % SPEEDS.length])}
                aria-label={`Playback speed ${speed}×`}
                title={`Playback speed ${speed}×`}
                className="inline-flex h-8 min-w-10 items-center justify-center px-2 text-[11px] font-medium tabular-nums text-muted-foreground transition-colors duration-100 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                {speed}×
              </button>
            </Tray>
          </>
        )}
        <ZoomControls
          zoom={viewState.zoom}
          manual={viewState.manual}
          auto={following}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          onReset={reset}
        />
        {/* Passed already grouped: the caller decides what shares a surface,
            because only it knows which controls belong to the live mode. */}
        {controls}
      </div>

      {loading && (
        <div className="absolute inset-0 z-1 flex items-center justify-center text-sm text-muted-foreground">
          <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> Building explainer…
        </div>
      )}

      <div
        ref={hostRef}
        tabIndex={0}
        aria-label="Stepped Mermaid diagram. Space plays or pauses, arrow keys step. Drag to pan; pinch or Ctrl/⌘ + scroll to zoom."
        // `data-tall` switches the SVG from filling the stage to keeping its
        // natural size; see explainer.css.
        data-tall={!fill && ratio && isTallStage(ratio) ? "" : undefined}
        className={`${
          fill ? "explainer-stage h-full min-h-0 w-full" : "explainer-stage w-full box-content"
        } overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring${
          colored ? " diagram-colored" : ""
        }`}
        style={fill ? undefined : stageBoxStyle(ratio ?? 0.42, 56, size ?? undefined)}
      />
    </div>
  );
}
