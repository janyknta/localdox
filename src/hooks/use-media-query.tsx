import * as React from "react";

/**
 * Subscribe to a CSS media query from React.
 *
 * `useIsMobile` answers one fixed question ("narrower than 768px?"); this
 * answers any of them, so a layout that needs a different threshold — or asks
 * about the pointer rather than the width — does not have to hardcode a second
 * `matchMedia` listener of its own.
 *
 * Returns `false` on the first render and during SSR, where no viewport exists
 * yet, then corrects itself in the effect. Callers must therefore treat `false`
 * as "the wide/default layout", which is the one that degrades most gracefully
 * if it shows for a frame.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = React.useState(false);

  React.useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent | MediaQueryList) => setMatches(event.matches);
    onChange(mql);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/**
 * True where the primary input is a finger rather than a mouse.
 *
 * Width is a poor proxy for this — a 1024px tablet is touch-only and a narrow
 * desktop window is not — so anything sizing a control for a thumb should ask
 * this instead of a breakpoint. Mirrors the `coarse:` CSS variant for the cases
 * that cannot be expressed in a class.
 */
export function useIsCoarsePointer(): boolean {
  return useMediaQuery("(pointer: coarse)");
}
