/**
 * Reading cards: one file's gate, and the pile a board is.
 *
 * The record itself is `card.ts`; this is what a file on disk becomes. Every version this
 * build can read passes through {@link readCard}, which maps the names a past build wrote
 * and stamps the version this one writes — a v1 file says `status`, `plan`, and a
 * `blockedBy`/`blocker` pair where the record says `lane`, `planPath`, and `blocked`. The
 * map is read-time only: no file is rewritten, so a board full of older cards reads as a
 * board rather than as a pile of refusals, and each card takes the new shape on its next
 * write.
 *
 * {@link scanPile} is the directory: one read per card file, on a bound, answering what the
 * pile shows, what it refused, and what it costs. It is the only I/O here, and it is why the
 * store can be the module that writes: a file is opened here to be read, and nowhere else.
 *
 * No clock, no state.
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { hasErrorCode } from "../errors.ts";
import { mapConcurrent } from "../pool.ts";
import {
	BLOCKERS,
	type BlockerKind,
	type Card,
	type CardBlock,
	CARD_VERSION,
	canonicalCardId,
	isCard,
	priorityRank,
	SUPPORTED_VERSIONS,
} from "./card.ts";
import { isLanding } from "./contract.ts";
import { LANES, type Lane } from "./lanes.ts";

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

/**
 * A card file the reader refused, and why.
 *
 * The lanes skip these, so without this the board reads as if they were never there:
 * "nobody has planned anything" instead of "this build cannot read your work".
 */
export interface Skip {
	/** The file name, e.g. `0042.json`. */
	file: string;
	/** The id the file name spells, when it spells one, so a caller can match a refusal. */
	id?: string;
	/** What is wrong, phrased for a reader: `bad JSON`, `version 2`. */
	why: string;
}

/** The card files the reader accepts. */
export const CARD_FILE = /^(\d{4,})\.json$/;

/** One card file: the card or the reason this build refused it, and the bytes it occupies. */
type CardFileRead = { card: Card; bytes: number } | { skip: Skip; bytes: number };

/**
 * One card file, read once: the file's bytes are decoded and counted in the same pass, so a
 * caller that wants the pile's size pays nothing for it — and a name that is not a card file is
 * never opened, so it counts as nothing.
 */
export async function readCardFile(pileDir: string, entry: string): Promise<CardFileRead> {
	const match = CARD_FILE.exec(entry);
	if (!match) return { skip: { file: entry, why: "not a card id" }, bytes: 0 };
	const id = canonicalCardId(match[1]);
	const raw = await readFile(join(pileDir, entry)).catch(() => undefined);
	if (raw === undefined) return { skip: { file: entry, id, why: "cannot be read" }, bytes: 0 };
	// The read bytes are the file's size, so the size needs no `stat` of its own.
	const bytes = raw.length;
	const text = raw.toString("utf-8");
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return { skip: { file: entry, id, why: "bad JSON" }, bytes };
	}
	// A version this build does not read is the one refusal a reader can act on: the file was
	// written by a newer build, so the board is not empty, it is not readable here. Every
	// version `readCard` can map is read; the number is named rather than guessed at.
	const version = typeof parsed === "object" && parsed !== null ? (parsed as { v?: unknown }).v : undefined;
	if (typeof version === "number" && !SUPPORTED_VERSIONS.some((known) => known === version)) {
		return { skip: { file: entry, id, why: `version ${version}` }, bytes };
	}
	// The one gate a file read passes: an older spelling of the lane field is read as
	// this build's, and everything else is a shape this build does not trust.
	const card = readCard(parsed);
	if (card === undefined) return { skip: { file: entry, id, why: "not a card record" }, bytes };
	// The file name is the id's canonical spelling: a padded id inside the record
	// (or a record moved under another name) is a disagreement, not a card.
	if (card.id !== canonicalCardId(match[1])) {
		return { skip: { file: entry, id, why: `names card ${card.id}` }, bytes };
	}
	return { card, bytes };
}

/** A directory listing, with a directory that is not there read as empty. */
export async function readdirSafe(dir: string): Promise<string[]> {
	return readdir(dir).catch((error: unknown) => {
		if (hasErrorCode(error, "ENOENT")) return [];
		throw error;
	});
}

/**
 * Lane order, then the lead's order inside it, then the order the cards were added in: the
 * id, which is allocated once and never reissued.
 *
 * Priority sorts inside a lane rather than beside it: a `high` card in Done is still
 * history, and a lane that mixed the two would have to say so in its head.
 *
 * The id carries the age, and `updatedAt` deliberately does not: every write moves that
 * stamp, so ordering by it makes a note, a claim, or a contract push a card to the end of
 * its priority and reshuffle the listing a reader was working down.
 */
export function sortForLane(cards: Card[]): Card[] {
	const lane = (card: Card): number => LANES.indexOf(card.lane);
	return cards.sort((a, b) => {
		const byLane = lane(a) - lane(b);
		if (byLane !== 0) return byLane;
		const byPriority = priorityRank(a) - priorityRank(b);
		if (byPriority !== 0) return byPriority;
		return Number(a.id) - Number(b.id);
	});
}

/**
 * Reads in flight per pile: enough to hide the round trip, not a burst.
 *
 * Nothing prunes a board by itself — a card leaves only when somebody archives it — so a pile
 * is a thousand files on a board worked for a year. Read strictly in turn, the pass pays a
 * round trip per card, which was 8.5 ms of a 14 ms scan for 269 of them; read all at once it
 * opens every file at once. This is the middle. The order is decided after the pass, so no
 * caller can see which read finished first.
 */
const PILE_READS = 16;

/**
 * Every card file of one pile, read once: what it shows, what it refused, and what it costs.
 *
 * The size comes off the read rather than a second pass, because the bytes are already in
 * hand: a frame that walked the directory again would stat every file it just opened.
 */
export async function scanPile(pileDir: string): Promise<{ cards: Card[]; skipped: Skip[]; bytes: number }> {
	const entries = await readdirSafe(pileDir);
	const reads = await mapConcurrent(entries, PILE_READS, (entry) => readCardFile(pileDir, entry));
	const cards: Card[] = [];
	const skipped: Skip[] = [];
	let bytes = 0;
	for (const [at, read] of reads.entries()) {
		// Counted for a refusal too: a card file this build cannot read still occupies the disk.
		bytes += read.bytes;
		if ("card" in read) cards.push(read.card);
		// Anything that is not a card-named file is not the board's to explain.
		else if ((entries[at] ?? "").endsWith(".json")) skipped.push(read.skip);
	}
	// Sorted by file name so two reads of one board say the same thing in the same order.
	return { cards: sortForLane(cards), skipped: skipped.sort((a, b) => a.file.localeCompare(b.file)), bytes };
}
