/**
 * The board's two doors onto one age grammar: `30d`, `12h`, `90m`, `45s`.
 *
 * Two doors read a spec and mean different things by it — `archive`'s `--older-than` bound and a
 * shelf's `until` — so the spelling is parsed once, in `lib/format.ts`, and each door keeps its own
 * sentence for a spec it cannot read, because "nothing was swept" and "nothing was shelved" are two
 * different promises. A spec that lost its flag or its unit is refused rather than guessed at: `30d`
 * and `30` are one typo apart, and a sweep or a shelf that silently meant everything would be the
 * wrong kind of quiet.
 */

import { parseAge } from "../../lib/format.ts";

/** A bound as a caller wrote it, and its width: the sweep's limit, and the width a shelf turns into a moment. */
export interface SweepBound {
	spec: string;
	ms: number;
}

/**
 * A shelf's `until` as a width, or the sentence refusing the spec.
 *
 * The grammar is {@link parseAge}'s; only the promise differs — "nothing was shelved" — and that
 * sentence belongs to the door that keeps it rather than to the dispatch that prints it.
 */
export function shelfWidth(spec: string): { ms: number } | { error: string } {
	const ms = parseAge(spec);
	if (ms === undefined) {
		return { error: `"${spec}" is not an age — write one like 30d, 12h, or 90m. Nothing was shelved.` };
	}
	return { ms };
}
