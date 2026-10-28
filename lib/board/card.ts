/**
 * The card record: the shape one card file holds, the caps a write is held to,
 * and the parser that decides whether a file on disk is still a card.
 *
 * A card is the feature-level unit of the shared board: one outcome, one owner,
 * and the history that explains it. Steps are deliberately *not* cards — they
 * live in the owner's plan and todo — so a card carries a title and hints rather
 * than a checklist.
 *
 * The record is untrusted when it comes back off disk: a file may be half-written
 * by a process that died, hand-edited, or left by an older version. {@link isCard}
 * is the shape every read is held to; the reader that maps an older shape onto this
 * one is `read.ts`, so the router, the tool, and the page see the same record or none.
 * Value-only: no I/O, no state.
 */

import { sanitizeLine } from "../format.ts";
import { type Contract, isContract, isSign, type Sign } from "./contract.ts";
import { LANE_RULES, LANES, type Lane } from "./lanes.ts";

/** The schema version this build writes. A file with another value is refused, never migrated in place. */
export const CARD_VERSION = 2;

/**
 * The card versions this build can read.
 *
 * A v1 file is the record before the lane and the block were renamed: `readCard` maps it
 * and hands back a v2 card, and the file itself is rewritten only when the card is next
 * written. A version above {@link CARD_VERSION} is a newer build's record, which this one
 * names rather than guesses at.
 */
export const SUPPORTED_VERSIONS = [1, CARD_VERSION] as const;

/**
 * The ended-card record's own version.
 *
 * The ledger is not the card: it is written once, never read back, and must not move when
 * the card record does, or every record a past build wrote would disagree with its own
 * validator.
 */
export const ENDED_VERSION = 1;

/** Longest title, in characters. One line, so it cannot wrap a lane row. */
export const MAX_TITLE = 120;

/** Most path hints one card may carry. */
export const MAX_PATHS = 12;

/** Longest path hint, in characters. */
export const MAX_PATH = 200;

/** Longest recorded plan path, in characters. */
export const MAX_PLAN = 300;

/** Longest sentence saying what a blocked card is waiting on: one line, so it fits a row. */
export const MAX_BLOCKED = 200;

/**
 * Why a card is blocked: what a person has to read before it moves again.
 *
 * A block is not one thing: a contract that turned out wrong, a dependency, and a decision
 * a person owes the card are different errands. The kind is the card's own claim — the board
 * records it and draws it, and nothing here can verify that a "contract" block really is
 * one — so it explains the card rather than routing it: where a blocked card may go is
 * decided by what it has, not by what it was parked on.
 */
export const BLOCKERS = ["contract", "dependency", "decision"] as const;

/** One kind of block. */
export type BlockerKind = (typeof BLOCKERS)[number];

/** Longest single note, in characters. */
export const MAX_NOTE = 1000;

/** How many notes one card keeps; the oldest drops past this, counted in `notesDropped`. */
export const MAX_NOTES = 8;

/**
 * How many lane transitions one card keeps; the oldest drops past this, counted in
 * `logDropped`.
 *
 * Bounded at write time rather than by a janitor, because nothing prunes a board: the
 * log is the only record of when a lane was entered, so it has to stay small enough
 * that every card can afford one.
 */
export const MAX_LOG = 8;

/** How many other cards one card may wait on. */
export const MAX_DEPENDS = 6;

/** The priorities a card may carry, most urgent first — the order a lane sorts by. */
export const PRIORITIES = ["high", "normal", "low"] as const;

/** One priority a card can carry. */
export type Priority = (typeof PRIORITIES)[number];

/** What an absent priority means: a card is ordinary until somebody says otherwise. */
export const DEFAULT_PRIORITY: Priority = "normal";

/** Who holds a card: the session id when it is known, and always the label it is addressed by. */
export interface CardOwner {
	/** Session id, when the claim came from a live session. */
	id?: string;
	/** The bus label, which is what a peer is addressed by. */
	label: string;
}

/**
 * Why a card is blocked: the kind, and the sentence a person reads.
 *
 * One record rather than two sibling keys, because one fact deserves one key. The kind is
 * absent only on a card written before it existed — a v1 block may hold the sentence alone
 * — and every block this build writes carries one, because the move into `blocked`
 * requires it. It says what kind of errand parked the card, and it is not a route: the way
 * out is the lane the card's contract lets it resume in.
 */
export interface CardBlock {
	/** Why it is blocked, when it was recorded. */
	kind?: BlockerKind;
	/** What it waits on, in one line; absent means the block was recorded without a sentence. */
	note?: string;
}

/** One note: who wrote it, when, and what it says. */
export interface CardNote {
	by: string;
	at: number;
	text: string;
}

/**
 * One lane a card has been in, when it got there, and who moved it.
 *
 * `updatedAt` moves on every write, so it answers "when was this last touched", not
 * "how long has this been blocked": a note filed against a blocked card resets it. A
 * transition is recorded only when the lane actually changes, which is the fact the
 * page needs and the one a reader has no way to reconstruct.
 */
export interface CardTransition {
	lane: Lane;
	at: number;
	by: string;
	/**
	 * What the card was parked on, when the lane entered is `blocked`.
	 *
	 * The present block is deleted when the card leaves `blocked`, so without this the
	 * answer to "why did this sit for two days" dies with the resume. The log keeps it for
	 * as long as the transition lives, which is the same bounded history as every other transition.
	 */
	block?: CardBlock;
}

/**
 * What a finished card landed as.
 *
 * A `done` card cannot say which change closed it from its own text, and `done` is
 * terminal, so the commit is recorded once, where the move that finished it happens.
 */
export interface CardLanded {
	/** The commit at the move to `done`, as git resolves `HEAD` there. */
	commit: string;
	/** When the card was finished. */
	at: number;
}

/** One feature on the board. */
export interface Card {
	/** Schema version; an unknown value is refused rather than guessed at. */
	v: 2;
	/** `"4"`, shown as `#4`. Allocated by the store, never by a caller. */
	id: string;
	/** One line, ≤ {@link MAX_TITLE} — the feature's outcome. */
	title: string;
	lane: Lane;
	owner?: CardOwner;
	/** Repository-relative hints, never claims. */
	paths: string[];
	/** The plan file the work is done against, once one is recorded. */
	planPath?: string;
	/** What the card promises before it may be executed, and who approved that wording. */
	contract?: Contract;
	/** Who spot-checked the finished work, and when: what a move to `done` requires. */
	review?: Sign;
	/**
	 * What the card is blocked on, while it is in `blocked`.
	 *
	 * A dependency is a different thing, and `waits` is what refuses a claim; this is the
	 * human decision a card was parked on. Absent unless the card is blocked, and deleted
	 * when it leaves — the transition log keeps what it was.
	 */
	blocked?: CardBlock;
	/** What closed a finished card: the commit at the move to `done`, and when. */
	landed?: CardLanded;
	/**
	 * When this card was last offered to the team, and nobody has taken it.
	 *
	 * An offer is a bus event, and an event leaves nothing behind: a card offered to three
	 * sessions that all ignored it read exactly like one nobody had looked at. This is the
	 * one fact an offer can leave, and every answer to it — a claim, an assignment, a
	 * release, a move — clears it, so a record here means the offer is still open.
	 */
	offeredAt?: number;
	/** How urgent the feature is; absent reads as {@link DEFAULT_PRIORITY}. */
	priority?: Priority;
	/** Ids of the cards this one waits for; absent reads as none. */
	dependsOn?: string[];
	/** The last {@link MAX_NOTES} notes, oldest first. */
	notes: CardNote[];
	/** How many notes dropped off the front, so a reader knows history was elided. */
	notesDropped: number;
	/**
	 * The lanes this card has been in, oldest first: the last {@link MAX_LOG} transitions.
	 *
	 * Absent on a card written before this field existed, which is why every reader goes
	 * through {@link laneSince} rather than reading the list directly.
	 */
	log?: CardTransition[];
	/** How many transitions dropped off the front, so a reader knows the log was elided. */
	logDropped?: number;
	/** Bumped per write; the compare-and-set guard a concurrent writer loses on. */
	rev: number;
	createdAt: number;
	updatedAt: number;
	/** The label of whoever wrote this revision. */
	by: string;
}

/**
 * What a card left behind when it was dropped: the record that its id is spent.
 *
 * A card's id is how a note, a handoff, or another card names one feature, so an id
 * that comes back is worse than an id that is gone — the same number would answer for
 * two different features. The store keeps one of these per ended card, writes it
 * before the card file goes, and never allocates its id again.
 *
 * The pile is a ledger, and this build never reads it back: the spent ids are the file
 * names the allocator skips, and the record itself is for a person opening the directory.
 * {@link isEndedCard} is the shape a reader would have to hold one to, and it is why the
 * field is `lane` rather than the `status` an older record spells — nothing migrates a
 * record no code path opens.
 */
export interface EndedCard {
	/** Schema version for the record itself; it moves with neither the card record nor time. */
	v: 1;
	/** The id that is now spent, without padding. */
	id: string;
	/** What the card was called, so a note that names its id still reads. */
	title: string;
	/** The lane it was in when it ended. */
	lane: Lane;
	/** Who ended it. */
	by: string;
	/** The owner it had, when it had one. */
	owner?: CardOwner;
	/** When it ended. */
	at: number;
	/** Why it ended: the operation, which is `drop` today. */
	why: "dropped";
}

/** Whether `value` is an ended-card record this build can trust. */
export function isEndedCard(value: unknown): value is EndedCard {
	if (typeof value !== "object" || value === null) return false;
	const ended = value as Record<string, unknown>;
	if (ended.v !== ENDED_VERSION) return false;
	if (typeof ended.id !== "string" || !/^[0-9]+$/.test(ended.id)) return false;
	if (typeof ended.title !== "string" || ended.title === "") return false;
	if (!LANES.includes(ended.lane as Lane)) return false;
	if (typeof ended.by !== "string" || ended.by === "") return false;
	if (!isOwner(ended.owner)) return false;
	if (typeof ended.at !== "number" || !Number.isInteger(ended.at)) return false;
	return ended.why === "dropped";
}

/** A rejected field, phrased for the model: what was wrong, not that something was. */
export type FieldError = { error: string };

/** The title as stored: one sanitized line, or the reason it cannot be one. */
export function normalizeTitle(raw: unknown): { title: string } | FieldError {
	if (typeof raw !== "string") return { error: "title is required." };
	const title = sanitizeLine(raw).trim();
	if (title === "") return { error: "title is required." };
	if (title.length > MAX_TITLE) return { error: `title must be at most ${MAX_TITLE} characters.` };
	return { title };
}

/**
 * The path hints as stored: deduplicated, posix-separated, and inside the
 * repository.
 *
 * A hint is not a claim, so it is never resolved against the filesystem — but an
 * absolute path or one that climbs out of the repository would read as a claim on
 * something the board cannot see, so both are refused.
 */
export function normalizePathHints(raw: unknown): { paths: string[] } | FieldError {
	if (raw === undefined) return { paths: [] };
	if (!Array.isArray(raw)) return { error: "paths must be a list of repository-relative paths." };
	if (raw.length > MAX_PATHS) return { error: `at most ${MAX_PATHS} paths are allowed.` };
	const paths: string[] = [];
	for (const entry of raw) {
		if (typeof entry !== "string") return { error: "every path must be a string." };
		const cleaned = sanitizeLine(entry).trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
		if (cleaned === "") return { error: "every path must be a non-empty string." };
		if (cleaned.length > MAX_PATH) return { error: `a path must be at most ${MAX_PATH} characters.` };
		if (cleaned.startsWith("/") || /^[a-zA-Z]:\//.test(cleaned)) {
			return { error: `path "${cleaned}" is absolute; use a repository-relative path.` };
		}
		if (cleaned.split("/").includes("..")) return { error: `path "${cleaned}" is outside the repository.` };
		if (!paths.includes(cleaned)) paths.push(cleaned);
	}
	return { paths };
}

/**
 * The priority as stored: one of {@link PRIORITIES}, or the reason it cannot be.
 *
 * Anything absent is `normal`, so `add` needs no default of its own and an older
 * card file reads as the ordinary feature it was.
 */
export function normalizePriority(raw: unknown): { priority: Priority } | FieldError {
	const allowed = PRIORITIES.join(", ");
	if (raw === undefined) return { priority: DEFAULT_PRIORITY };
	if (typeof raw !== "string") return { error: `priority must be one of ${allowed}.` };
	const priority = sanitizeLine(raw).trim().toLowerCase();
	const known = PRIORITIES.find((entry) => entry === priority);
	return known === undefined ? { error: `priority must be one of ${allowed}.` } : { priority: known };
}

/** A card's priority, with the absent field read as its meaning. */
export function priorityOf(card: Card): Priority {
	return card.priority ?? DEFAULT_PRIORITY;
}

/** A card's dependencies, with the absent field read as its meaning. */
export function dependsOf(card: Card): readonly string[] {
	return card.dependsOn ?? [];
}

/**
 * When the card entered the lane it is in now, or `undefined` when its history does not
 * say.
 *
 * Two ways to know nothing: a card written before the log existed, and one whose entry
 * for the current lane has dropped off the front of a full log. Both read the same to a
 * caller — the page draws no age — rather than a guess from `updatedAt`, which is a
 * different fact and would be wrong exactly when a card is being worked on.
 */
export function laneSince(card: Card): number | undefined {
	const last = card.log?.at(-1);
	return last !== undefined && last.lane === card.lane ? last.at : undefined;
}

/** Where a card's priority sits in {@link PRIORITIES}: the lane sort's first key after the lane. */
export function priorityRank(card: Card): number {
	return PRIORITIES.indexOf(priorityOf(card));
}

/**
 * Whether `query` names `card`: its title, its holder, a path hint, its plan, or a note.
 *
 * The page's filter and `board list`'s `query` are the same question, so they are the
 * same rule here — and the same *body*: this function's source is spliced into the
 * browser bundle as `MATCHES_QUERY_JS`, which is why it is written with concatenation
 * and no backtick. A second copy in the page is exactly what drifted before.
 *
 * The order is the answer's weight: a title hit is what a reader meant, then who holds
 * it, then where it lives, and only then the reasoning — a plan path and the notes,
 * which are the two fields that make a card findable by what it says.
 */
export function matchesQuery(card: Card, query: string): boolean {
	const needle = query.trim().toLowerCase();
	if (needle === "") return true;
	if (card.title.toLowerCase().includes(needle)) return true;
	if (card.owner !== undefined && card.owner.label.toLowerCase().includes(needle)) return true;
	if (card.paths.some((path) => path.toLowerCase().includes(needle))) return true;
	if (card.planPath !== undefined && card.planPath.toLowerCase().includes(needle)) return true;
	return card.notes.some((note) => note.text.toLowerCase().includes(needle));
}

/** The same body, as the browser receives it: one rule for the tool and the filter box. */
export const MATCHES_QUERY_JS = String(matchesQuery);

/** One note's text: a single sanitized line, or the reason it cannot be one. */
export function normalizeNote(raw: unknown): { text: string } | FieldError {
	if (typeof raw !== "string") return { error: "text is required." };
	const text = sanitizeLine(raw).trim();
	if (text === "") return { error: "text is required." };
	if (text.length > MAX_NOTE) return { error: `text must be at most ${MAX_NOTE} characters.` };
	return { text };
}

/**
 * The recorded plan path: one line, and nothing more.
 *
 * The board never reads the plan, so it does not resolve or check the path — this
 * is a note to the reader about which plan the card is executing.
 */
export function normalizePlanPath(raw: unknown): { path: string } | FieldError {
	if (typeof raw !== "string") return { error: "path is required." };
	const path = sanitizeLine(raw).trim();
	if (path === "") return { error: "path is required." };
	if (path.length > MAX_PLAN) return { error: `path must be at most ${MAX_PLAN} characters.` };
	return { path };
}

/**
 * The block a move records: one kind, and the sentence when one is given.
 *
 * The refusals name the tool's parameters (`blocker`, `blockedBy`) rather than the record's
 * fields, because this is the boundary the model's arguments pass, and the model wrote a
 * parameter. The kind is required here — a block this build writes always says what kind it
 * is — and the sentence is not: a card may be parked with nothing written down.
 */
export function normalizeBlock(rawKind: unknown, rawNote: unknown): { blocked: CardBlock } | FieldError {
	const allowed = BLOCKERS.join(", ");
	const kind = typeof rawKind === "string" ? sanitizeLine(rawKind).trim().toLowerCase() : "";
	const known = BLOCKERS.find((entry) => entry === kind);
	if (known === undefined) return { error: `blocker must be one of ${allowed}.` };
	if (rawNote === undefined) return { blocked: { kind: known } };
	if (typeof rawNote !== "string") return { error: "blockedBy must be text." };
	const note = sanitizeLine(rawNote).trim();
	if (note === "") return { error: "blockedBy must say what the card waits on." };
	if (note.length > MAX_BLOCKED) {
		return { error: `blockedBy must be at most ${MAX_BLOCKED} characters.` };
	}
	return { blocked: { kind: known, note } };
}

/** A card id as a caller writes it (`4`, `#4`), or undefined when it is not one. */
export function normalizeCardId(raw: unknown): string | undefined {
	if (typeof raw !== "string") return undefined;
	const id = raw.trim().replace(/^#/, "");
	return /^[0-9]+$/.test(id) ? id : undefined;
}

/** The id as everything user-facing writes it. */
export function cardRef(id: string): string {
	return `#${id}`;
}

/**
 * The board's version, as one string: every card's id and revision, sorted.
 *
 * The page pushes a snapshot only when this moves, so the signature has to differ
 * for a revision bump even inside one millisecond — which is why it carries `rev`
 * rather than a timestamp. A dropped card changes it by leaving.
 */
export function signatureOf(cards: readonly Card[]): string {
	return cards
		.map((card) => `${card.id}:${card.rev}`)
		.sort()
		.join(",");
}

/**
 * Whether `actor` is the owner of `card`.
 *
 * The id decides when both sides have one — a session that renamed itself is still the same
 * holder — and the label decides otherwise, case-insensitively, the way the bus resolves a
 * target. A signature that takes the actor structurally is what lets the record own this
 * rule while `rules.ts` and `steps.ts` share it without importing each other.
 */
export function holds(card: Card, actor: { id?: string; label: string }): boolean {
	const owner = card.owner;
	if (owner === undefined) return false;
	if (owner.id !== undefined && actor.id !== undefined) return owner.id === actor.id;
	return owner.label.toLowerCase() === actor.label.toLowerCase();
}

/**
 * Whether `value` is a card this build can trust.
 *
 * Shape *and* the invariants a bug could otherwise smuggle past the rules: the one
 * ownerless lane really has no owner, and the others always have one. A card that fails
 * here is dropped by the reader rather than repaired, because a repair would guess at
 * which half of the record was meant.
 */
export function isCard(value: unknown): value is Card {
	if (typeof value !== "object" || value === null) return false;
	const card = value as Record<string, unknown>;
	if (card.v !== CARD_VERSION) return false;
	if (typeof card.id !== "string" || !/^[0-9]+$/.test(card.id)) return false;
	if (typeof card.title !== "string" || card.title === "") return false;
	if (!LANES.includes(card.lane as Lane)) return false;
	// The lane was just proved to be one of `LANES`, which is the whole guarantee the cast
	// names: from here the table can be addressed by it.
	const lane = card.lane as Lane;
	if (!isOwner(card.owner)) return false;
	if (!Array.isArray(card.paths) || card.paths.length > MAX_PATHS) return false;
	if (!card.paths.every((path) => typeof path === "string")) return false;
	if (card.planPath !== undefined && typeof card.planPath !== "string") return false;
	if (card.contract !== undefined && !isContract(card.contract)) return false;
	if (card.review !== undefined && !isSign(card.review)) return false;
	if (card.blocked !== undefined && !isBlock(card.blocked)) return false;
	if (card.landed !== undefined && !isLanded(card.landed)) return false;
	if (card.offeredAt !== undefined && (typeof card.offeredAt !== "number" || !Number.isInteger(card.offeredAt))) {
		return false;
	}
	if (card.priority !== undefined && !PRIORITIES.includes(card.priority as Priority)) return false;
	if (card.dependsOn !== undefined && !isDepends(card.dependsOn)) return false;
	if (!Array.isArray(card.notes) || card.notes.length > MAX_NOTES) return false;
	if (!card.notes.every(isNote)) return false;
	if (typeof card.notesDropped !== "number") return false;
	if (card.log !== undefined && (!Array.isArray(card.log) || card.log.length > MAX_LOG)) return false;
	if (Array.isArray(card.log) && !card.log.every(isTransition)) return false;
	if (card.logDropped !== undefined && !isCount(card.logDropped)) return false;
	if (typeof card.rev !== "number" || !Number.isInteger(card.rev) || card.rev < 1) return false;
	if (typeof card.createdAt !== "number" || typeof card.updatedAt !== "number") return false;
	if (typeof card.by !== "string") return false;
	// One ownerless lane, and the table says which: a pool card has no holder, and every
	// card that is somebody's work has one.
	return LANE_RULES[lane].ownerless === (card.owner === undefined);
}

/**
 * A recorded block: a kind this build knows when one is there, and a sentence a row can
 * hold when one is there — at least one of the two, because an empty block says nothing.
 */
function isBlock(value: unknown): value is CardBlock {
	if (typeof value !== "object" || value === null) return false;
	const block = value as Record<string, unknown>;
	if (block.kind !== undefined && !BLOCKERS.includes(block.kind as BlockerKind)) return false;
	if (block.note !== undefined) {
		if (typeof block.note !== "string" || block.note === "" || block.note.length > MAX_BLOCKED) return false;
	}
	return block.kind !== undefined || block.note !== undefined;
}

/** A recorded landing: a commit id and the moment it closed the card. */
function isLanded(value: unknown): value is CardLanded {
	if (typeof value !== "object" || value === null) return false;
	const landed = value as Record<string, unknown>;
	if (typeof landed.commit !== "string" || !/^[0-9a-f]{4,40}$/.test(landed.commit)) return false;
	return typeof landed.at === "number" && Number.isInteger(landed.at);
}

function isOwner(value: unknown): boolean {
	if (value === undefined) return true;
	if (typeof value !== "object" || value === null) return false;
	const owner = value as Record<string, unknown>;
	if (typeof owner.label !== "string" || owner.label === "") return false;
	return owner.id === undefined || typeof owner.id === "string";
}

/**
 * Whether `value` is a dependency list this build can trust: card ids, unowned ids,
 * and no repeats — a set, because waiting twice on one card means nothing.
 */
function isDepends(value: unknown): boolean {
	if (!Array.isArray(value) || value.length > MAX_DEPENDS) return false;
	const seen = new Set<string>();
	for (const id of value) {
		if (typeof id !== "string" || !/^[0-9]+$/.test(id) || seen.has(id)) return false;
		seen.add(id);
	}
	return true;
}

/** A recorded lane change: a lane, a moment, and who moved it, and what it parked on. */
function isTransition(value: unknown): value is CardTransition {
	if (typeof value !== "object" || value === null) return false;
	const entry = value as Record<string, unknown>;
	if (entry.block !== undefined && !isBlock(entry.block)) return false;
	return (
		LANES.includes(entry.lane as Lane) &&
		typeof entry.at === "number" &&
		Number.isInteger(entry.at) &&
		typeof entry.by === "string" &&
		entry.by !== ""
	);
}

/** A count a reader can trust: a whole number that never ran backwards past zero. */
function isCount(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isNote(value: unknown): boolean {
	if (typeof value !== "object" || value === null) return false;
	const note = value as Record<string, unknown>;
	return typeof note.by === "string" && typeof note.at === "number" && typeof note.text === "string";
}
