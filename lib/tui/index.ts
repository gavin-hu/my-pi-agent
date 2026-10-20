/**
 * The Bytefly terminal design system: one kit for every interactive surface.
 *
 * Import from `lib/tui/index.ts` rather than a leaf module so the surface reads
 * as one system. The leaves: `tokens.ts` (semantic role -> theme token),
 * `glyphs.ts` (the shared glyph, separator, and status-key vocabulary),
 * `chrome.ts` (screen frame, hints, viewport, overlay), `cursor.ts` (list
 * scroll and navigation), `columns.ts` (width math), `rules.ts` (the rule
 * grammar), `rows.ts` (list rows, checkboxes, chips, empty states), `gauge.ts`
 * (the context gauge), `indent.ts` (the transcript block indent), and
 * `line-pane.ts` (the scrollable log/match pane), and
 * (the shared tool-transcript kit: call title, width-safe call line,
 * sanitized error, and the running timer), and `render-cache.ts` (the
 * per-instance line memo a derived component renders through).
 *
 * Value-only, like every `lib/` module: pure functions, constants, and classes,
 * with no module-level state.
 */

export * from "./chrome.ts";
export * from "./columns.ts";
export * from "./confirm.ts";
export * from "./cursor.ts";
export * from "./dock-screen.ts";
export * from "./gauge.ts";
export * from "./glyphs.ts";
export * from "./line-pane.ts";
export * from "./indent.ts";
export * from "./render-cache.ts";
export * from "./rows.ts";
export * from "./rules.ts";
export * from "./status-controller.ts";
export * from "./tokens.ts";
export * from "./tool.ts";
