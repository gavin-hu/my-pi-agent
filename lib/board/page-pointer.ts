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

import { link, readFile, rm, writeFile } from "node:fs/promises";
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

/** The pointer written for one board directory, or nothing when there is none to trust. */
export async function readPointer(dir: string): Promise<PagePointer | undefined> {
	let text: string;
	try {
		text = await readFile(join(dir, PAGE_FILE), "utf-8");
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
 */
export async function clearPointer(dir: string, viewToken: string): Promise<boolean> {
	const pointer = await readPointer(dir);
	if (pointer === undefined || pointer.viewToken !== viewToken) return false;
	await rm(join(dir, PAGE_FILE), { force: true });
	return true;
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
