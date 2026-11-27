/**
 * The board's one age grammar: `30d`, `12h`, `90m`, `45s`, as a width in milliseconds.
 *
 * Two doors read it and mean different things by it — `archive`'s `--older-than` bound and a
 * shelf's `until` — so the spelling is parsed once here, and each door keeps its own sentence
 * for a spec it cannot read, because "nothing was swept" and "nothing was shelved" are two
 * different promises. A spec that lost its flag or its unit is refused by the caller rather
 * than guessed at: `30d` and `30` are one typo apart, and a sweep or a shelf that silently
 * meant everything would be the wrong kind of quiet.
 *
 * Value-only: no I/O, no clock. A caller turns a width into a moment against its own now.
 */

/** One unit a bound may name, in milliseconds. */
const BOUND_UNITS: Readonly<Record<string, number>> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/**
 * An age bound as milliseconds: `30d`, `12h`, `90m`, `45s`, and nothing else.
 *
 * A whole number and one unit letter, so the spec a person mistypes — `/board archive 30d` with
 * no flag — is refused here rather than reaching a sweep, and refused again before it could read
 * as a card id. Zero is not a bound: a sweep that means everything says nothing at all.
 */
export function parseBound(spec: string): number | undefined {
	const match = /^([0-9]{1,6})([smhd])$/.exec(spec.trim().toLowerCase());
	if (match === null) return undefined;
	const unit = BOUND_UNITS[match[2] ?? ""];
	const amount = Number(match[1]);
	if (unit === undefined || !Number.isInteger(amount) || amount <= 0) return undefined;
	return amount * unit;
}

/** A bound as a caller wrote it, and its width: the sweep's limit, and the width a shelf turns into a moment. */
export interface SweepBound {
	spec: string;
	ms: number;
}

/**
 * A shelf's `until` as a width, or the sentence refusing the spec.
 *
 * The grammar is {@link parseBound}'s; only the promise differs — "nothing was shelved" — and that
 * sentence belongs to the door that keeps it rather than to the dispatch that prints it.
 */
export function shelfWidth(spec: string): { ms: number } | { error: string } {
	const ms = parseBound(spec);
	if (ms === undefined) {
		return { error: `"${spec}" is not an age — write one like 30d, 12h, or 90m. Nothing was shelved.` };
	}
	return { ms };
}
