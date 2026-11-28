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

import { createHash, randomBytes } from "node:crypto";
import { link, mkdir, readdir, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { DIR_MODE, ensurePrivateDir, FILE_MODE, readJson, tempPathFor } from "./json.ts";

/** The bus directory under the agent dir, `session-bus`. */
export const BUS_DIR_NAME = "session-bus";
/** One file per session inside it. */
export const SESSIONS_DIR_NAME = "sessions";
/** One directory per session, holding its mail. */
export const INBOX_DIR_NAME = "inbox";
/** One file per claimed path. */
export const CLAIMS_DIR_NAME = "claims";
/** One file per machine that has written to the bus: the heartbeat a foreign claim lapses on. */
export const HOSTS_DIR_NAME = "hosts";
/** The machine-local directory that must never replicate: the board's write lock, and this identity. */
const PRESENCE_DIR_NAME = "presence";
/** This machine's identity, inside {@link PRESENCE_DIR_NAME}. */
const HOST_IDENTITY_FILE = "host.json";
/** What every document the bus writes ends with: a reader lists these and nothing else. */
export const JSON_SUFFIX = ".json";

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
	/** `hosts/`, one file per machine that has written here. */
	hosts: string;
	/** A session's record file. */
	recordOf(id: string): string;
	/** A session's inbox directory, where its mail lands. */
	inboxOf(id: string): string;
	/** The file holding the claim on one path. */
	claimOf(path: string): string;
	/** One message's file in its recipient's inbox. */
	messageOf(to: string, id: string): string;
	/**
	 * One machine's file: `hosts/<host>.json`.
	 *
	 * The host id is a digest of nothing but this machine's installation, so it names the file
	 * directly — unlike a session id, there is no user-typed value here to keep out of a path.
	 */
	hostOf(host: string): string;
}

/** The layout of one bus directory. */
export function busPaths(dir: string): BusPaths {
	const sessions = join(dir, SESSIONS_DIR_NAME);
	const inbox = join(dir, INBOX_DIR_NAME);
	const claims = join(dir, CLAIMS_DIR_NAME);
	const hosts = join(dir, HOSTS_DIR_NAME);
	return {
		dir,
		sessions,
		inbox,
		claims,
		hosts,
		recordOf: (id) => join(sessions, `${storedName(id)}${JSON_SUFFIX}`),
		inboxOf: (id) => join(inbox, storedName(id)),
		claimOf: (path) => join(claims, `${storedName(path)}.json`),
		messageOf: (to, id) => join(inbox, storedName(to), `${id}${JSON_SUFFIX}`),
		hostOf: (host) => join(hosts, `${host}${JSON_SUFFIX}`),
	};
}

/** One machine's entry in `hosts/`: what it is called, and when it last beat. */
export interface HostRecord {
	/** The identity, as {@link HostIdentity} names it. */
	host: string;
	/** The name to draw: a host's hostname when it first wrote, which it keeps. */
	name: string;
	/** When a session on that machine last wrote its record — the one liveness a peer cannot read locally. */
	lastSeen: number;
}

/** This machine's identity: what its records name, and what every other machine draws it as. */
export interface HostIdentity {
	/** 16 hex characters, made once and never edited: a hostname can change and two machines can share one. */
	id: string;
	/** `os.hostname()` as it was when the identity was made, kept because it is only a label. */
	name: string;
}

/** Hex characters a host id carries, so a file name can be recognised as one. */
const HOST_ID_LENGTH = 16;
const HOST_ID = /^[0-9a-f]{16}$/;
/** The longest name a machine contributes: a label on a row, not a document. */
const MAX_HOST_NAME = 60;

/** Whether a string is a host id, which is what a file in `hosts/` must be named. */
export function isHostId(value: string): boolean {
	return HOST_ID.test(value);
}

/** One machine's record, read only when it is the shape this build writes. */
function isHostRecord(value: unknown): value is HostRecord {
	if (typeof value !== "object" || value === null) return false;
	const { host, name, lastSeen } = value as Record<string, unknown>;
	return (
		typeof host === "string" &&
		isHostId(host) &&
		typeof name === "string" &&
		name !== "" &&
		typeof lastSeen === "number"
	);
}

/**
 * Every machine the bus has recorded here, oldest name first.
 *
 * A file whose name is not a host id, or whose record is not this shape, is skipped the way the
 * card store skips a client's `0042 (conflicted copy).json`: a sync client's copy of a host file
 * is not a machine, and one that cannot be read must not cost the rows that can.
 */
export async function readHosts(dir: string): Promise<HostRecord[]> {
	const hosts: HostRecord[] = [];
	const directory = busPaths(dir).hosts;
	for (const file of await listJson(directory)) {
		const id = file.slice(0, -JSON_SUFFIX.length);
		if (!isHostId(id)) continue;
		const record = readJsonAs(join(directory, file), isHostRecord);
		// The name is the identity, so a file whose record disagrees with its own name is debris
		// from a rename or a copy, and believing either half would split one machine into two rows.
		if (record !== undefined && record.host === id) hosts.push(record);
	}
	return hosts;
}

/** The mode a session was started in, as the protocol's own one list. */
export type SessionMode = "tui" | "rpc" | "json" | "print" | "unknown";

/**
 * The watch a session asked for, in one word.
 *
 * `off` is a door's `listen: false` and is never turned back on by another door; absent is a record
 * written before this field existed. A start adopts it, so a restart restores what the user asked
 * for instead of the mode the next join happens to spell.
 */
export type WatchMode = "off" | "on" | "wake";

/**
 * One registered Pi session, as the file layer reads and writes it.
 *
 * It lives here rather than in the bus because the **guard** has to: `lib/` may not import an
 * extension, and a document's shape and the test that accepts it are one idea. `types.ts`
 * re-exports it, the way it already re-exports `BusMessage` from `session-mail.ts`.
 *
 * Required and optional are a distinction with a consequence: the required fields are what make a
 * file a record at all, and one missing means this build did not write it. Everything optional is
 * read field by field (`watchingOf`, `seenOf`), never as a reason to drop the record.
 */
export interface SessionRecord {
	id: string;
	label: string;
	pid: number;
	/**
	 * The machine that wrote this record.
	 *
	 * A bus directory can live where a sync client replicates it, so a record read here may be the
	 * other machine's: this is what tells them apart, and what stops a stranger's pid being read as
	 * a local process. Absent is a record an older build wrote, which is always this machine's.
	 */
	host?: string;
	/**
	 * That process's start time, when the host can name one.
	 *
	 * It is what tells the record's process apart from an unrelated one that has since been given
	 * the same pid, so `gone` does not have to wait for the heartbeat to age. Absent on a platform
	 * without `ps`, and on a record written before this existed.
	 */
	startToken?: string;
	/** Working directory of the session; the worktree root when there is one. */
	cwd: string;
	/** Repository root the session belongs to, for relative claims. */
	repoRoot: string;
	/** The mode the session was started in. */
	mode: SessionMode;
	startedAt: number;
	lastSeen: number;
	/**
	 * When this session began the turn it is in, absent outside one.
	 *
	 * The heartbeat says whether a session is there; this says whether it is busy, which is the
	 * other half of a teammate's row. Written on both edges of a run rather than on the heartbeat,
	 * so it does not lag the turn it describes — and read only beside a fresh heartbeat, because a
	 * process that died mid-turn left the stamp behind.
	 */
	turnAt?: number;
	/** The watch this session asked for, in one word — the statement, written on every join. */
	watch?: WatchMode;
	/**
	 * The same mode as the pair a peer reads, derived on every write.
	 *
	 * `armed: false` means the session is on the bus but no watch will wake it, which is the honest
	 * answer for a peer deciding whether mail will reach it; absent is only a record written before
	 * this field existed. It is a rendering of `watch`, not a second fact, and the readers outside
	 * the extension take this shape.
	 */
	watching?: { armed: boolean; wake: boolean };
	/**
	 * The mail this session has been told about, by id — what a peer's unread count subtracts.
	 *
	 * A count of `N unread` is the mail a session has *not* been told about, so an announcement
	 * advances this and the number falls with no delete: `inbox` keeps sole ownership of removing
	 * a body. Pruned against the inbox on every poll, and on the heartbeat whether or not the watch
	 * is armed, so an id can outlive its file by one tick and no longer.
	 */
	seenMail?: string[];
}

/** One path claimed by one session. */
export interface ClaimRecord {
	path: string;
	owner: string;
	ownerLabel: string;
	at: number;
	/** The machine that made it, and what tells a foreign claim from one to hold someone to. */
	host?: string;
}

/**
 * One record, parsed: the required fields, then every optional one it can actually read.
 *
 * The required list is {@link SessionRecord}'s own non-optional fields — **not** a copy of what a
 * writer happens to emit. One writer has existed since #992, and it fixes *who* writes the file;
 * this says what a record has to carry to be one. That is why a field becoming required in
 * `SessionRecord` is a decision about every record already on disk: an older record without it
 * stops being a session here, and a session stops drawing on the page.
 *
 * An optional field of the wrong shape is **dropped**, never a reason to refuse the record. It is
 * dropped here rather than at each reader because a caller that had to remember would be a second
 * reader by another name — the two-policies failure this file exists to end. A returned record is
 * therefore well-typed whoever reads it.
 */
export function parseSessionRecord(value: unknown): SessionRecord | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const entry = value as Record<string, unknown>;
	const { id, label, pid, cwd, repoRoot, mode, startedAt, lastSeen } = entry;
	if (
		typeof id !== "string" ||
		typeof label !== "string" ||
		typeof pid !== "number" ||
		typeof cwd !== "string" ||
		typeof repoRoot !== "string" ||
		typeof mode !== "string" ||
		typeof startedAt !== "number" ||
		typeof lastSeen !== "number"
	) {
		return undefined;
	}
	const host = typeof entry.host === "string" ? entry.host : undefined;
	const startToken = typeof entry.startToken === "string" ? entry.startToken : undefined;
	const turnAt = typeof entry.turnAt === "number" && Number.isFinite(entry.turnAt) ? entry.turnAt : undefined;
	const watching = watchingOf(entry.watching);
	const seenMail = seenOf(entry.seenMail);
	const watch = isWatchMode(entry.watch) ? entry.watch : undefined;
	return {
		id,
		label,
		pid,
		cwd,
		repoRoot,
		mode: mode as SessionMode,
		startedAt,
		lastSeen,
		...(host === undefined ? {} : { host }),
		...(startToken === undefined ? {} : { startToken }),
		...(turnAt === undefined ? {} : { turnAt }),
		...(watch === undefined ? {} : { watch }),
		...(watching === undefined ? {} : { watching }),
		...(seenMail === undefined ? {} : { seenMail }),
	};
}

/** One claim, parsed the same way: four fields required, the machine dropped when it is not one. */
export function parseClaimRecord(value: unknown): ClaimRecord | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const entry = value as Record<string, unknown>;
	const { path, owner, ownerLabel, at } = entry;
	if (
		typeof path !== "string" ||
		typeof owner !== "string" ||
		typeof ownerLabel !== "string" ||
		typeof at !== "number"
	) {
		return undefined;
	}
	return { path, owner, ownerLabel, at, ...(typeof entry.host === "string" ? { host: entry.host } : {}) };
}

/**
 * Claims as a reader draws them: each ownerLabel is the label its owner's record holds now,
 * falling back to the one the claim captured when no record names that id — the offline reader's
 * only name, which is why the file keeps it.
 */
export function claimsWithLiveLabels<T extends { owner: string; ownerLabel: string }>(
	claims: readonly T[],
	records: readonly Pick<SessionRecord, "id" | "label">[],
): T[] {
	const labels = new Map(records.map((record) => [record.id, record.label]));
	return claims.map((claim) => {
		const label = labels.get(claim.owner);
		return label === undefined || label === claim.ownerLabel ? claim : { ...claim, ownerLabel: label };
	});
}

/** One document at `path`, parsed by the caller's parser; `undefined` when it is not one. */
export function readDocument<T>(path: string, parse: (value: unknown) => T | undefined): T | undefined {
	const raw = readJson(path);
	return raw === undefined ? undefined : parse(raw);
}

/** The watch field's own guard, for the word a record states beside the pair a peer reads. */
export function isWatchMode(value: unknown): value is WatchMode {
	return value === "off" || value === "on" || value === "wake";
}

/**
 * The listening field, read only when it is the shape the bus writes.
 *
 * A malformed field is not a reason to hide a teammate: the row still draws, and the only thing
 * lost is the claim that mail will reach it. Here rather than in a reader because
 * `lib/session-tool.ts` reads the same field over a tool result rather than over a file — one
 * reader for one shape.
 */
export function watchingOf(value: unknown): { armed: boolean; wake: boolean } | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const { armed, wake } = value as Record<string, unknown>;
	return typeof armed === "boolean" && typeof wake === "boolean" ? { armed, wake } : undefined;
}

/**
 * The mail ids a record says its session was told about, read only when they are ids.
 *
 * A malformed cursor costs the cursor and not the row, the rule {@link watchingOf} follows.
 */
export function seenOf(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	return value.every((id): id is string => typeof id === "string") ? value : undefined;
}

/** One directory, read once: the documents that parsed, and the names that did not. */
export interface ReadDocuments<T> {
	records: T[];
	/**
	 * Files the parser refused, by name.
	 *
	 * Returned rather than discarded: a reader with somewhere to say them (a prune's report) says
	 * them, and one without (a row) stays silent on purpose. A refused document is never deleted
	 * here — an older build must not destroy a newer build's record, the rule `session-mail.ts`
	 * already keeps for a message it cannot read.
	 */
	refused: string[];
	/**
	 * Whether the directory itself was not there.
	 *
	 * `[]` and "no directory" are different answers to the roster, which tells a machine where the
	 * bus was never used from a bus whose sessions have all gone. Asked only when there is nothing
	 * to list, so a normal read pays nothing for it.
	 */
	missing: boolean;
}

/**
 * Every document in one directory, parsed once by the caller's parser.
 *
 * This is the walk the bus, the roster and the label lookup each used to carry: readdir, keep the
 * `.json`, parse, keep what parses. One body, so the three cannot disagree about which files they
 * looked at — and because the parser normalises too, they cannot disagree about what a record says
 * either.
 */
export async function readDocuments<T>(
	dir: string,
	parse: (value: unknown) => T | undefined,
): Promise<ReadDocuments<T>> {
	const records: T[] = [];
	const refused: string[] = [];
	const names = await listJson(dir);
	const missing = names.length === 0 && !(await present(dir));
	for (const name of names) {
		const document = readDocument(join(dir, name), parse);
		if (document === undefined) refused.push(name);
		else records.push(document);
	}
	return { records, refused, missing };
}

/** Whether a directory is there, for the one reader that tells an absent one from an empty one. */
async function present(dir: string): Promise<boolean> {
	try {
		await stat(dir);
		return true;
	} catch {
		return false;
	}
}

/** This machine's identity as it stands, or nothing when it has not been made yet. */
export async function readHostIdentity(agentDir: string): Promise<HostIdentity | undefined> {
	const read = readJsonAs(join(agentDir, PRESENCE_DIR_NAME, HOST_IDENTITY_FILE), isHostIdentity);
	return read;
}

function isHostIdentity(value: unknown): value is HostIdentity {
	if (typeof value !== "object" || value === null) return false;
	const { id, name } = value as Record<string, unknown>;
	return typeof id === "string" && isHostId(id) && typeof name === "string" && name !== "";
}

/**
 * This machine's identity, made once.
 *
 * It lives in the agent directory's `presence/` and not in the store, because a sync client
 * replicates the store: an identity that arrived from the other machine would name this one with
 * that machine's id and the two would read as one. The create is `publishNew`, so two sessions
 * starting at once agree on one id rather than each writing its own.
 */
export async function ensureHostIdentity(agentDir: string): Promise<HostIdentity> {
	const present = await readHostIdentity(agentDir);
	if (present !== undefined) return present;
	const made: HostIdentity = {
		id: randomBytes(HOST_ID_LENGTH / 2).toString("hex"),
		name: hostname().slice(0, MAX_HOST_NAME) || "this machine",
	};
	const path = join(agentDir, PRESENCE_DIR_NAME, HOST_IDENTITY_FILE);
	if (await publishNew(path, made)) return made;
	// The other caller won the exclusive create, so its identity is this machine's from here.
	const won = await readHostIdentity(agentDir);
	if (won === undefined) throw new Error(`${path} was created by another session and could not be read back`);
	return won;
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

/**
 * Replace a document in one step: written beside it, then renamed over it.
 *
 * `publishNew` is the create, and answers "already there"; a record that must change without a
 * moment where it is absent — a claim changing owner (#835) — needs this, because `rename` within
 * one directory is atomic and no reader sees the gap `rm` then create would open.
 */
export async function replaceJson(path: string, value: unknown): Promise<void> {
	await mkdir(dirname(path), { recursive: true, mode: DIR_MODE });
	const temp = tempPathFor(path);
	await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf-8", mode: FILE_MODE });
	await rename(temp, path);
}

/** Create a directory the bus writes into, owner-only, narrowing one that is already there. */
export async function ensureDir(dir: string): Promise<void> {
	ensurePrivateDir(dir);
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
