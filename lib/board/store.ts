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
 * Nothing prunes by itself. `cards/` is the board and `archive/` is where a finished card
 * is set aside by `archive` — its file moved rather than rewritten, so the record is
 * unchanged and the board stops paying for it — and `ended/` keeps the record of a `drop`
 * alone. The page shows the store's size, and `drop` is the only deletion.
 */

import { link, mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resolveEffectiveCwd } from "../env.ts";
import { hasErrorCode, messageOf } from "../errors.ts";
import { shortenPath } from "../format.ts";
import { repoKeyFor } from "../repo-key.ts";
import {
	type Card,
	cardRef,
	type EndedCard,
	ENDED_VERSION,
	type Priority,
	priorityRank,
	SUPPORTED_VERSIONS,
} from "./card.ts";
import { LANES } from "./lanes.ts";
import { readCard } from "./read.ts";
import { indexOf } from "./links.ts";
import { DEFAULT_WIP, type WipLimits, readWip } from "./limits.ts";
import { type Actor, applyOp, type CardOp, createCard } from "./rules.ts";

/** The directory under the agent directory that holds every board. */
export const BOARD_DIR_NAME = "board";

/** The subdirectory one board's cards live in. */
export const CARDS_DIR_NAME = "cards";

/** The subdirectory a dropped card leaves its record in. */
export const ENDED_DIR_NAME = "ended";

/**
 * The subdirectory a finished card is set aside in.
 *
 * A second pile, not a second state: the file is moved here unchanged, so its notes, plan,
 * and landed commit stay readable, and the board's own reads stop opening it.
 */
export const ARCHIVE_DIR_NAME = "archive";

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
	| { ok: true; card: Card; changed: boolean; dropped: boolean; archived: boolean }
	| { ok: false; error: string; card?: Card };

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

/** One repository's board, as the runtime, the router, and the tool use it. */
export interface BoardStore {
	/** The board's own directory, for `where` and for a refusal that names it. */
	readonly dir: string;
	/**
	 * The repository key this board is filed under.
	 *
	 * Carried rather than read back off {@link dir}'s last segment: the same key is what
	 * `session-bus` files this repository's records under, so a caller that needs it must
	 * not learn it from the board's layout — otherwise regrouping the board's own files
	 * moves the roster to a directory no bus writes to, and the page reads "no record" for
	 * every peer instead of failing where someone would notice.
	 */
	readonly key: string;
	/**
	 * The WIP limits this board enforces.
	 *
	 * Read once when the store opened, and handed to every operation: the page shows the
	 * same numbers a refusal would, so a head cannot claim room a claim would refuse.
	 */
	limits(): WipLimits;
	/** Create the directories and sweep a temp file a dead process left. */
	ensure(): Promise<void>;
	/** Every card on the board, in lane order: backlog, plan, execute, blocked, done. */
	list(): Promise<Card[]>;
	/**
	 * The board in one read: the cards, and the files it refused.
	 *
	 * A page's snapshot needs both, and asking twice reads and parses every card twice to
	 * answer one frame; `list` and `skipped` are the two halves of this for a caller that
	 * wants only one.
	 */
	scan(): Promise<{ cards: Card[]; skipped: Skip[] }>;
	/**
	 * The cards set aside in the archive, in the same order, and the files there this build
	 * refused. Read only when a caller asks: no other read opens the pile.
	 */
	archived(): Promise<{ cards: Card[]; skipped: Skip[] }>;
	/** How many card files the archive holds, without opening one: the count a listing prints. */
	archivedCount(): Promise<number>;
	/** One card by its unpadded id, from whichever pile its file lies in. */
	read(id: string): Promise<Card | undefined>;
	/** Add a card, allocating the next id. */
	create(input: CreateInput, actor: Actor, now: number): Promise<Card>;
	/**
	 * Apply one operation, re-checking it if the card changed while it was read. A card is
	 * found in whichever pile it lies in, and written back to that one.
	 */
	mutate(id: string, op: CardOp, actor: Actor, now: number): Promise<MutateResult>;
	/** Bytes the board's cards occupy on disk; the archive is not counted. */
	bytes(): Promise<number>;
	/** Card files this build refused to read, and why. */
	skipped(): Promise<Skip[]>;
	/** A short, user-facing name for the directory. */
	where(): string;
	/**
	 * The repository root this board belongs to, and the directory itself outside one.
	 *
	 * A board is keyed by a hash, so this is the one part of its identity a reader can
	 * say out loud: the page names the repository from it, and offers the whole path on
	 * hover, which is what tells two clones of one repository apart.
	 */
	root(): string;
	/** The root's last segment — `my-pi-agent` — which is all a tab has room for. */
	name(): string;
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
	// Read once per store: the limits are a setting, not a card, and a board that re-read
	// a file on every write would spend a stat to answer a question nobody changed.
	const limits = readWip(resolveEffectiveCwd(cwd), { agentDir });
	// The key is handed on, not left to be read off the directory it named: `session-bus`
	// files this repository's records under the same key, so the two must not be able to
	// disagree about it.
	return createStore(boardDirFor(agentDir, repo.key), { root: repo.root, key: repo.key, limits });
}

/** Build a store over one directory. Exported for tests and for a second backend. */
export function createStore(
	dir: string,
	options: { root?: string; key?: string; limits?: WipLimits } = {},
): BoardStore {
	// A store built over a directory by hand has no repository to ask, so it is keyed by
	// that directory's own name: the one place this fallback lives, and the one reason it
	// is not a proof about `openBoard`'s boards.
	const key = options.key ?? basename(dir);
	// A store built over a directory by hand has no repository to name, so it names its
	// own directory: the page then says something true instead of something blank.
	const root = options.root ?? dir;
	const limits = options.limits ?? DEFAULT_WIP;
	const cardsDir = join(dir, CARDS_DIR_NAME);
	const endedDir = join(dir, ENDED_DIR_NAME);
	const archiveDir = join(dir, ARCHIVE_DIR_NAME);

	const ensure = async (): Promise<void> => {
		await mkdir(cardsDir, { recursive: true, mode: DIR_MODE });
		await sweepTemps(cardsDir);
		// An archived card that was edited leaves a temp file in its own pile, and a process
		// that died mid-write there is the same mess as one on the board.
		await sweepTemps(archiveDir);
	};

	/** Every card file of one pile, read once: what it shows and what it refused. */
	const scanPile = async (pileDir: string): Promise<{ cards: Card[]; skipped: Skip[] }> => {
		const entries = await readdirSafe(pileDir);
		const cards: Card[] = [];
		const skipped: Skip[] = [];
		for (const entry of entries) {
			const read = await readCardFile(pileDir, entry);
			if ("card" in read) cards.push(read.card);
			// Anything that is not a card-named file is not the board's to explain.
			else if (entry.endsWith(".json")) skipped.push(read.skip);
		}
		// Sorted by file name so two reads of one board say the same thing in the same order.
		return { cards: sortForLane(cards), skipped: skipped.sort((a, b) => a.file.localeCompare(b.file)) };
	};

	const scan = (): Promise<{ cards: Card[]; skipped: Skip[] }> => scanPile(cardsDir);

	const list = async (): Promise<Card[]> => (await scan()).cards;

	const archived = async (): Promise<{ cards: Card[]; skipped: Skip[] }> => scanPile(archiveDir);

	// A directory listing and a name pattern, with no file opened: a plain `list` prints this
	// count so the archive it left out cannot read as history that was deleted.
	const archivedCount = async (): Promise<number> =>
		(await readdirSafe(archiveDir)).filter((entry) => CARD_FILE.test(entry)).length;

	const skipped = async (): Promise<Skip[]> => (await scan()).skipped;

	/**
	 * One card and the pile its file is in, the board first.
	 *
	 * A card is where it lies: the archive is not a state a record carries, so every read by
	 * id has to look in both places, and every write goes back to the one it was read from.
	 */
	const locate = async (id: string): Promise<{ card: Card; pile: string } | undefined> => {
		for (const pile of [cardsDir, archiveDir]) {
			const result = await readCardFile(pile, fileNameFor(id));
			if ("card" in result) return { card: result.card, pile };
		}
		return undefined;
	};

	const read = async (id: string): Promise<Card | undefined> => (await locate(id))?.card;

	const create = async (input: CreateInput, actor: Actor, now: number): Promise<Card> => {
		await ensure();
		let lastError: unknown;
		for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
			const id = await nextCardId(cardsDir, endedDir, archiveDir);
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
				if (!hasErrorCode(error, "EEXIST")) throw error;
			} finally {
				await rm(temp, { force: true });
			}
		}
		throw new Error(`The board could not allocate a card id (${messageOf(lastError)}).`);
	};

	const mutate = async (id: string, op: CardOp, actor: Actor, now: number): Promise<MutateResult> => {
		let changedUnderneath = false;
		for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
			const found = await locate(id);
			if (!found) {
				if (changedUnderneath) return { ok: false, error: `${cardRef(id)} was dropped.` };
				// A file that is there and refused is not a card that does not exist: the
				// reader is told which file to look at instead of being sent to add one.
				const skip = (await scan()).skipped.find((entry) => entry.id === id);
				return {
					ok: false,
					error:
						skip === undefined
							? `${cardRef(id)} does not exist.`
							: `${cardRef(id)} is there and this build cannot read it (${skip.file}: ${skip.why}).`,
				};
			}
			const { card, pile } = found;
			// The preconditions are checked against the card as it is *now*, and against the
			// board as it is now, so an operation re-applied to a card that changed is refused
			// rather than forced.
			const result = applyOp(card, op, actor, now, indexOf(await list()), limits);
			if (!result.ok) return { ok: false, error: result.error, card };
			if (!result.changed) {
				return { ok: true, card: result.card, changed: false, dropped: false, archived: false };
			}
			if (op.kind === "drop") {
				// The record lands first: a crash between the two leaves a card that still
				// exists with a note explaining it, never a card that is gone unexplained.
				await writeEnded(endedDir, result.card, actor, now);
				await rm(join(pile, fileNameFor(id)), { force: true });
				return { ok: true, card: result.card, changed: true, dropped: true, archived: false };
			}
			if (op.kind === "archive") {
				// A card the board does not hold is already aside, and two sessions asking at
				// once are one move rather than a second one.
				if (pile === archiveDir) {
					return { ok: true, card: result.card, changed: false, dropped: false, archived: false };
				}
				await moveCard(cardsDir, archiveDir, id);
				return { ok: true, card: result.card, changed: true, dropped: false, archived: true };
			}
			// Last look before the rename: a writer that landed in between is the
			// re-read the next pass applies against.
			const current = await read(id);
			if (!current || current.rev !== card.rev) {
				changedUnderneath = true;
				continue;
			}
			await writeCardFile(pile, id, result.card);
			return { ok: true, card: result.card, changed: true, dropped: false, archived: false };
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

	return {
		dir,
		key,
		limits: () => limits,
		ensure,
		list,
		scan,
		archived,
		archivedCount,
		read,
		create,
		mutate,
		bytes,
		skipped,
		where: () => shortenPath(dir),
		root: () => root,
		name: () => basename(root),
	};
}

/** `<id>.json`, zero-padded to four digits so a directory lists in card order. */
function fileNameFor(id: string): string {
	return `${id.padStart(4, "0")}.json`;
}

/** The card files the reader accepts. */
const CARD_FILE = /^(\d{4,})\.json$/;

/** One card file: the card, or the reason this build refused it. */
async function readCardFile(pileDir: string, entry: string): Promise<{ card: Card } | { skip: Skip }> {
	const match = CARD_FILE.exec(entry);
	if (!match) return { skip: { file: entry, why: "not a card id" } };
	const id = String(Number(match[1]));
	const text = await readFile(join(pileDir, entry), "utf-8").catch(() => undefined);
	if (text === undefined) return { skip: { file: entry, id, why: "cannot be read" } };
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return { skip: { file: entry, id, why: "bad JSON" } };
	}
	// A version this build does not read is the one refusal a reader can act on: the file was
	// written by a newer build, so the board is not empty, it is not readable here. Every
	// version `readCard` can map is read; the number is named rather than guessed at.
	const version = typeof parsed === "object" && parsed !== null ? (parsed as { v?: unknown }).v : undefined;
	if (typeof version === "number" && !SUPPORTED_VERSIONS.some((known) => known === version)) {
		return { skip: { file: entry, id, why: `version ${version}` } };
	}
	// The one gate a file read passes: an older spelling of the lane field is read as
	// this build's, and everything else is a shape this build does not trust.
	const card = readCard(parsed);
	if (card === undefined) return { skip: { file: entry, id, why: "not a card record" } };
	// The file name is the id's canonical spelling: a padded id inside the record
	// (or a record moved under another name) is a disagreement, not a card.
	if (card.id !== String(Number(match[1]))) {
		return { skip: { file: entry, id, why: `names card ${card.id}` } };
	}
	return { card };
}

/** The highest id a directory holds, or 0 when it holds none. */
async function highestId(dir: string): Promise<number> {
	const entries = await readdirSafe(dir);
	let highest = 0;
	for (const entry of entries) {
		const match = CARD_FILE.exec(entry);
		if (match) highest = Math.max(highest, Number(match[1]));
	}
	return highest;
}

/**
 * `1`, `2`, `3` … as the highest id the board has ever used plus one.
 *
 * Ended and archived cards count: a dropped card's record keeps its id spent, and an
 * archived card's file is still named by it, so a note or a handoff that names `#29`
 * cannot come to mean a different feature tomorrow.
 */
async function nextCardId(cardsDir: string, endedDir: string, archiveDir: string): Promise<string> {
	return String(Math.max(await highestId(cardsDir), await highestId(endedDir), await highestId(archiveDir)) + 1);
}

/**
 * Write the record of a card that has ended.
 *
 * Exclusive like a create, so the id ends once: a retry that finds the record already
 * there is the same end, not a second one.
 */
async function writeEnded(endedDir: string, card: Card, actor: Actor, now: number): Promise<void> {
	await mkdir(endedDir, { recursive: true, mode: DIR_MODE });
	const ended: EndedCard = {
		v: ENDED_VERSION,
		id: card.id,
		title: card.title,
		lane: card.lane,
		by: actor.label,
		...(card.owner === undefined ? {} : { owner: card.owner }),
		at: now,
		why: "dropped",
	};
	const temp = tempPath(endedDir);
	await writeFile(temp, serialize(ended), { mode: FILE_MODE });
	try {
		await link(temp, join(endedDir, fileNameFor(card.id)));
	} catch (error) {
		if (!hasErrorCode(error, "EEXIST")) throw error;
	} finally {
		await rm(temp, { force: true });
	}
}

/**
 * Move one card's file into the archive.
 *
 * A rename, not a write: the record does not change, and the pile it lies in is the whole
 * of what an archive means.
 */
async function moveCard(from: string, to: string, id: string): Promise<void> {
	await mkdir(to, { recursive: true, mode: DIR_MODE });
	await renameInto(join(from, fileNameFor(id)), join(to, fileNameFor(id)));
}

/**
 * Rename one file over or onto another, with the fallback this platform needs.
 *
 * Windows refuses a rename onto an open file, so removing the target first is the only
 * way through there; every caller has already read what it is replacing, which is what
 * bounds what the removal can lose.
 */
async function renameInto(source: string, target: string): Promise<void> {
	try {
		await rename(source, target);
	} catch (error) {
		if (!hasErrorCode(error, "EPERM") && !hasErrorCode(error, "EACCES") && !hasErrorCode(error, "EEXIST")) throw error;
		await rm(target, { force: true });
		await rename(source, target);
	}
}

/** Write one card: a temp file in the same directory, then a rename over the old one. */
async function writeCardFile(dir: string, id: string, card: Card): Promise<void> {
	const temp = tempPath(dir);
	await writeFile(temp, serialize(card), { mode: FILE_MODE });
	try {
		await renameInto(temp, join(dir, fileNameFor(id)));
	} catch (error) {
		await rm(temp, { force: true });
		throw error;
	}
}

/** One card's bytes, ending in a newline so the file reads well in an editor. */
/** One record as the bytes a file holds: tab-indented JSON with a closing newline. */
function serialize(record: Card | EndedCard): string {
	return `${JSON.stringify(record, null, "\t")}\n`;
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
		if (hasErrorCode(error, "ENOENT")) return [];
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
	const lane = (card: Card): number => LANES.indexOf(card.lane);
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
