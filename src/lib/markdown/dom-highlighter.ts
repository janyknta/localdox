import { ANNOTATION_COLORS } from "./annotations.ts";

/** Palette + the CSS ::highlight() group name each color maps to. Mirrors the
 *  `--highlight-*` tokens in styles.css — kept as literal values here (rather
 *  than read from the CSS custom properties) because they also have to work
 *  as plain data: named in a document's highlight fences (annotations.ts) and
 *  matched back to a ::highlight() group name. */
export const HL_COLORS: string[] = ANNOTATION_COLORS.map((color) => color.hex);
export const hlGroup = (color: string) => `dc-hl-${Math.max(0, HL_COLORS.indexOf(color))}`;

/** Ink for a highlight mark. Fixed rather than themed — see `--highlight-foreground`. */
export const HL_FOREGROUND = "#0a0a0a";
