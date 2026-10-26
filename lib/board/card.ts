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
 * is the one gate every read passes, so the router, the tool, and the page see
 * the same record or none. Value-only: no I/O, no state.
 */

import { sanitizeLine } from "../format.ts";

/** The schema version this build writes. A file with another value is refused, never migrated in place. */
export const CARD_VERSION = 1;

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

/** Longest single note, in characters. */
export const MAX_NOTE = 1000;

/** How many notes one card keeps; the oldest drops past this, counted in `notesDropped`. */
export const MAX_NOTES = 8;

/** How many other cards one card may wait on. */
export const MAX_DEPENDS = 6;

/** The priorities a card may carry, most urgent first — the order a lane sorts by. */
export const PRIORITIES = ["high", "normal", "low"] as const;

/** One priority a card can carry. */
export type Priority = (typeof PRIORITIES)[number];

/** What an absent priority means: a card is ordinary until somebody says otherwise. */
export const DEFAULT_PRIORITY: Priority = "normal";

/** The lanes, in the order the page and the rollup read them. */
export const CARD_STATUSES = ["todo", "doing", "blocked", "done"] as const;

/** One lane a card can sit in. */
export type CardStatus = (typeof CARD_STATUSES)[number];

/** Who holds a card: the session id when it is known, and always the label it is addressed by. */
export interface CardOwner {
	/** Session id, when the claim came from a live session. */
	id?: string;
	/** The bus label, which is what a peer is addressed by. */
	label: string;
}

/** One note: who wrote it, when, and what it says. */
export interface CardNote {
	by: string;
	at: number;
	text: string;
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
	v: 1;
	/** `"4"`, shown as `#4`. Allocated by the store, never by a caller. */
	id: string;
	/** One line, ≤ {@link MAX_TITLE} — the feature's outcome. */
	title: string;
	status: CardStatus;
	owner?: CardOwner;
	/** Repository-relative hints, never claims. */
	paths: string[];
	/** The plan file being executed, once one is recorded. */
	plan?: string;
	/**
	 * What a blocked card is waiting on: the decision, in one line.
	 *
	 * `blocked` exists to say a human has to decide something — a dependency is a
	 * different thing, and `waits` is what refuses a claim. Absent means the card was
	 * blocked without saying why, which is a state the tool allows and the page names.
	 */
	blockedBy?: string;
	/** What closed a finished card: the commit at the move to `done`, and when. */
	landed?: CardLanded;
	/** How urgent the feature is; absent reads as {@link DEFAULT_PRIORITY}. */
	priority?: Priority;
	/** Ids of the cards this one waits for; absent reads as none. */
	dependsOn?: string[];
	/** The last {@link MAX_NOTES} notes, oldest first. */
	notes: CardNote[];
	/** How many notes dropped off the front, so a reader knows history was elided. */
	notesDropped: number;
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
 */
export interface EndedCard {
	/** Schema version for the record itself; a reader refuses what it does not know. */
	v: 1;
	/** The id that is now spent, without padding. */
	id: string;
	/** What the card was called, so a note that names its id still reads. */
	title: string;
	/** The lane it was in when it ended. */
	status: CardStatus;
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
	if (ended.v !== CARD_VERSION) return false;
	if (typeof ended.id !== "string" || !/^[0-9]+$/.test(ended.id)) return false;
	if (typeof ended.title !== "string" || ended.title === "") return false;
	if (!CARD_STATUSES.includes(ended.status as CardStatus)) return false;
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
	if (card.plan !== undefined && card.plan.toLowerCase().includes(needle)) return true;
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
 * The sentence a block records: one line, and nothing more.
 *
 * The board never resolves it against anything — it is the reader's explanation of what
 * a person has to decide — so this only keeps it to a length a row can hold.
 */
export function normalizeBlockedBy(raw: unknown): { blockedBy: string } | FieldError {
	if (typeof raw !== "string") return { error: "blockedBy must be text." };
	const blockedBy = sanitizeLine(raw).trim();
	if (blockedBy === "") return { error: "blockedBy must say what the card waits on." };
	if (blockedBy.length > MAX_BLOCKED) {
		return { error: `blockedBy must be at most ${MAX_BLOCKED} characters.` };
	}
	return { blockedBy };
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
 * Whether `value` is a card this build can trust.
 *
 * Shape *and* the two invariants a bug could otherwise smuggle past the rules: a
 * `todo` card has no owner, and the other three lanes always have one. A card that
 * fails here is dropped by the reader rather than repaired, because a repair would
 * guess at which half of the record was meant.
 */
export function isCard(value: unknown): value is Card {
	if (typeof value !== "object" || value === null) return false;
	const card = value as Record<string, unknown>;
	if (card.v !== CARD_VERSION) return false;
	if (typeof card.id !== "string" || !/^[0-9]+$/.test(card.id)) return false;
	if (typeof card.title !== "string" || card.title === "") return false;
	if (!CARD_STATUSES.includes(card.status as CardStatus)) return false;
	if (!isOwner(card.owner)) return false;
	if (!Array.isArray(card.paths) || card.paths.length > MAX_PATHS) return false;
	if (!card.paths.every((path) => typeof path === "string")) return false;
	if (card.plan !== undefined && typeof card.plan !== "string") return false;
	if (card.blockedBy !== undefined && !isBlockedBy(card.blockedBy)) return false;
	if (card.landed !== undefined && !isLanded(card.landed)) return false;
	if (card.priority !== undefined && !PRIORITIES.includes(card.priority as Priority)) return false;
	if (card.dependsOn !== undefined && !isDepends(card.dependsOn)) return false;
	if (!Array.isArray(card.notes) || card.notes.length > MAX_NOTES) return false;
	if (!card.notes.every(isNote)) return false;
	if (typeof card.notesDropped !== "number") return false;
	if (typeof card.rev !== "number" || !Number.isInteger(card.rev) || card.rev < 1) return false;
	if (typeof card.createdAt !== "number" || typeof card.updatedAt !== "number") return false;
	if (typeof card.by !== "string") return false;
	return (card.status === "todo") === (card.owner === undefined);
}

/** A recorded block: one line the reader can hold, within the cap this build writes. */
function isBlockedBy(value: unknown): value is string {
	return typeof value === "string" && value !== "" && value.length <= MAX_BLOCKED;
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

function isNote(value: unknown): boolean {
	if (typeof value !== "object" || value === null) return false;
	const note = value as Record<string, unknown>;
	return typeof note.by === "string" && typeof note.at === "number" && typeof note.text === "string";
}
