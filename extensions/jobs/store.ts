/**
 * Durable job storage: the on-disk registry that outlives a session.
 *
 * The live process table (the `Job` map, including the `owned` child handles)
 * stays in the runtime because process events mutate it; this owns the parts
 * that survive a session — the registry directory, the id counter, the ids this
 * session deleted, the atomic merge-write, and the trusted log-path rule.
 *
 * Persistence is best-effort: an unwritable registry must never break a job that
 * is otherwise running fine.
 */

import { join, resolve } from "node:path";
import { loadRegistry, saveRegistry } from "./registry.ts";
import { toRecord, type Job, type JobRecord } from "./types.ts";

export interface JobStore {
	/** The registry/log directory in use. */
	directory(): string;
	/** Point at a new registry directory. */
	setDirectory(dir: string): void;
	/** Seed the id counter, for example from a loaded registry file. */
	setCounter(value: number): void;
	/** Mark an id deleted, so a merge cannot resurrect it from disk. */
	markRemoved(id: string): void;
	/** Forget this session's deleted-id set. */
	resetRemoved(): void;
	/** Next free id, honoring the stored/peer counter and `ids`. */
	nextId(ids: Iterable<string>): string;
	/** Merge the live jobs onto a fresh read and write atomically. */
	persist(jobs: Iterable<Job>): void;
	/** Absolute log path for a job id in the current directory. */
	logPath(id: string): string;
	/** The log path only when it is exactly this job's file in the directory. */
	safeLogPath(job: JobRecord): string | undefined;
}

/** Next free id, derived from the stored counter and the highest `j<n>` present. */
function nextCounter(stored: number, ids: Iterable<string>): number {
	let next = stored > 0 ? stored : 1;
	for (const id of ids) {
		const match = /^j(\d+)$/.exec(id);
		if (match) next = Math.max(next, Number(match[1]) + 1);
	}
	return next;
}

export function createJobStore(initialDir: string): JobStore {
	let dir = initialDir;
	let counter = 1;
	const removed = new Set<string>();

	return {
		directory: () => dir,
		setDirectory: (next) => {
			dir = next;
		},
		setCounter: (value) => {
			counter = value;
		},
		markRemoved: (id) => {
			removed.add(id);
		},
		resetRemoved: () => {
			removed.clear();
		},
		nextId: (ids) => {
			// A peer session may have advanced the shared counter since we loaded,
			// so fold in what is on disk (and its ids) as well as the live table.
			const disk = loadRegistry(dir);
			const next = nextCounter(Math.max(counter, disk.counter), [...disk.jobs.map((job) => job.id), ...ids]);
			counter = next + 1;
			return `j${next}`;
		},
		persist: (jobs) => {
			try {
				// Merge onto a fresh read so a peer session's records are preserved
				// instead of clobbered; our records win, and our deletions stick.
				const disk = loadRegistry(dir);
				const merged = new Map<string, JobRecord>();
				for (const record of disk.jobs) merged.set(record.id, record);
				for (const id of removed) merged.delete(id);
				for (const job of jobs) merged.set(job.id, toRecord(job));
				counter = Math.max(counter, disk.counter);
				saveRegistry(dir, { version: 1, counter, jobs: [...merged.values()] });
			} catch {
				// Registry persistence is best-effort; a job still works in-process.
			}
		},
		logPath: (id) => join(dir, `${id}.log`),
		safeLogPath: (job) => {
			const expected = resolve(join(dir, `${job.id}.log`));
			const actual = resolve(job.logPath);
			return actual === expected ? actual : undefined;
		},
	};
}
