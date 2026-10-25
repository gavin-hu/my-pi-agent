/**
 * The board store: one directory of card files per repository, and the only code
 * that writes one.
 *
 * A board is a directory — `<agentDir>/board/<repo-key>/cards/0004.json` — so a
 * reader needs no index, no daemon, and no dependency; the listing *is* the
 * index. The key comes from `lib/repo-key.ts`, so every worktree of one repository
 * shares one board, and a directory outside git keys on itself.
 *
 * Two writes race safely without a lock. **Create** hard-links a temporary file
 * onto the target name, which fails when the name is taken, so two adds cannot
 * share an id and the loser simply retries with the next one. **Update** re-reads,
 * re-checks the operation's preconditions, and renames over the old file, so a
 * card that changed underneath is re-evaluated rather than overwritten: an
 * operation says "apply when this holds", never "force this state".
 *
 * A write reads the whole board once, because `rules.ts` needs another card to answer
 * three of its questions: is this dependency finished, would this link close a loop,
 * and does anything wait on the card being dropped. The listing is the index here —
 * a board is tens of files, so the read is cheaper than the second source of truth a
 * cached index would be.
 *
 * Nothing prunes. A `done` card is history, the page shows the store's size, and
 * `drop` is the only deletion.
 */

import { link, mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resolveEffectiveCwd } from "../env.ts";
import { messageOf } from "../errors.ts";
import { shortenPath } from "../format.ts";
import { repoKeyFor } from "../repo-key.ts";
import { type Card, CARD_STATUSES, cardRef, isCard, type Priority, priorityRank } from "./card.ts";
import { indexOf } from "./links.ts";
import { type Actor, applyOp, type CardOp, createCard } from "./rules.ts";

/** The directory under the agent directory that holds every board. */
export const BOARD_DIR_NAME = "board";

/** The subdirectory one board's cards live in. */
export const CARDS_DIR_NAME = "cards";

/** Card files are the user's work; only their owner reads them. */
const FILE_MODE = 0o600;

/** A board directory is one session's private state. */
const DIR_MODE = 0o700;

/** An in-flight temp file older than this was left by a process that died. */
const TEMP_STALE_MS = 60 * 60 * 1_000;

/** How many times an id collision or a changed card is retried before giving up. */
const ATTEMPTS = 4;

/** A card to add. The fields are already normalized by `card.ts`. */
export interface CreateInput {
	title: string;
	paths: string[];
	note?: string;
	/** Absent is `normal`, so an add that says nothing about urgency says the ordinary thing. */
	priority?: Priority;
}

/** What a mutation did, or why it was refused. */
export type MutateResult =
	| { ok: true; card: Card; changed: boolean; dropped: boolean }
	| { ok: false; error: string; card?: Card };

/** One repository's board, as the runtime, the router, and the tool use it. */
export interface BoardStore {
	/** The board's own directory, for `where` and for a refusal that names it. */
	readonly dir: string;
	/** Create the directories and sweep a temp file a dead process left. */
	ensure(): Promise<void>;
	/** Every card, in lane order: todo, doing, blocked, done. */
	list(): Promise<Card[]>;
	/** One card by its unpadded id, or undefined when it is not there. */
	read(id: string): Promise<Card | undefined>;
	/** Add a card, allocating the next id. */
	create(input: CreateInput, actor: Actor, now: number): Promise<Card>;
	/** Apply one operation, re-checking it if the card changed while it was read. */
	mutate(id: string, op: CardOp, actor: Actor, now: number): Promise<MutateResult>;
	/** Bytes the store occupies on disk. */
	bytes(): Promise<number>;
	/** A short, user-facing name for the directory. */
	where(): string;
}

/** Where one repository's board lives. */
export function boardDirFor(agentDir: string, key: string): string {
	return join(agentDir, BOARD_DIR_NAME, key);
}

/** The board for `cwd`'s repository. The one construction point. */
export async function openBoard(
	pi: Pick<ExtensionAPI, "exec">,
	cwd: string,
	options: { agentDir?: string } = {},
): Promise<BoardStore> {
	const agentDir = options.agentDir ?? getAgentDir();
	// A tool receives the session's cwd, not the worktree the user entered; the
	// environment carries the active root, so the two are reconciled before the
	// repository lookup — the same path `plan` and `session-bus` take.
	const repo = await repoKeyFor(pi, resolveEffectiveCwd(cwd));
	return createStore(boardDirFor(agentDir, repo.key));
}

/** Build a store over one directory. Exported for tests and for a second backend. */
export function createStore(dir: string): BoardStore {
	const cardsDir = join(dir, CARDS_DIR_NAME);

	const ensure = async (): Promise<void> => {
		await mkdir(cardsDir, { recursive: true, mode: DIR_MODE });
		await sweepTemps(cardsDir);
	};

	const list = async (): Promise<Card[]> => {
		const entries = await readdirSafe(cardsDir);
		const cards: Card[] = [];
		for (const entry of entries) {
			const card = await readCardFile(cardsDir, entry);
			if (card) cards.push(card);
		}
		return sortForLane(cards);
	};

	const read = async (id: string): Promise<Card | undefined> => {
		return readCardFile(cardsDir, fileNameFor(id));
	};

	const create = async (input: CreateInput, actor: Actor, now: number): Promise<Card> => {
		await ensure();
		let lastError: unknown;
		for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
			const id = await nextCardId(cardsDir);
			const card = createCard(id, input, actor, now);
			const temp = tempPath(cardsDir);
			await writeFile(temp, serialize(card), { mode: FILE_MODE });
			try {
				// The exclusive create: two adds cannot produce one card, and the
				// loser retries with the id it just learned was taken.
				await link(temp, join(cardsDir, fileNameFor(id)));
				return card;
			} catch (error) {
				lastError = error;
				if (!isCode(error, "EEXIST")) throw error;
			} finally {
				await rm(temp, { force: true });
			}
		}
		throw new Error(`The board could not allocate a card id (${messageOf(lastError)}).`);
	};

	const mutate = async (id: string, op: CardOp, actor: Actor, now: number): Promise<MutateResult> => {
		let changedUnderneath = false;
		for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
			const card = await read(id);
			if (!card) {
				return {
					ok: false,
					error: changedUnderneath ? `${cardRef(id)} was dropped.` : `${cardRef(id)} does not exist.`,
				};
			}
			// The preconditions are checked against the card as it is *now*, and against the
			// board as it is now, so an operation re-applied to a card that changed is refused
			// rather than forced.
			const result = applyOp(card, op, actor, now, indexOf(await list()));
			if (!result.ok) return { ok: false, error: result.error, card };
			if (!result.changed) return { ok: true, card: result.card, changed: false, dropped: false };
			if (op.kind === "drop") {
				await rm(join(cardsDir, fileNameFor(id)), { force: true });
				return { ok: true, card: result.card, changed: true, dropped: true };
			}
			// Last look before the rename: a writer that landed in between is the
			// re-read the next pass applies against.
			const current = await read(id);
			if (!current || current.rev !== card.rev) {
				changedUnderneath = true;
				continue;
			}
			await writeCardFile(cardsDir, id, result.card);
			return { ok: true, card: result.card, changed: true, dropped: false };
		}
		return {
			ok: false,
			error: `${cardRef(id)} kept changing while it was written; read it again.`,
			card: await read(id),
		};
	};

	const bytes = async (): Promise<number> => {
		const entries = await readdirSafe(cardsDir);
		let total = 0;
		for (const entry of entries) {
			if (!CARD_FILE.test(entry)) continue;
			const info = await stat(join(cardsDir, entry)).catch(() => undefined);
			if (info) total += info.size;
		}
		return total;
	};

	return { dir, ensure, list, read, create, mutate, bytes, where: () => shortenPath(dir) };
}

/** `<id>.json`, zero-padded to four digits so a directory lists in card order. */
function fileNameFor(id: string): string {
	return `${id.padStart(4, "0")}.json`;
}

/** The card files the reader accepts. */
const CARD_FILE = /^(\d{4,})\.json$/;

/** One card file, or undefined when it is not a card this build trusts. */
async function readCardFile(cardsDir: string, entry: string): Promise<Card | undefined> {
	const match = CARD_FILE.exec(entry);
	if (!match) return undefined;
	const text = await readFile(join(cardsDir, entry), "utf-8").catch(() => undefined);
	if (text === undefined) return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return undefined;
	}
	if (!isCard(parsed)) return undefined;
	// The file name is the id's canonical spelling: a padded id inside the record
	// (or a record moved under another name) is a disagreement, not a card.
	if (parsed.id !== String(Number(match[1]))) return undefined;
	return parsed;
}

/** `1`, `2`, `3` … as the highest existing id plus one. */
async function nextCardId(cardsDir: string): Promise<string> {
	const entries = await readdirSafe(cardsDir);
	let highest = 0;
	for (const entry of entries) {
		const match = CARD_FILE.exec(entry);
		if (match) highest = Math.max(highest, Number(match[1]));
	}
	return String(highest + 1);
}

/** Write one card: a temp file in the same directory, then a rename over the old one. */
async function writeCardFile(cardsDir: string, id: string, card: Card): Promise<void> {
	const temp = tempPath(cardsDir);
	await writeFile(temp, serialize(card), { mode: FILE_MODE });
	const target = join(cardsDir, fileNameFor(id));
	try {
		await rename(temp, target);
	} catch (error) {
		// Windows refuses a rename onto an open file; removing first is the fallback
		// the platform needs, and the read above still bounds what can be lost.
		if (!isCode(error, "EPERM") && !isCode(error, "EACCES") && !isCode(error, "EEXIST")) {
			await rm(temp, { force: true });
			throw error;
		}
		await rm(target, { force: true });
		await rename(temp, target);
	}
}

/** One card's bytes, ending in a newline so the file reads well in an editor. */
function serialize(card: Card): string {
	return `${JSON.stringify(card, null, "\t")}\n`;
}

/** A temp path in the cards directory: never matched by the reader's own pattern. */
function tempPath(cardsDir: string): string {
	return join(cardsDir, `.tmp-${process.pid}-${Math.random().toString(16).slice(2, 10)}`);
}

/** Remove a temp file a process that died mid-write left behind. */
async function sweepTemps(cardsDir: string): Promise<void> {
	const entries = await readdirSafe(cardsDir);
	const cutoff = Date.now() - TEMP_STALE_MS;
	for (const entry of entries) {
		if (!entry.startsWith(".tmp-")) continue;
		const path = join(cardsDir, entry);
		const info = await stat(path).catch(() => undefined);
		if (info && info.mtimeMs < cutoff) await unlink(path).catch(() => undefined);
	}
}

async function readdirSafe(dir: string): Promise<string[]> {
	return readdir(dir).catch((error: unknown) => {
		if (isCode(error, "ENOENT")) return [];
		throw error;
	});
}

/**
 * Lane order, then the lead's order inside it, then oldest first, with the id as the
 * tie-break.
 *
 * Priority sorts inside a lane rather than beside it: a `high` card in Done is still
 * history, and a lane that mixed the two would have to say so in its head.
 */
function sortForLane(cards: Card[]): Card[] {
	const lane = (card: Card): number => CARD_STATUSES.indexOf(card.status);
	return cards.sort((a, b) => {
		const byLane = lane(a) - lane(b);
		if (byLane !== 0) return byLane;
		const byPriority = priorityRank(a) - priorityRank(b);
		if (byPriority !== 0) return byPriority;
		const byAge = a.updatedAt - b.updatedAt;
		if (byAge !== 0) return byAge;
		return Number(a.id) - Number(b.id);
	});
}

function isCode(error: unknown, code: string): boolean {
	return typeof error === "object" && error !== null && (error as { code?: unknown }).code === code;
}
