/**
 * The seams every screen fixture is drawn through.
 *
 * One clock, so the ages and timestamps within a frame agree; a no-op
 * `requestRender`; and the TUI double a dialogue screen's inline editor reads
 * on construction. A capture sends no keys, so that is the whole guarantee.
 */

import type { TUI } from "@earendil-works/pi-tui";

/** A no-op `requestRender`, for a frame a test or a capture draws. */
export const noop = (): void => {};
/** One clock for every fixture, so the ages and timestamps within a frame agree. */
export const now = Date.now();

/**
 * The dialogue screens take a TUI for their inline `Editor`. A capture sends no
 * keys and the editor is never shown in list mode, so the two members an editor
 * reads on construction are the whole guarantee this double makes.
 */
export const SCREEN_TUI = { requestRender: noop, terminal: { rows: 40, columns: 120 } } as unknown as TUI;
