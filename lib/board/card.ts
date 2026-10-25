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
 * Whether `query` names `card`: its title, one of its path hints, or its holder.
 *
 * The page's filter and `board list`'s `query` are the same question, so they are the
 * same rule here — a reader who finds a card in the browser finds it in the tool.
 */
export function matchesQuery(card: Card, query: string): boolean {
	const needle = query.trim().toLowerCase();
	if (needle === "") return true;
	if (card.title.toLowerCase().includes(needle)) return true;
	if (card.owner !== undefined && card.owner.label.toLowerCase().includes(needle)) return true;
	return card.paths.some((path) => path.toLowerCase().includes(needle));
}

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
