import { useLocation, useRouter } from "@tanstack/react-router";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

/**
 * One navigation history for the whole app.
 *
 * The header's chevrons used to be a content stepper — next file in sidebar
 * order, next section, next slide — which is not what a back button means. Jump
 * to a file from search and "back" walked to its alphabetical neighbour rather
 * than to where you came from.
 *
 * This hook is the trail instead: every *destination* the reader lands on, in
 * visit order. A destination is the whole view, not just a file id, so going
 * back restores the section and the scroll position too.
 *
 * Modes (edit, fullscreen, present, mind map, settings, the AI panel, …) are
 * not entries here. They are escapes: a mode registers itself while open, and
 * back closes the innermost one before it touches the trail. That is what makes
 * one button work everywhere — it always undoes the last thing that happened,
 * whether that was opening a panel or opening a document.
 */

export interface NavEntry {
  /** Address of a workspace, document or settings section. */
  path: string;
  /** Open document, when the entry is a reader view. */
  fileId: string | null;
  /** Section within the document. */
  headingId: string | null;
  /** Search term the document was opened with, so back restores highlighting. */
  query: string | null;
}

/**
 * A dismissable layer stacked over the current entry. `depth` breaks ties when
 * several are open at once: the innermost (highest depth) closes first, so back
 * from fullscreen-inside-edit leaves the editor open rather than dropping both.
 */
export interface NavEscape {
  id: string;
  depth: number;
  close: () => void;
}

/** Depths for the escapes in use. Higher closes first. */
export const ESCAPE_DEPTH = {
  /** A mode you are reading/working *inside* — leaves you on the same document. */
  mode: 10,
  /** A panel or sheet docked beside the content. */
  panel: 20,
  /** A modal, dialog, or full overlay taking the whole screen. */
  overlay: 30,
} as const;

export interface NavHistory {
  canBack: boolean;
  canForward: boolean;
  back: () => void;
  forward: () => void;
  /** Label for the back control — names what it will actually undo. */
  backLabel: string;
  forwardLabel: string;
  /** Record a destination. No-op when it matches where we already are. */
  push: (entry: Partial<NavEntry>) => void;
  /** Register a dismissable layer for as long as it is open. */
  registerEscape: (escape: NavEscape) => () => void;
  /** Close the innermost escape, if any. Returns whether one was closed. */
  popEscape: () => boolean;
}

export const NavHistoryContext = createContext<NavHistory | null>(null);

/** Read the app's navigation history. Safe to call outside the provider. */
export function useNavHistory(): NavHistory {
  return useContext(NavHistoryContext) ?? NOOP_HISTORY;
}

const NOOP_HISTORY: NavHistory = {
  canBack: false,
  canForward: false,
  back: () => {},
  forward: () => {},
  backLabel: "Back",
  forwardLabel: "Forward",
  push: () => {},
  registerEscape: () => () => {},
  popEscape: () => false,
};

/** Browser history is the single navigation trail; overlays can still dismiss first. */
export function useNavHistoryState({
  resolvePath,
}: {
  resolvePath: (entry: Partial<NavEntry>) => string;
}): NavHistory {
  const router = useRouter();
  const location = useLocation();
  const index = location.state.__TSR_index ?? 0;
  const [furthest, setFurthest] = useState(index);
  const escapes = useRef<NavEscape[]>([]);
  const [escapeCount, setEscapeCount] = useState(0);
  const resolver = useRef(resolvePath);
  resolver.current = resolvePath;

  useEffect(() => {
    // Remember available forward entries across a reload without owning a second trail.
    // Keys distinguish this browser history from a fresh navigation into the app.
    const storageKey = "localdox:browser-history-extent";
    let keys: Record<string, string> = {};
    const current = router.history.location;
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "{}");
      if (
        saved &&
        typeof saved === "object" &&
        saved[current.state.__TSR_index] === current.state.__TSR_key
      )
        keys = saved;
    } catch {
      /* History works even when session storage is unavailable. */
    }
    const record = (next: typeof current, pushed = false) => {
      const nextIndex = next.state.__TSR_index ?? 0;
      if (pushed) {
        for (const key of Object.keys(keys)) if (Number(key) > nextIndex) delete keys[key];
      }
      if (next.state.__TSR_key) keys[nextIndex] = next.state.__TSR_key;
      setFurthest(Math.max(nextIndex, ...Object.keys(keys).map(Number).filter(Number.isFinite)));
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(keys));
      } catch {
        /* optional */
      }
    };
    record(current);
    return router.history.subscribe(({ location: next, action }) =>
      record(next, action.type === "PUSH"),
    );
  }, [router]);

  const registerEscape = useCallback((escape: NavEscape) => {
    escapes.current = [...escapes.current, escape];
    setEscapeCount(escapes.current.length);
    return () => {
      escapes.current = escapes.current.filter((item) => item.id !== escape.id);
      setEscapeCount(escapes.current.length);
    };
  }, []);
  const popEscape = useCallback(() => {
    if (!escapes.current.length) return false;
    escapes.current.reduce((best, item) => (item.depth >= best.depth ? item : best)).close();
    return true;
  }, []);
  const push = useCallback(
    (entry: Partial<NavEntry>) => {
      const path = resolver.current(entry);
      const hash = entry.headingId && entry.headingId !== "preamble" ? entry.headingId : "";
      const href = `${path}${hash ? `#${encodeURIComponent(hash)}` : ""}`;
      if (router.state.location.href === href) return;
      void router.navigate({
        to: path,
        hash,
        resetScroll: false,
        state: (previous) => ({ ...previous, localdoxQuery: entry.query ?? null }),
      });
    },
    [router],
  );
  const back = useCallback(() => {
    if (!popEscape()) router.history.back();
  }, [router, popEscape]);
  const forward = useCallback(() => router.history.forward(), [router]);
  return {
    canBack: escapeCount > 0 || index > 0,
    canForward: index < furthest,
    back,
    forward,
    push,
    registerEscape,
    popEscape,
    backLabel: escapeCount > 0 ? "Back (close)" : "Back",
    forwardLabel: "Forward",
  };
}

/**
 * Keep a mode dismissable by the back button for as long as it is open.
 *
 * Call it from the component owning the mode; `close` is whatever the mode's
 * own exit control does, so back and that control stay in step by construction.
 */
export function useNavEscape(
  active: boolean,
  close: () => void,
  depth: number = ESCAPE_DEPTH.mode,
) {
  const { registerEscape } = useNavHistory();
  const closeRef = useRef(close);
  closeRef.current = close;
  const idRef = useRef<string>("");
  if (!idRef.current) idRef.current = Math.random().toString(36).slice(2);

  useEffect(() => {
    if (!active) return;
    return registerEscape({
      id: idRef.current,
      depth,
      close: () => closeRef.current(),
    });
  }, [active, depth, registerEscape]);
}
