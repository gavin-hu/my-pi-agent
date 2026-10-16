/**
 * The Bytefly terminal design system: one kit for every interactive surface.
 *
 * Import from `lib/tui/index.ts` rather than a leaf module so the surface reads
 * as one system. The leaves: `tokens.ts` (semantic role -> theme token),
 * `glyphs.ts` (the shared glyph, separator, and status-key vocabulary),
 * `chrome.ts` (screen frame, hints, viewport, overlay), `cursor.ts` (list
 * scroll and navigation), `columns.ts` (width math), `rules.ts` (the rule
 * grammar), `rows.ts` (list rows, checkboxes, chips, empty states), `gauge.ts`
 * (the context gauge), and `line-pane.ts` (the scrollable log/match pane).
 *
 * Value-only, like every `lib/` module: pure functions, constants, and classes,
 * with no module-level state.
 */

export * from "./chrome.ts";
export * from "./columns.ts";
export * from "./cursor.ts";
export * from "./gauge.ts";
export * from "./glyphs.ts";
export * from "./line-pane.ts";
export * from "./rows.ts";
export * from "./rules.ts";
export * from "./status-controller.ts";
export * from "./tokens.ts";
