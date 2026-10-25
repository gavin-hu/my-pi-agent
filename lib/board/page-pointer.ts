/**
 * The page pointer: how a second session finds the page a repository already serves.
 *
 * A page is one loopback server owned by one session's process, so nothing about it is
 * discoverable without a note left where the repository's state already lives. That note
 * is `<board>/page.json`: the port, the seat serving it, and a *view* token — never the
 * write token, which stays in the URL the lead's own browser was opened at.
 *
 * Two rules make the file safe to trust:
 *
 * - **Created exclusively**, by hard-linking a temp file onto the name, so two sessions
 *   starting at the same instant cannot both believe they are the page: the loser reads
 *   the winner's pointer and attaches.
 * - **Believed only while it answers.** A crash leaves the file behind, and the file says
 *   nothing about whether the process is alive, so a caller probes the page before it
 *   attaches or takes the seat over. `probePage` is that question, with the network as a
 *   seam so a test drives it.
 *
 * Pure I/O, no state: one call answers one caller, and the caller owns the path it hands in.
 */

import { access, link, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { hasErrorCode } from "../errors.ts";

/** The file, beside the board's `cards/` directory. */
export const PAGE_FILE = "page.json";

/** How long a probe waits before it calls the page gone. */
export const PROBE_MS = 600;

/** The port, the seat, and the credential a viewer may hold. */
export interface PagePointer {
	port: number;
	/** A token that satisfies every read and no write. */
	viewToken: string;
	/** The seat the page writes as. */
	seat: { id?: string; label: string };
	/** When the page started, so a reader can tell a fresh note from a stale one. */
	startedAt: number;
}

/** The fetch a probe uses: the global one in production, a stub in a test. */
export type ProbeFetch = (url: string, init: { signal: AbortSignal }) => Promise<{ ok: boolean }>;

/** The URL a viewer opens: the page, with the credential that may only read it. */
export function viewUrlOf(pointer: PagePointer): string {
	return `http://127.0.0.1:${pointer.port}/?token=${pointer.viewToken}`;
}

/**
 * Whether a note is there at all, readable or not.
 *
 * `readPointer` answers nothing for two very different states — no page has ever written a
 * note here, and a note this build cannot read — and a caller that has just failed to
 * create one has to tell them apart: the first is a race with a page that cleared its note
 * and is worth another attempt, the second is a file only its owner can explain.
 */
export async function noteExists(dir: string): Promise<boolean> {
	try {
		await access(join(dir, PAGE_FILE));
		return true;
	} catch {
		return false;
	}
}

/** The pointer written for one board directory, or nothing when there is none to trust. */
export async function readPointer(dir: string): Promise<PagePointer | undefined> {
	return readPointerAt(join(dir, PAGE_FILE));
}

/** The pointer a file holds, by path: the same read, for a note that has been moved aside. */
async function readPointerAt(path: string): Promise<PagePointer | undefined> {
	let text: string;
	try {
		text = await readFile(path, "utf-8");
	} catch {
		return undefined;
	}
	try {
		return asPointer(JSON.parse(text));
	} catch {
		return undefined;
	}
}

/**
 * Write a pointer for a page this caller has just started.
 *
 * Returns whether it became the file: `false` means another session got there first, and
 * the caller should read that one and attach rather than serve a second page.
 */
export async function createPointer(dir: string, pointer: PagePointer): Promise<boolean> {
	const target = join(dir, PAGE_FILE);
	const temp = `${target}.tmp-${process.pid}-${Math.random().toString(16).slice(2, 10)}`;
	try {
		await writeFile(temp, `${JSON.stringify(pointer, null, "\t")}\n`, { mode: 0o600 });
		try {
			await link(temp, target);
			return true;
		} catch (error) {
			// The name is taken: another session is serving this repository, and this one
			// becomes a viewer of it. Any other failure is the caller's to hear about.
			if (hasErrorCode(error, "EEXIST")) return false;
			throw error;
		}
	} finally {
		await rm(temp, { force: true });
	}
}

/**
 * Remove the pointer for a page that has stopped.
 *
 * Only a caller that has proved the note is not a live page may clear it: the page that
 * wrote it, on its own way out, or a session that just found it answering nobody. The
 * token is what decides — a restart of the same seat has the same seat and a new token,
 * so a note that no longer names a live page never takes the live one's place away.
 * Returns whether the file was the one named.
 *
 * The note is moved aside before it is removed, and the token is checked again on what was
 * moved. A read followed by an unlink is two instants, and a session that judged the old
 * note dead acts on the first one: if it removed the name, it could delete the note a
 * faster session had written in between, and both would serve a page, only one of them
 * findable. The move is atomic, so the file this call holds is the file that was there;
 * a note that is not the one proved dead goes back where it came from.
 */
export async function clearPointer(dir: string, viewToken: string): Promise<boolean> {
	const pointer = await readPointer(dir);
	if (pointer === undefined || pointer.viewToken !== viewToken) return false;
	const target = join(dir, PAGE_FILE);
	const held = `${target}.gone-${process.pid}-${Math.random().toString(16).slice(2, 10)}`;
	try {
		await rename(target, held);
	} catch {
		// It left while this call was looking, which is somebody else having cleared it.
		return false;
	}
	const moved = await readPointerAt(held);
	if (moved === undefined || moved.viewToken !== viewToken) {
		await putBack(held, target);
		return false;
	}
	await rm(held, { force: true });
	return true;
}

/**
 * Put a note this call moved aside but did not earn the right to remove back in place.
 *
 * A newer note may have taken the name in the same instant; that one stays, and this one
 * was already superseded by it.
 */
async function putBack(held: string, target: string): Promise<void> {
	try {
		await link(held, target);
	} catch {
		// The name is taken again: whatever holds it now is newer than what this call moved.
	}
	await rm(held, { force: true });
}

/** How many times a caller tries to own the note before it gives up for good. */
export const NOTE_ATTEMPTS = 3;

/** What one `/board` found where the note should be. */
export type PointerOutcome =
	| { kind: "written"; took?: PagePointer }
	| { kind: "attached"; pointer: PagePointer }
	/** The name is taken by a file this build cannot read: nothing to attach to, nothing to take. */
	| { kind: "unreadable" }
	/** Every attempt lost, and the note there still answers nobody. */
	| { kind: "stale"; pointer: PagePointer }
	/** Every attempt lost to a page that came and went, so there is no note to name. */
	| { kind: "busy" };

/**
 * Become the repository's page, or find the one that already is.
 *
 * The note is written exclusively, so the loser of a simultaneous start attaches to the
 * winner rather than serving a second page nobody can find. A note that answers nobody is
 * a page that died between its note and its server — and while it sits there no later
 * `/board` can serve either, so it is taken over once it has been proved dead.
 *
 * More than one attempt, because two sessions reach this point in the same instant and
 * the loser of a *takeover* has to end up a viewer of the page that won: it re-reads and
 * probes again rather than reporting a page it never asked about. A failure here names
 * the file, because "another session is serving" is a thing this function can see and
 * therefore must not guess.
 */
export async function settlePointer(dir: string, note: PagePointer, probe?: ProbeFetch): Promise<PointerOutcome> {
	let took: PagePointer | undefined;
	for (let attempt = 0; attempt < NOTE_ATTEMPTS; attempt++) {
		// A retry writes a fresh `startedAt`, so a reader can tell it from the first attempt.
		const candidate = attempt === 0 ? note : { ...note, startedAt: note.startedAt + attempt };
		if (await createPointer(dir, candidate))
			return took === undefined ? { kind: "written" } : { kind: "written", took };
		const winner = await readPointer(dir);
		if (winner === undefined) {
			// No note at all means the page that had it cleared it in this instant: try again
			// rather than reporting a file that is not there. Only a file that stays, and
			// cannot be read, is the caller's dead end.
			if (!(await noteExists(dir))) continue;
			return { kind: "unreadable" };
		}
		if (await probePage(winner, probe)) return { kind: "attached", pointer: winner };
		// Only that exact note: a note a newer page wrote is not this caller's to take. A
		// refused clear means somebody else got there first, so the next attempt re-reads.
		if (await clearPointer(dir, winner.viewToken)) took = winner;
	}
	const last = await readPointer(dir);
	if (last !== undefined) return { kind: "stale", pointer: last };
	return (await noteExists(dir)) ? { kind: "unreadable" } : { kind: "busy" };
}

/**
 * Whether the page a pointer names is answering.
 *
 * A page that answers with anything but a 200 to the snapshot request is not one to
 * attach to: a port reused by another program, a server shutting down, and a page that
 * refuses the token all read the same, and all mean "serve your own".
 */
export async function probePage(
	pointer: PagePointer,
	fetchLike: ProbeFetch = (url, init) => fetch(url, init),
	timeoutMs: number = PROBE_MS,
): Promise<boolean> {
	try {
		const response = await fetchLike(`http://127.0.0.1:${pointer.port}/api/board?token=${pointer.viewToken}`, {
			signal: AbortSignal.timeout(timeoutMs),
		});
		return response.ok;
	} catch {
		return false;
	}
}

/** A parsed file as a pointer, or undefined when it is not one this build can trust. */
function asPointer(value: unknown): PagePointer | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const { port, viewToken, seat, startedAt } = value as Record<string, unknown>;
	if (typeof port !== "number" || !Number.isInteger(port) || port <= 0 || port > 65_535) return undefined;
	if (typeof viewToken !== "string" || viewToken === "") return undefined;
	if (typeof startedAt !== "number") return undefined;
	if (typeof seat !== "object" || seat === null) return undefined;
	const { id, label } = seat as Record<string, unknown>;
	if (typeof label !== "string" || label === "") return undefined;
	if (id !== undefined && typeof id !== "string") return undefined;
	return {
		port,
		viewToken,
		seat: id === undefined ? { label } : { id, label },
		startedAt,
	};
}
