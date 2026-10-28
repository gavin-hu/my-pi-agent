/**
 * Reading a card file: the one gate a read passes, and the map from an older shape.
 *
 * The record itself is `card.ts`; this is what a file on disk becomes. Every version this
 * build can read passes through {@link readCard}, which maps the names a past build wrote
 * and stamps the version this one writes — a v1 file says `status`, `plan`, and a
 * `blockedBy`/`blocker` pair where the record says `lane`, `planPath`, and `blocked`. The
 * map is read-time only: no file is rewritten, so a board full of older cards reads as a
 * board rather than as a pile of refusals, and each card takes the new shape on its next
 * write.
 *
 * Pure: no I/O, no clock, no state.
 */

import { BLOCKERS, type BlockerKind, type Card, type CardBlock, CARD_VERSION, isCard } from "./card.ts";

/**
 * The card as a file on disk holds it, or `undefined` when this build cannot trust it.
 *
 * A v1 file is the record before the lane and the block were named: `status` for `lane`,
 * `plan` for `planPath`, a `blockedBy`/`blocker` pair for `blocked`, and — for a file older
 * still — log entries whose lane is spelled `status` too. This maps them on read and stamps
 * `v: 2`; the map is read-time only, so no file is rewritten and a card takes the new shape
 * on its next write. Everything else is {@link isCard}'s decision; a version above this
 * build's is the store's refusal to name, not this function's.
 */
export function readCard(value: unknown): Card | undefined {
	const record = migrated(value);
	return isCard(record) ? record : undefined;
}

/** A v1 record as this build's shape: the renames, and the version stamp. */
function migrated(value: unknown): unknown {
	if (typeof value !== "object" || value === null) return value;
	const record = value as Record<string, unknown>;
	if (record.v !== 1) return value;
	const { status, plan, blockedBy, blocker, log, ...rest } = record;
	const blocked = blockOf(blockedBy, blocker);
	return {
		...rest,
		v: CARD_VERSION,
		...(status === undefined || record.lane !== undefined ? {} : { lane: status }),
		...(plan === undefined ? {} : { planPath: record.planPath ?? plan }),
		...(blocked === undefined || record.blocked !== undefined ? {} : { blocked }),
		...(log === undefined ? {} : { log: logEntries(log) }),
	};
}

/** The block a v1 pair spells, keeping whichever half the file actually has. */
function blockOf(rawNote: unknown, rawKind: unknown): CardBlock | undefined {
	const kind =
		typeof rawKind === "string" && BLOCKERS.includes(rawKind as BlockerKind) ? (rawKind as BlockerKind) : undefined;
	const note = typeof rawNote === "string" && rawNote !== "" ? rawNote : undefined;
	if (kind === undefined && note === undefined) return undefined;
	return { ...(kind === undefined ? {} : { kind }), ...(note === undefined ? {} : { note }) };
}

/** A v1 log whose entries spelled the lane `status`, read as this build's entries. */
function logEntries(raw: unknown): unknown {
	if (!Array.isArray(raw)) return raw;
	return raw.map((entry) => {
		if (typeof entry !== "object" || entry === null) return entry;
		const record = entry as Record<string, unknown>;
		if (record.status === undefined || record.lane !== undefined) return entry;
		const { status, ...rest } = record;
		return { ...rest, lane: status };
	});
}
