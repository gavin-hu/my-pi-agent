/**
 * On-disk job registry.
 *
 * Jobs are OS processes, so their state must survive an extension reload or a
 * new session. A small JSON registry under the agent dir records every job; a
 * later session loads it, checks each running pid for liveness, and either
 * reattaches (detached) or reaps (default) the leftover process. Log files sit
 * beside the registry and are never rewritten.
 *
 * Each session is the sole writer of its own `registry-<hash>.json`, so a
 * concurrent session can never clobber a peer's read-modify-write. Loading
 * merges every session file, and a session adopts a dead peer's records (so a
 * detached server survives, and a crashed session's history is not lost). The
 * legacy shared `registry.json` is migrated on first load.
 *
 * The pure `planReconcile`/`mergeRecords`/`settleGone` helpers take liveness and
 * exit-status reads as callbacks, so their rules are unit-tested without
 * touching real processes.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { registryPathFor } from "./paths.ts";
import { JOB_STATUSES, type JobRecord, type JobStatus, type RegistryFile } from "./types.ts";

export const REGISTRY_VERSION = 1;

/** Stable per-directory key so each project gets its own registry. */
export function projectKey(cwd: string): string {
	const hash = createHash("sha1").update(resolve(cwd)).digest("hex").slice(0, 12);
	const base = resolve(cwd).split(/[\\/]/).filter(Boolean).pop() ?? "root";
	return `${base.replace(/[^\w.-]+/g, "_")}-${hash}`;
}

/** Directory holding the registry and log files for a working directory. */
export function registryDirFor(cwd: string, override?: string): string {
	if (override) return resolve(override);
	return join(getAgentDir(), "jobs", projectKey(cwd));
}

function isJobRecord(value: unknown): value is JobRecord {
	if (!value || typeof value !== "object") return false;
	const job = value as Partial<JobRecord>;
	return (
		typeof job.id === "string" &&
		typeof job.command === "string" &&
		typeof job.cwd === "string" &&
		typeof job.startedAt === "number" &&
		typeof job.logPath === "string" &&
		typeof job.status === "string" &&
		(JOB_STATUSES as readonly string[]).includes(job.status) &&
		(job.pid === null || typeof job.pid === "number") &&
		(job.exitCode === null || typeof job.exitCode === "number") &&
		(job.signal === null || typeof job.signal === "string") &&
		(job.finishedAt === null || typeof job.finishedAt === "number") &&
		(job.statusPath === undefined || job.statusPath === null || typeof job.statusPath === "string") &&
		(job.startToken === undefined || job.startToken === null || typeof job.startToken === "string")
	);
}

/** Normalize field presence so downstream code only ever sees `null`, never `undefined`. */
function normalizeRecord(record: JobRecord): JobRecord {
	return {
		...record,
		statusPath: record.statusPath ?? null,
		startToken: record.startToken ?? null,
	};
}

/** Parse a registry file, skipping malformed entries rather than trusting them. */
export function parseRegistry(raw: unknown, fallbackSessionId = "unknown"): RegistryFile {
	if (!raw || typeof raw !== "object") {
		return { version: REGISTRY_VERSION, sessionId: fallbackSessionId, counter: 1, jobs: [] };
	}
	const file = raw as Partial<RegistryFile>;
	const jobs = Array.isArray(file.jobs) ? file.jobs.filter(isJobRecord).map(normalizeRecord) : [];
	const counter = typeof file.counter === "number" && file.counter > 0 ? Math.floor(file.counter) : 1;
	const sessionId = typeof file.sessionId === "string" && file.sessionId ? file.sessionId : fallbackSessionId;
	return { version: REGISTRY_VERSION, sessionId, counter, jobs };
}

export interface LoadedRegistries {
	/** Every well-formed registry file found in the directory. */
	files: RegistryFile[];
	/** Highest counter seen across files, at least 1. */
	counter: number;
}

/**
 * Load every session's registry file in `dir`, newest id counter included.
 *
 * A leftover legacy `registry.json` (the pre-per-session format) is read as a
 * file owned by the sentinel `"legacy"` session. The caller adopts its records
 * and then calls {@link removeLegacyRegistry}.
 */
export function loadRegistries(dir: string): LoadedRegistries {
	const files: RegistryFile[] = [];
	let counter = 1;
	const consider = (file: RegistryFile): void => {
		files.push(file);
		counter = Math.max(counter, file.counter);
	};
	try {
		for (const entry of readdirSync(dir)) {
			if (!entry.startsWith("registry-") || !entry.endsWith(".json")) continue;
			try {
				consider(parseRegistry(JSON.parse(readFileSync(join(dir, entry), "utf-8"))));
			} catch {
				// Skip a malformed registry file.
			}
		}
	} catch {
		// A missing directory has no registries.
	}
	const legacy = join(dir, "registry.json");
	if (existsSync(legacy)) {
		try {
			consider(parseRegistry(JSON.parse(readFileSync(legacy, "utf-8")), "legacy"));
		} catch {
			// Leave an unreadable legacy file in place rather than lose it.
		}
	}
	return { files, counter };
}

/** Delete the legacy shared registry once its records have been adopted. */
export function removeLegacyRegistry(dir: string): void {
	try {
		const path = join(dir, "registry.json");
		if (existsSync(path)) unlinkSync(path);
	} catch {
		// Best-effort.
	}
}

/** Persist one session's registry atomically. Failures are non-fatal for the caller. */
export function saveRegistry(dir: string, file: RegistryFile): void {
	mkdirSync(dir, { recursive: true });
	const path = registryPathFor(dir, file.sessionId);
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, JSON.stringify(file, null, 2), "utf-8");
	renameSync(tmp, path);
}

/** Remove a session's registry file; missing files and failures are ignored. */
export function removeRegistry(dir: string, sessionId: string): void {
	try {
		const path = registryPathFor(dir, sessionId);
		if (existsSync(path)) unlinkSync(path);
	} catch {
		// Best-effort.
	}
}

/**
 * Combine two records for the same id from different files.
 *
 * A settled record beats a running one; a record owned by `preferSessionId`
 * (the reading session) beats a peer's; otherwise the more recently finished
 * (or, failing that, started) record wins. Exposed for tests.
 */
export function mergeRecords(a: JobRecord, b: JobRecord, preferSessionId?: string): JobRecord {
	const aRunning = a.status === "running";
	const bRunning = b.status === "running";
	if (aRunning !== bRunning) return aRunning ? b : a;
	if (preferSessionId) {
		if (a.sessionId === preferSessionId && b.sessionId !== preferSessionId) return a;
		if (b.sessionId === preferSessionId && a.sessionId !== preferSessionId) return b;
	}
	return (b.finishedAt ?? b.startedAt) > (a.finishedAt ?? a.startedAt) ? b : a;
}

export interface SettleGoneOptions {
	/** Whether a pid is still alive. */
	isAlive: (pid: number) => boolean;
	/** Whether the record's start token still matches the live pid. */
	tokenMatches: (record: JobRecord) => boolean;
	/** Read a recovered exit code for a gone process, or undefined. */
	readExitCode?: (record: JobRecord) => number | undefined;
	/** Timestamp to record as `finishedAt`. */
	now: number;
}

/**
 * Settle a record whose process may already be gone.
 *
 * Returns the record unchanged while the pid is live; marks it `unknown` when
 * the start token no longer matches or no exit code can be recovered; otherwise
 * records `exited`/`failed` with the recovered code.
 */
export function settleGone(record: JobRecord, options: SettleGoneOptions): JobRecord {
	if (record.status !== "running" || record.pid === null) return record;
	if (!options.tokenMatches(record)) return { ...record, status: "unknown", finishedAt: options.now };
	if (options.isAlive(record.pid)) return record;
	const code = options.readExitCode?.(record);
	if (code === undefined) return { ...record, status: "unknown", finishedAt: options.now };
	const status: JobStatus = code === 0 ? "exited" : "failed";
	return { ...record, status, exitCode: code, finishedAt: options.now };
}

export interface ReconcileResult {
	/** The records after liveness reconciliation. */
	jobs: JobRecord[];
	/** Live, non-detached leftovers that the caller should kill. */
	orphans: JobRecord[];
}

/** Owner-liveness context for {@link planReconcile}. */
export interface ReconcileOptions {
	/**
	 * Whether the session that started a job is still alive. A live owner means
	 * another session owns the job, so it is left running rather than reaped.
	 */
	isOwnerAlive?: (sessionId: string) => boolean;
	/** The reconciling session; its own leftovers are always reaped. */
	currentSessionId?: string;
}

/**
 * Reconcile loaded records against current process liveness.
 *
 * Expects running records to have been through {@link settleGone} already, so a
 * dead pid here is a fallback. A live non-detached record is an orphan unless a
 * different, still-live session owns it.
 */
export function planReconcile(
	records: JobRecord[],
	isAlive: (pid: number) => boolean,
	now: number,
	options: ReconcileOptions = {},
): ReconcileResult {
	const jobs: JobRecord[] = [];
	const orphans: JobRecord[] = [];

	for (const record of records) {
		if (record.status !== "running" || record.pid === null) {
			jobs.push(record);
			continue;
		}
		if (!isAlive(record.pid)) {
			jobs.push({ ...record, status: "unknown", finishedAt: now });
			continue;
		}
		if (record.detached) {
			jobs.push(record);
			continue;
		}
		// Another live session still owns this job: keep it running instead of
		// reaping a peer's work.
		if (
			options.isOwnerAlive &&
			record.sessionId !== options.currentSessionId &&
			options.isOwnerAlive(record.sessionId)
		) {
			jobs.push(record);
			continue;
		}
		orphans.push(record);
		jobs.push(record);
	}

	return { jobs, orphans };
}
