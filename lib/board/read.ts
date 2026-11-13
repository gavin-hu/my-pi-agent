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
import { isLanding } from "./contract.ts";
import type { Lane } from "./lanes.ts";

/**
 * The lane words the four-lane board used, as this build's names.
 *
 * `todo` was the pool nobody held and `doing` was the work in hand; `blocked` and `done`
 * kept their names, so they need no row here.
 */
const LEGACY_LANES: Readonly<Record<string, Lane>> = { todo: "backlog", doing: "execute" };

/**
 * The lane one v1 word names — the record's own `status` and its log entries', through one table.
 *
 * A word with no row is not one this build can place, so it is left as it is and {@link isCard}
 * refuses the record: a lane guessed from an unknown word would put a card somewhere its own
 * history disagrees with. Both spellings come through here because they ask one question. A record
 * whose own `status` said `todo` used to skip the map the same file's log went through, so the
 * card was refused as unreadable while its history read `backlog`.
 */
function laneOf(word: unknown): unknown {
	return typeof word === "string" ? (LEGACY_LANES[word] ?? word) : word;
}

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
	const record = unreadableLanding(unresolvedOwner(migrated(value)));
	return isCard(record) ? record : undefined;
}

/**
 * A stored landing this build cannot read, read as absent.
 *
 * The field arrived late, and the live board shows what that costs: 185 records carry
 * `{ commit, at }` from a build that wrote one before the rule, and a shape gate that refused them
 * froze their cards as skipped files — 50 of them unreadable until this map existed. Evidence is
 * not identity, so the landing a reader cannot resolve is dropped and the rest of the record is
 * read: a card closed before the rule, or by a session running a build from before it, carries no
 * landing, and nothing invents one for it.
 */
function unreadableLanding(value: unknown): unknown {
	if (typeof value !== "object" || value === null) return value;
	const { landed, ...rest } = value as Record<string, unknown>;
	if (landed === undefined || isLanding(landed)) return value;
	return rest;
}

/**
 * An owner that came from a handoff the bus could not resolve: a handoff, and no session id.
 *
 * The one fact a stored record cannot say for itself — only the write that sent the handoff could
 * know it — so it is read rather than written, and no file is rewritten. It withdraws authority,
 * never addressability: the label the owner carries is still where its mail goes.
 */
function unresolvedOwner(value: unknown): unknown {
	if (typeof value !== "object" || value === null) return value;
	const { owner, ...rest } = value as Record<string, unknown>;
	if (typeof owner !== "object" || owner === null) return value;
	const { handoff, ...held } = owner as Record<string, unknown>;
	if (typeof handoff !== "object" || handoff === null || held.id !== undefined) return value;
	return { ...rest, owner: { ...held, handoff: { ...handoff, unresolved: true } } };
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
		...(status === undefined || record.lane !== undefined ? {} : { lane: laneOf(status) }),
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
		// The same table the record's own `status` goes through: a log entry and the lane it moved
		// the card to are one question, so they cannot answer it differently.
		return { ...rest, lane: laneOf(status) };
	});
}
