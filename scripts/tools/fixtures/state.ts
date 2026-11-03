/**
 * The render state a fixture seeds, so a running block draws the clock it is
 * pictured at (dev tooling).
 *
 * A partial result's renderer starts the call's clock on its first render, so a
 * fixture drawn from a cold state always showed `0ms` — `elapsedSuffix` floors
 * that to nothing, and a running block drew its verb with no number beside it.
 * `elapsedMs` puts the clock that far back instead; `syncElapsedTimer` honours it
 * because it only sets `startedAt` when the field is absent.
 */

import type { ToolFixture } from "./types.ts";

/** Pi's per-call render state for `fixture`: empty, or a call already `elapsedMs` long. */
export function fixtureState(fixture: ToolFixture): Record<string, unknown> {
	const elapsedMs = fixture.options?.elapsedMs;
	if (elapsedMs === undefined) return {};
	return { startedAt: Date.now() - elapsedMs };
}
