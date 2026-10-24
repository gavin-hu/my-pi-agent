/**
 * The file-backed store for one repository's session bus.
 *
 * Every session writes its own record, every message is its own file, and every
 * claim is an exclusive-create file. That keeps concurrent Pi processes off one
 * shared lock while still making the common operations atomic. The store knows
 * nothing about models or UI; it only reads and writes validated JSON.
 */

import { createHash, randomBytes } from "node:crypto";
import { mkdir, link, readdir, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { asRecord, readJson } from "../../lib/config.ts";
import { claimsConflict } from "./protocol.ts";
import type { BusMessage, ClaimConflict, ClaimRecord, SessionRecord } from "./types.ts";

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

export interface BusStoreOptions {
	/** The repository bus directory, e.g. `<agent-dir>/session-bus/<key>`. */
	dir: string;
}

export interface BusStore {
	readonly dir: string;
	ensure(): Promise<void>;
	writeSession(record: SessionRecord): Promise<void>;
	sessions(): Promise<SessionRecord[]>;
	/** One session's record, or undefined when it is not on disk. */
	session(id: string): Promise<SessionRecord | undefined>;
	removeSession(id: string): Promise<void>;
	writeMessage(target: string, message: BusMessage): Promise<void>;
	/** Read a recipient's messages without consuming them, oldest first. */
	peek(id: string, limit: number): Promise<BusMessage[]>;
	inbox(id: string, limit: number): Promise<BusMessage[]>;
	unread(id: string): Promise<number>;
	claims(): Promise<ClaimRecord[]>;
	claimAll(
		paths: readonly string[],
		owner: string,
		ownerLabel: string,
		at: number,
	): Promise<{ claimed: string[]; conflicts: ClaimConflict[] }>;
	release(path: string, owner: string): Promise<boolean>;
	releaseAll(owner: string): Promise<string[]>;
	prune(input: {
		now: number;
		activeIds: ReadonlySet<string>;
		sessionTtlMs: number;
		messageTtlMs: number;
	}): Promise<void>;
}

/**
 * Release each path through `release`, reporting the ones this session did not
 * hold. One copy, because `release` and `leave` answer the same two lists, and a
 * second loop is how the two answers drift.
 */
export async function releaseClaimed(
	paths: readonly string[],
	release: (path: string) => Promise<boolean>,
): Promise<{ released: string[]; notOwned: string[] }> {
	const released: string[] = [];
	const notOwned: string[] = [];
	for (const path of paths) {
		if (await release(path)) released.push(path);
		else notOwned.push(path);
	}
	return { released, notOwned };
}

const SHA = (value: string): string => createHash("sha256").update(value).digest("hex").slice(0, 32);

function isSession(value: unknown): value is SessionRecord {
	const entry = asRecord(value);
	if (!entry) return false;
	return (
		typeof entry.id === "string" &&
		typeof entry.label === "string" &&
		typeof entry.pid === "number" &&
		typeof entry.cwd === "string" &&
		typeof entry.repoRoot === "string" &&
		typeof entry.mode === "string" &&
		typeof entry.startedAt === "number" &&
		typeof entry.lastSeen === "number"
	);
}

function isMessage(value: unknown): value is BusMessage {
	const entry = asRecord(value);
	if (!entry) return false;
	return (
		typeof entry.id === "string" &&
		typeof entry.from === "string" &&
		typeof entry.fromLabel === "string" &&
		typeof entry.to === "string" &&
		typeof entry.toLabel === "string" &&
		typeof entry.kind === "string" &&
		typeof entry.text === "string" &&
		typeof entry.at === "number" &&
		(entry.paths === undefined || (Array.isArray(entry.paths) && entry.paths.every((path) => typeof path === "string")))
	);
}

function isClaim(value: unknown): value is ClaimRecord {
	const entry = asRecord(value);
	if (!entry) return false;
	return (
		typeof entry.path === "string" &&
		typeof entry.owner === "string" &&
		typeof entry.ownerLabel === "string" &&
		typeof entry.at === "number"
	);
}

function readTyped<T>(path: string, guard: (value: unknown) => value is T): T | undefined {
	const parsed = readJson(path);
	return parsed !== undefined && guard(parsed) ? parsed : undefined;
}

async function writeJson(path: string, value: unknown): Promise<void> {
	await mkdir(dirname(path), { recursive: true, mode: DIR_MODE });
	const temp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
	await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf-8", mode: FILE_MODE });
	try {
		await rename(temp, path);
	} catch {
		// Windows cannot replace an existing file with rename; removing first keeps
		// the write recoverable, and the window is only a heartbeat-sized race.
		await rm(path, { force: true });
		await rename(temp, path);
	}
}

async function listFiles(dir: string): Promise<string[]> {
	try {
		return (await readdir(dir)).filter((name) => name.endsWith(".json")).sort();
	} catch {
		return [];
	}
}

/**
 * Drop a recipient's directory once it holds no files, so a bus does not keep
 * one empty directory for every session that ever joined it. An inbox with mail
 * stays, because a session's id survives a resume and its mail is still its own;
 * non-recursive removal also loses the race to a message that lands meanwhile.
 */
async function dropIfEmpty(dir: string): Promise<void> {
	const entries = await readdir(dir).catch(() => null);
	if (!entries || entries.length > 0) return;
	await rmdir(dir).catch(() => {});
}

/** Create a store rooted at one repository's bus directory. */
export function createBusStore(options: BusStoreOptions): BusStore {
	const { dir } = options;
	const sessionsDir = join(dir, "sessions");
	const inboxRoot = join(dir, "inbox");
	const claimsDir = join(dir, "claims");

	const sessionFile = (id: string): string => join(sessionsDir, `${SHA(id)}.json`);
	const inboxDir = (id: string): string => join(inboxRoot, SHA(id));
	const claimFile = (path: string): string => join(claimsDir, `${SHA(path)}.json`);

	async function readSessions(): Promise<SessionRecord[]> {
		const sessions: SessionRecord[] = [];
		for (const name of await listFiles(sessionsDir)) {
			const record = readTyped(join(sessionsDir, name), isSession);
			if (record) sessions.push(record);
		}
		return sessions.sort((a, b) => b.lastSeen - a.lastSeen || a.label.localeCompare(b.label));
	}

	async function readMessages(id: string, limit: number, remove: boolean): Promise<BusMessage[]> {
		const directory = inboxDir(id);
		const messages: BusMessage[] = [];
		for (const name of await listFiles(directory)) {
			const path = join(directory, name);
			const message = readTyped(path, isMessage);
			if (message) messages.push(message);
			if (remove || !message) await rm(path, { force: true });
			if (messages.length >= limit) break;
		}
		return messages.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id)).slice(0, limit);
	}

	async function readClaims(): Promise<ClaimRecord[]> {
		const claims: ClaimRecord[] = [];
		for (const name of await listFiles(claimsDir)) {
			const claim = readTyped(join(claimsDir, name), isClaim);
			if (claim) claims.push(claim);
		}
		return claims.sort((a, b) => a.path.localeCompare(b.path));
	}

	async function claimOne(
		path: string,
		owner: string,
		ownerLabel: string,
		at: number,
	): Promise<{ claim: ClaimRecord; conflict?: ClaimRecord }> {
		await mkdir(claimsDir, { recursive: true, mode: DIR_MODE });
		const file = claimFile(path);
		const claim: ClaimRecord = { path, owner, ownerLabel, at };
		// Publish a written temp file instead of creating the claim and filling it
		// afterwards: the link is the exclusive create, so no reader can observe a
		// half-written claim and mistake it for a crashed owner's.
		const temp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
		await writeFile(temp, `${JSON.stringify(claim, null, 2)}\n`, { encoding: "utf-8", mode: FILE_MODE });
		try {
			try {
				await link(temp, file);
				return { claim };
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			}
			const existing = readTyped(file, isClaim);
			if (existing) {
				return existing.owner === owner ? { claim: existing } : { claim, conflict: existing };
			}
			// A claim file that does not parse is debris from before claims were
			// published whole; clear it once so a stale path cannot block forever.
			await rm(file, { force: true });
			await link(temp, file);
			return { claim };
		} finally {
			await rm(temp, { force: true });
		}
	}

	async function releaseOne(path: string, owner: string): Promise<boolean> {
		const file = claimFile(path);
		const existing = readTyped(file, isClaim);
		if (!existing || existing.owner !== owner) return false;
		await rm(file, { force: true });
		return true;
	}

	/**
	 * Claim every path for one owner, or nothing.
	 *
	 * The pre-check reads the claims once and reports every blocking owner, so a
	 * batch that cannot be satisfied touches no file. A create that loses a race
	 * after the pre-check releases the paths this batch already took.
	 */
	async function claimAll(
		paths: readonly string[],
		owner: string,
		ownerLabel: string,
		at: number,
	): Promise<{ claimed: string[]; conflicts: ClaimConflict[] }> {
		const existing = await readClaims();
		const conflicts: ClaimConflict[] = [];
		for (const path of paths) {
			for (const held of existing) {
				if (held.owner !== owner && claimsConflict(path, held.path)) {
					conflicts.push({ path, owner: held.owner, ownerLabel: held.ownerLabel });
				}
			}
		}
		if (conflicts.length > 0) return { claimed: [], conflicts };
		const claimed: string[] = [];
		for (const path of paths) {
			const result = await claimOne(path, owner, ownerLabel, at);
			if (result.conflict) {
				for (const done of claimed) await releaseOne(done, owner);
				const { owner: holder, ownerLabel: holderLabel } = result.conflict;
				return { claimed: [], conflicts: [{ path, owner: holder, ownerLabel: holderLabel }] };
			}
			claimed.push(path);
		}
		return { claimed, conflicts: [] };
	}

	return {
		dir,
		async ensure() {
			await Promise.all([
				mkdir(sessionsDir, { recursive: true, mode: DIR_MODE }),
				mkdir(inboxRoot, { recursive: true, mode: DIR_MODE }),
				mkdir(claimsDir, { recursive: true, mode: DIR_MODE }),
			]);
		},

		async writeSession(record) {
			await writeJson(sessionFile(record.id), record);
		},

		sessions: readSessions,

		session: async (id) => readTyped(sessionFile(id), isSession),

		async removeSession(id) {
			await rm(sessionFile(id), { force: true });
			await dropIfEmpty(inboxDir(id));
		},

		async writeMessage(target, message) {
			const directory = inboxDir(target);
			await mkdir(directory, { recursive: true, mode: DIR_MODE });
			await writeJson(join(directory, `${message.id}.json`), message);
		},

		peek: (id, limit) => readMessages(id, limit, false),

		inbox: (id, limit) => readMessages(id, limit, true),

		async unread(id) {
			return (await listFiles(inboxDir(id))).length;
		},

		claims: readClaims,

		claimAll,

		release: releaseOne,

		async releaseAll(owner) {
			const released: string[] = [];
			for (const claim of await readClaims()) {
				if (claim.owner !== owner) continue;
				await rm(claimFile(claim.path), { force: true });
				released.push(claim.path);
			}
			return released;
		},

		async prune({ now: at, activeIds, sessionTtlMs, messageTtlMs }) {
			// The caller's set can lag: a peer that joined and claimed since that read is
			// live on disk, and its claims are its own. This read is the answer, so the
			// set only adds to what it found rather than deciding who survives.
			const live = new Set(activeIds);
			for (const session of await readSessions()) {
				if (at - session.lastSeen > sessionTtlMs) {
					await rm(sessionFile(session.id), { force: true });
					await dropIfEmpty(inboxDir(session.id));
					live.delete(session.id);
				} else {
					live.add(session.id);
				}
			}
			for (const claim of await readClaims()) {
				if (!live.has(claim.owner)) await rm(claimFile(claim.path), { force: true });
			}
			for (const name of await readdir(inboxRoot).catch(() => [] as string[])) {
				const directory = join(inboxRoot, name);
				for (const file of await listFiles(directory)) {
					const message = readTyped(join(directory, file), isMessage);
					if (!message || at - message.at > messageTtlMs) await rm(join(directory, file), { force: true });
				}
				await dropIfEmpty(directory);
			}
		},
	};
}
