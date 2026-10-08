/**
 * On-disk job registry.
 *
 * Jobs are OS processes, so their state must survive an extension reload or a
 * new session. A small JSON registry under the agent dir records every job; a
 * later session loads it, checks each running pid for liveness, and either
 * reattaches (detached) or reaps (default) the leftover process. Log files sit
 * beside the registry and are never rewritten.
 *
 * The pure `planReconcile` takes liveness as a callback, so its rules are
 * unit-tested without touching real processes.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { JOB_STATUSES, type JobRecord, type RegistryFile } from "./types.ts";

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
	return join(homedir(), ".pi", "agent", "jobs", projectKey(cwd));
}

/** Path of the registry file inside `dir`. */
function registryPathFor(dir: string): string {
	return join(dir, "registry.json");
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
		(JOB_STATUSES as readonly string[]).includes(job.status)
	);
}

/** Parse a registry file, skipping malformed entries rather than trusting them. */
export function parseRegistry(raw: unknown): RegistryFile {
	if (!raw || typeof raw !== "object") return { version: REGISTRY_VERSION, counter: 1, jobs: [] };
	const file = raw as Partial<RegistryFile>;
	const jobs = Array.isArray(file.jobs) ? file.jobs.filter(isJobRecord) : [];
	const counter = typeof file.counter === "number" && file.counter > 0 ? Math.floor(file.counter) : 1;
	return { version: REGISTRY_VERSION, counter, jobs };
}

/** Load the registry for `dir`; a missing or unreadable file yields an empty one. */
export function loadRegistry(dir: string): RegistryFile {
	try {
		return parseRegistry(JSON.parse(readFileSync(registryPathFor(dir), "utf-8")));
	} catch {
		return { version: REGISTRY_VERSION, counter: 1, jobs: [] };
	}
}

/** Persist the registry atomically. Failures are non-fatal for the caller. */
export function saveRegistry(dir: string, file: RegistryFile): void {
	mkdirSync(dir, { recursive: true });
	const path = registryPathFor(dir);
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, JSON.stringify(file, null, 2), "utf-8");
	renameSync(tmp, path);
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
 * At session start no process is owned by this runtime, so:
 * - a running record whose pid is gone becomes `unknown`;
 * - a running record whose pid is alive is reattached when detached, and
 *   otherwise returned as an orphan to kill, so an abandoned build cannot keep
 *   running unnoticed.
 *
 * When owner liveness is supplied, a live non-detached job owned by *another*
 * still-live session is kept instead of reaped, so concurrent sessions in one
 * project do not kill each other's jobs. Without it the legacy rule applies and
 * every live non-detached leftover is an orphan.
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
