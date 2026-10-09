/**
 * Durable job storage: the on-disk registry that outlives a session.
 *
 * The live process table (the `Job` map, including the `owned` child handles)
 * stays in the runtime because process events mutate it; this owns the parts
 * that survive a session — the registry directory, the id counter, the atomic
 * write of this session's own registry file, and the trusted artifact-path
 * rules. Each session writes only its own file, so peers never race.
 *
 * Persistence is best-effort: an unwritable registry must never break a job that
 * is otherwise running fine.
 */

import { join, resolve } from "node:path";
import { loadRegistries, registryDirFor, saveRegistry } from "./registry.ts";
import { listReservedIds, pruneReservations, releaseReservation, reserveId } from "./reservations.ts";
import { statusPathFor } from "./paths.ts";
import { toRecord, type Job, type JobRecord } from "./types.ts";

export interface JobStore {
	/** The registry/log directory in use. */
	directory(): string;
	/** Point at a new registry directory. */
	setDirectory(dir: string): void;
	/** Set the owning session, so `persist` writes the right file. */
	setSession(sessionId: string): void;
	/** Seed the id counter, for example from a loaded registry file. */
	setCounter(value: number): void;
	/** Next free id, honoring every on-disk counter and `ids`, reserving it atomically. */
	nextId(ids: Iterable<string>): string;
	/** Release a reserved id, for example when clearing a job. */
	releaseId(id: string): void;
	/** Drop reservations for ids already committed to a registry file. */
	pruneReservations(committed: Iterable<string>): void;
	/** Write this session's own registry file atomically. */
	persist(jobs: Iterable<Job>): void;
	/** Absolute log path for a job id in the current directory. */
	logPath(id: string): string;
	/** The log path only when it is exactly this job's file in the directory. */
	safeLogPath(job: JobRecord): string | undefined;
	/** Absolute status path for a job id in the current directory. */
	statusPath(id: string): string;
	/** The status path only when it is exactly this job's file in the directory. */
	safeStatusPath(job: JobRecord): string | undefined;
}

export function createJobStore(initialDir = registryDirFor(process.cwd())): JobStore {
	let dir = initialDir;
	let sessionId = "session";
	let counter = 1;

	return {
		directory: () => dir,
		setDirectory: (next) => {
			dir = next;
		},
		setSession: (next) => {
			sessionId = next;
		},
		setCounter: (value) => {
			counter = value;
		},
		nextId: (ids) => {
			// Read every session's file so a peer that advanced its counter or took an
			// id is respected, even though we only ever write our own file. The
			// reservation file is the atomic guard against a simultaneous start.
			const { files, counter: diskCounter } = loadRegistries(dir);
			const registryIds = files.flatMap((file) => file.jobs.map((job) => job.id));
			const next = reserveId(dir, [...registryIds, ...listReservedIds(dir), ...ids], Math.max(counter, diskCounter));
			counter = Number(next.slice(1)) + 1;
			return next;
		},
		releaseId: (id) => releaseReservation(dir, id),
		pruneReservations: (committed) => pruneReservations(dir, committed),
		persist: (jobs) => {
			try {
				// Only this session's records are ours to write; peer records live in
				// their own files and are read back on the next load.
				const own = [...jobs].filter((job) => job.sessionId === sessionId);
				saveRegistry(dir, { version: 1, sessionId, counter, jobs: own.map(toRecord) });
			} catch {
				// Registry persistence is best-effort; a job still works in-process.
			}
		},
		logPath: (id) => join(dir, `${id}.log`),
		safeLogPath: (job) => safeArtifact(job.logPath, join(dir, `${job.id}.log`)),
		statusPath: (id) => statusPathFor(dir, id),
		safeStatusPath: (job) => safeArtifact(job.statusPath ?? undefined, join(dir, `${job.id}.status`)),
	};
}

/** The absolute path only when it equals `expected` inside the registry dir. */
function safeArtifact(path: string | undefined, expected: string): string | undefined {
	if (!path) return undefined;
	const target = resolve(expected);
	return resolve(path) === target ? target : undefined;
}
