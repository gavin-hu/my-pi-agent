/**
 * The board store: one directory of card files per repository, and the only code
 * that writes one.
 *
 * A board is a directory — `<agent-dir>/board/<repo-key>/cards/0004.json` — so a
 * reader needs no index, no daemon, and no dependency; the listing *is* the
 * index. The key comes from `lib/repo-key.ts`, so every worktree of one repository
 * shares one board, and a directory outside git keys on itself.
 *
 * **Create** needs no lock: it hard-links a temporary file onto the target name,
 * which fails when the name is taken, so two adds cannot share an id and the loser
 * simply retries with the next one. **Update** takes the board's write lock
 * (`lock.ts`), re-reads the card *and* the board, re-checks the preconditions, and
 * renames over the old file — the board's lock because three of the questions asked
 * are about other cards, and a per-card one let two writers answer them from two
 * snapshots. An operation says "apply when this holds", never "force this state".
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

import { link, mkdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resolveEffectiveCwd } from "../env.ts";
import { hasErrorCode, messageOf } from "../errors.ts";
import { shortenPath } from "../format.ts";
import { repoKeyFor } from "../repo-key.ts";
import { type Card, cardRef, type EndedCard, ENDED_VERSION, type Priority } from "./card.ts";
import type { CardType } from "./kind.ts";
import { CARD_FILE, readCardFile, readdirSafe, type Skip, scanPile } from "./read.ts";
import { indexOf } from "./links.ts";
import { lockBoard } from "./lock.ts";
import { type BoardConfig, DEFAULT_BOARD_CONFIG, readBoardConfig } from "./config.ts";
import { type Actor, applyOp, type CardOp, createCard } from "./rules.ts";

/** The directory under the agent directory that holds every board. */
export const BOARD_DIR_NAME = "board";

/** The subdirectory one board's cards live in. */
export const CARDS_DIR_NAME = "cards";

/** The subdirectory a dropped card leaves its record in. */
const ENDED_DIR_NAME = "ended";

/**
 * The subdirectory a finished card is set aside in.
 *
 * A second pile, not a second state: the file is moved here unchanged, so its notes and plan
 * stay readable, and the board's own reads stop opening it.
 */
const ARCHIVE_DIR_NAME = "archive";

/** Card files are the user's work; only their owner reads them. */
const FILE_MODE = 0o600;

/** A board directory is one session's private state. */
const DIR_MODE = 0o700;

/** An in-flight temp file older than this was left by a process that died. */
const TEMP_STALE_MS = 60 * 60 * 1_000;

/** How many times an id collision or a changed card is retried before giving up. */
const ATTEMPTS = 4;

/** A card to add. The fields are already normalized by `card.ts` and `kind.ts`. */
export interface CreateInput {
	title: string;
	paths: string[];
	note?: string;
	/** Absent is `normal`, so an add that says nothing about urgency says the ordinary thing. */
	priority?: Priority;
	/** Absent draws nothing: a card nobody classified is one, not a guess at `feature`. */
	type?: CardType;
	/** Absent is false; only a true marker is written, because most cards break nobody. */
	breaking?: boolean;
}

/** What a mutation did, or why it was refused; `previous` is the card this write read. */
export type MutateResult =
	| { ok: true; card: Card; changed: boolean; dropped: boolean; archived: boolean; announce?: true; previous?: Card }
	| { ok: false; error: string; card?: Card };

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
	 * The settings this board works by: its WIP limits and the name its two signatures carry.
	 *
	 * Read once when the store opened, and handed to every operation: the page shows the same
	 * numbers a refusal would, so a head cannot claim room a claim would refuse.
	 */
	config(): BoardConfig;
	/** Create the directories and sweep a temp file a dead process left. */
	ensure(): Promise<void>;
	/** Every card on the board, in lane order: backlog, plan, execute, blocked, done. */
	list(): Promise<Card[]>;
	/**
	 * The board in one read: the cards, the files it refused, and the bytes they occupy.
	 *
	 * A page's snapshot needs all three, and asking twice reads and parses every card twice to
	 * answer one frame; `list` and `skipped` are the two halves of this for a caller that
	 * wants only one.
	 */
	scan(): Promise<{ cards: Card[]; skipped: Skip[]; bytes: number }>;
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
	// Read once per store: the settings are a setting, not a card, and a board that re-read
	// a file on every write would spend a stat to answer a question nobody changed.
	const config = readBoardConfig(resolveEffectiveCwd(cwd), { agentDir });
	// The key is handed on, not left to be read off the directory it named: `session-bus`
	// files this repository's records under the same key, so the two must not be able to
	// disagree about it.
	return createStore(boardDirFor(agentDir, repo.key), { root: repo.root, key: repo.key, config });
}

/** Build a store over one directory. Exported for tests and for a second backend. */
export function createStore(
	dir: string,
	options: {
		root?: string;
		key?: string;
		config?: BoardConfig;
		/**
		 * A suite's seam: called when a pass starts, before the board's lock is taken.
		 *
		 * The pass reads, checks, and writes under the lock, so the only place another write can
		 * land is before it: a test stands here and lets that write happen, and the pass then reads
		 * what it left instead of overwriting it. Before the lock, not inside it, because a call
		 * from here would otherwise wait out the lock it stands on — which is how a nested
		 * mutation stays possible. The product supplies nothing.
		 */
		beforeWrite?: (id: string, kind: CardOp["kind"]) => Promise<void> | void;
	} = {},
): BoardStore {
	// A store built over a directory by hand has no repository to ask, so it is keyed by
	// that directory's own name: the one place this fallback lives, and the one reason it
	// is not a proof about `openBoard`'s boards.
	const key = options.key ?? basename(dir);
	// A store built over a directory by hand has no repository to name, so it names its
	// own directory: the page then says something true instead of something blank.
	const root = options.root ?? dir;
	const config = options.config ?? DEFAULT_BOARD_CONFIG;
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

	/**
	 * Every card file of one pile, read once: what it shows, what it refused, and what it costs.
	 *
	 * The size comes off the read rather than a second pass, because the bytes are already in
	 * hand: a frame that walked the directory again would stat every file it just opened.
	 */
	const scan = (): Promise<{ cards: Card[]; skipped: Skip[]; bytes: number }> => scanPile(cardsDir);

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
			// The seam stands before the lock, so a suite can land a second write in the one window
			// this pass cannot hold: the board is read, checked, and written under one lock, so a peer
			// is either inside that window or waiting for it. The lock is one name per board, so a
			// peer writing a different card is inside the same window — the limit it is counted
			// against and the link it would close are the board's facts, not the card's. A lock a
			// live writer held throughout the wait is one more pass.
			await options.beforeWrite?.(id, op.kind);
			const lock = await lockBoard(dir);
			if (lock === undefined) {
				changedUnderneath = true;
				continue;
			}
			try {
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
				// The preconditions are checked against the card as it is *now*, and against the board
				// as it is now, under the one lock that keeps both still, so an operation is refused
				// rather than forced. The pile is handed on too: only the store can say which one it read.
				const place = pile === archiveDir ? "archive" : "board";
				const result = applyOp(card, op, actor, now, indexOf(await list()), config, place);
				if (!result.ok) return { ok: false, error: result.error, card };
				// `...result` and not its fields: a repeat sign writes nothing and still owes its message,
				// which is the one fact `changed` cannot carry.
				if (!result.changed) return { ...result, dropped: false, archived: false };
				if (op.kind === "drop") {
					// The record lands first: a crash between the two leaves a card that still
					// exists with a note explaining it, never a card that is gone unexplained.
					await writeEnded(endedDir, result.card, actor, now);
					await rm(join(pile, fileNameFor(id)), { force: true });
					return { ok: true, card: result.card, changed: true, dropped: true, archived: false, previous: card };
				}
				if (op.kind === "archive") {
					// A card the board does not hold is already aside, and two sessions asking at
					// once are one move rather than a second one.
					if (pile === archiveDir) {
						return { ok: true, card: result.card, changed: false, dropped: false, archived: false };
					}
					await moveCard(cardsDir, archiveDir, id);
					return { ok: true, card: result.card, changed: true, dropped: false, archived: true, previous: card };
				}
				// Written back to the board and nowhere else: an archived record refuses every write.
				await writeCardFile(cardsDir, id, result.card);
				return { ...result, dropped: false, archived: false, previous: card };
			} finally {
				await lock.release();
			}
		}
		return {
			ok: false,
			error: `${cardRef(id)} was being written by another session; read it again.`,
			card: await read(id),
		};
	};

	return {
		dir,
		key,
		config: () => config,
		ensure,
		list,
		scan,
		archived,
		archivedCount,
		read,
		create,
		mutate,
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
