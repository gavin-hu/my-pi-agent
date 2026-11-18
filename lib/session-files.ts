/**
 * The session bus on disk: where each kind of document lives under one repository's bus
 * directory, and the mechanical part of writing one.
 *
 * The bus is files rather than a server — every session writes its own record, every message is
 * its own file in its recipient's inbox, and a claim is a file created exclusively — so three
 * readers walk the same layout: the bus's own store, the data-only readers in `session-mail.ts`,
 * and the board, whose tab counts a repository's mail with no bus running. The layout and its
 * rules are therefore here once, and no caller spells a path of its own.
 *
 * A name is an identity, never a path: a session id, a claimed path, and a message's id become a
 * digest before they reach a file name. Writes are `lib/json.ts`'s rule, asynchronously: written
 * to a temp file beside the target and renamed over it, so a reader sees the document before or
 * after and never half of either; a claim is published by a link instead, which is the exclusive
 * create the claim *is*. The temp's name is `lib/json.ts`'s {@link tempPathFor}, which no reader
 * lists and {@link dropStaleTemps} clears once the process that owned it is gone.
 */

import { createHash } from "node:crypto";
import { link, mkdir, readdir, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { readJson, tempPathFor } from "./json.ts";

/** The bus directory under the agent dir, `session-bus`. */
export const BUS_DIR_NAME = "session-bus";
/** One file per session inside it. */
export const SESSIONS_DIR_NAME = "sessions";
/** One directory per session, holding its mail. */
export const INBOX_DIR_NAME = "inbox";
/** One file per claimed path. */
export const CLAIMS_DIR_NAME = "claims";
/** What every document the bus writes ends with: a reader lists these and nothing else. */
export const JSON_SUFFIX = ".json";

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/** Hex characters the bus keeps from the digest: short on every filesystem, unique in practice. */
const STORED_NAME_LENGTH = 32;

/**
 * How long a writer's temp file may sit before it is debris.
 *
 * A record, a claim, and a message are published by renaming or linking a temp file, so the file
 * exists for milliseconds; one left behind is a process that stopped between the write and the
 * publish. The window is measured on the filesystem's own clock, not the bus's, because that is
 * the clock the timestamps came from.
 */
const TEMP_TTL_MS = 60_000;

/**
 * The name the bus files a session id, or a claim's path, under.
 *
 * A session's record (`sessions/<name>.json`), its inbox (`inbox/<name>/`), and a claim on a path
 * (`claims/<name>.json`) are all named by it, so "this mail belongs to that record" is one rule
 * rather than a hash the store knows and a reader re-derives. It is also what keeps a session id
 * from ever becoming a path segment.
 */
export function storedName(value: string): string {
	return createHash("sha256").update(value).digest("hex").slice(0, STORED_NAME_LENGTH);
}

/** Every path one repository's bus directory holds, so no caller spells the layout itself. */
export interface BusPaths {
	/** The repository's bus directory. */
	dir: string;
	/** `sessions/`, where one record per session lives. */
	sessions: string;
	/** `inbox/`, one directory per session inside it. */
	inbox: string;
	/** `claims/`, one file per claimed path. */
	claims: string;
	/** A session's record file. */
	recordOf(id: string): string;
	/** A session's inbox directory, where its mail lands. */
	inboxOf(id: string): string;
	/** The file holding the claim on one path. */
	claimOf(path: string): string;
	/** One message's file in its recipient's inbox. */
	messageOf(to: string, id: string): string;
}

/** The layout of one bus directory. */
export function busPaths(dir: string): BusPaths {
	const sessions = join(dir, SESSIONS_DIR_NAME);
	const inbox = join(dir, INBOX_DIR_NAME);
	const claims = join(dir, CLAIMS_DIR_NAME);
	return {
		dir,
		sessions,
		inbox,
		claims,
		recordOf: (id) => join(sessions, `${storedName(id)}${JSON_SUFFIX}`),
		inboxOf: (id) => join(inbox, storedName(id)),
		claimOf: (path) => join(claims, `${storedName(path)}.json`),
		messageOf: (to, id) => join(inbox, storedName(to), `${id}${JSON_SUFFIX}`),
	};
}

/** The `*.json` files in one directory, as names; a directory that is not there holds none. */
export async function listJson(dir: string): Promise<string[]> {
	try {
		return (await readdir(dir)).filter((name) => name.endsWith(JSON_SUFFIX)).sort();
	} catch {
		return [];
	}
}

/** A document at `path`, if it parses and its guard accepts what it says. */
export function readJsonAs<T>(path: string, guard: (value: unknown) => value is T): T | undefined {
	const parsed = readJson(path);
	return parsed !== undefined && guard(parsed) ? parsed : undefined;
}

/**
 * Publish one document at `path`, whole: written to a temp file and renamed over the target, so a
 * reader sees the old document or the new one and never half of either.
 *
 * The failure path is `lib/json.ts`'s `writeJsonFile`, the synchronous half of this same rule: the
 * temp is removed and the original reason travels, because the document already at the path is not
 * this write's to delete. One retry sits before that, because what reaches here is a sharing
 * violation — a peer holding the target open — and not a replace the platform cannot do: node asks
 * for `MOVEFILE_REPLACE_EXISTING`, so replacing works and only the holder's refusal is left. The
 * temp name is that module's too, so two writes in one process cannot share a temp; the two stay
 * separate functions because one is synchronous and one is not.
 */
export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
	await mkdir(dirname(path), { recursive: true, mode: DIR_MODE });
	const temp = tempPathFor(path);
	await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf-8", mode: FILE_MODE });
	try {
		await rename(temp, path);
	} catch (refused) {
		try {
			// The holder refusing it is usually a peer between two reads of its own record, and the
			// temp file is ours and in nobody's way.
			await rename(temp, path);
		} catch {
			await rm(temp, { force: true });
			throw refused;
		}
	}
}

/**
 * Create a document at `path` only where nothing is there yet, and say whether this call made it.
 *
 * The link is the exclusive create: a written temp published by `link` either lands whole or fails
 * with `EEXIST`, so no reader can observe a half-written claim and mistake it for a crashed
 * owner's. The temp is removed whatever happens.
 */
export async function publishNew(path: string, value: unknown): Promise<boolean> {
	await mkdir(dirname(path), { recursive: true, mode: DIR_MODE });
	const temp = tempPathFor(path);
	await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf-8", mode: FILE_MODE });
	try {
		await link(temp, path);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		return false;
	} finally {
		await rm(temp, { force: true });
	}
}

/** Create a directory the bus writes into. */
export async function ensureDir(dir: string): Promise<void> {
	await mkdir(dir, { recursive: true, mode: DIR_MODE });
}

/**
 * Drop a recipient's directory once it holds no files, so a bus does not keep one empty directory
 * for every session that ever joined it. An inbox with mail stays, because a session's id survives
 * a resume and its mail is still its own; non-recursive removal also loses the race to a message
 * that lands meanwhile.
 */
export async function dropIfEmpty(dir: string): Promise<void> {
	const entries = await readdir(dir).catch(() => null);
	if (!entries || entries.length > 0) return;
	await rmdir(dir).catch(() => {});
}

/**
 * Remove the temp files a crashed writer left in one directory.
 *
 * Readers only ever look at `*.json`, so this debris is invisible and would live forever without a
 * pass of its own.
 */
export async function dropStaleTemps(dir: string): Promise<void> {
	const cut = Date.now() - TEMP_TTL_MS;
	for (const name of await readdir(dir).catch(() => [] as string[])) {
		if (name.endsWith(JSON_SUFFIX)) continue;
		const path = join(dir, name);
		const info = await stat(path).catch(() => undefined);
		if (info !== undefined && info.mtimeMs < cut) await rm(path, { force: true });
	}
}

/** The peer's temp file is `lib/json.ts`'s {@link tempPathFor}: one spelling of a name the
 * cleanup below can recognise, and one process that cannot share it with another. */
