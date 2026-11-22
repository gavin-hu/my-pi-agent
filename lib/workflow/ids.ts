/**
 * The card ids a board hands out, and the counter two machines agree through.
 *
 * Split out of `store.ts` when that module reached the size bar. The move is behaviour-neutral
 * and deliberately reached with `import()` from `create` rather than statically: `test/dependencies.test.ts`
 * pins the modules each entry *evaluates* and every row may only fall, so a second statically
 * imported module would fail a gate nobody can raise. `store.ts` therefore holds no static
 * import of this module, which is also why `NEXT_ID_FILE` lives here and its one reader imports
 * it from here.
 *
 * No state: every answer is read from the piles and the counter file.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FILE_MODE, ensurePrivateDir } from "../json.ts";
import { CARD_FILE, readdirSafe } from "./read.ts";

/** The counter beside the piles: the highest id any machine has issued from this board. */
export const NEXT_ID_FILE = "next-id.json";

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
 *
 * The counter beside the piles is what gives two machines the same answer: a scan sees only
 * what this host holds, so two hosts that scan the same directory both pick the id after it.
 * The counter records the highest id any of them has issued, and every reader takes the
 * **maximum** of it and the scan — which is why this needs no lock, and why a losing write of
 * a smaller value costs nothing: it cannot lower what the next reader sees. The exclusive
 * `link` in `create` stays the real guard; this only keeps the collision rare.
 */
export async function nextCardId(dir: string, cardsDir: string, endedDir: string, archiveDir: string): Promise<string> {
	const scanned = Math.max(await highestId(cardsDir), await highestId(endedDir), await highestId(archiveDir));
	const next = Math.max(scanned, await readIdCounter(dir)) + 1;
	await writeIdCounter(dir, next);
	return String(next);
}

/** The counter's value, or 0 when the file is absent, unreadable or not a counter. */
async function readIdCounter(dir: string): Promise<number> {
	const raw = await readFile(join(dir, NEXT_ID_FILE), "utf-8").catch(() => undefined);
	if (raw === undefined) return 0;
	try {
		const parsed: unknown = JSON.parse(raw);
		const value = typeof parsed === "object" && parsed !== null ? (parsed as { value?: unknown }).value : undefined;
		// A garbage counter is a fresh start rather than a failure: the scan has already answered.
		return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0;
	} catch {
		return 0;
	}
}

/** Record the highest id issued. Best-effort: a counter that cannot be written only costs the guard. */
async function writeIdCounter(dir: string, value: number): Promise<void> {
	try {
		ensurePrivateDir(dir);
		await writeFile(join(dir, NEXT_ID_FILE), `${JSON.stringify({ value }, null, "\t")}\n`, { mode: FILE_MODE });
	} catch {
		// The scan still answers on this host; the counter is advice across hosts.
	}
}
