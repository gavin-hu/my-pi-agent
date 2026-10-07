/**
 * Checkpoint storage: metadata encoding and ref-backed listing.
 *
 * Each checkpoint is a commit under `refs/pi/checkpoints/<id>`. The metadata
 * line in the commit body is the source of truth; a malformed message is
 * skipped rather than trusted, so one bad object cannot break the list.
 */

import { commitMessages, deleteRef, listRefs, type RunGit } from "./git.ts";
import type { Checkpoint, CheckpointReason } from "./types.ts";

/** Prefix of the metadata line in a checkpoint commit body. */
export const META_MARKER = "pi-checkpoint: ";

/** Metadata schema version; refs written by other versions are ignored. */
export const META_VERSION = 2;

const REASONS: readonly CheckpointReason[] = ["auto", "manual", "pre-restore"];

/** Full ref name for a checkpoint id. */
export function refFor(namespace: string, id: string): string {
	return `${namespace}/${id}`;
}

/** Id encoded in a ref name under `namespace`, or undefined when it is not one. */
export function idFromRef(namespace: string, ref: string): string | undefined {
	const prefix = `${namespace}/`;
	return ref.startsWith(prefix) && ref.length > prefix.length ? ref.slice(prefix.length) : undefined;
}

/** The metadata stored in the commit body (everything except derived ref/commit). */
export type CheckpointMeta = Omit<Checkpoint, "ref" | "commit"> & { v: number };

/** Commit message for a checkpoint: a short subject plus the metadata line. */
export function encodeMessage(checkpoint: CheckpointMeta): string {
	return [`checkpoint ${checkpoint.id}`, "", META_MARKER + JSON.stringify(checkpoint)].join("\n");
}

/** Parse the metadata line from a commit body, or undefined when absent/invalid. */
export function parseMessage(message: string): CheckpointMeta | undefined {
	const line = message.split("\n").find((candidate) => candidate.startsWith(META_MARKER));
	if (!line) return undefined;
	let raw: unknown;
	try {
		raw = JSON.parse(line.slice(META_MARKER.length));
	} catch {
		return undefined;
	}
	return isMeta(raw) ? raw : undefined;
}

function isMeta(value: unknown): value is CheckpointMeta {
	if (!value || typeof value !== "object") return false;
	const meta = value as Partial<CheckpointMeta>;
	return (
		meta.v === META_VERSION &&
		typeof meta.id === "string" &&
		meta.id.length > 0 &&
		typeof meta.head === "string" &&
		typeof meta.root === "string" &&
		typeof meta.timestamp === "number" &&
		typeof meta.clean === "boolean" &&
		typeof meta.includeUntracked === "boolean" &&
		(meta.prompt === undefined || typeof meta.prompt === "string") &&
		REASONS.includes(meta.reason as CheckpointReason)
	);
}

export interface ListOptions {
	/** Only return checkpoints whose recorded root matches. */
	root?: string;
}

/** All valid checkpoints under `namespace`, newest first. */
export async function listCheckpoints(
	runGit: RunGit,
	cwd: string,
	namespace: string,
	options: ListOptions = {},
): Promise<Checkpoint[]> {
	const refs = await listRefs(runGit, cwd, namespace);
	if (refs.size === 0) return [];

	const entries = [...refs.entries()].map(([ref, commit]) => ({ ref, commit }));
	const messages = await commitMessages(
		runGit,
		cwd,
		entries.map((entry) => entry.commit),
	);

	const checkpoints: Checkpoint[] = [];
	for (const entry of entries) {
		const meta = parseMessage(messages.get(entry.commit) ?? "");
		if (!meta) continue;
		// Trust the ref for identity, so a rewritten message cannot alias another ref.
		const id = idFromRef(namespace, entry.ref) ?? meta.id;
		const checkpoint: Checkpoint = { ...meta, id, ref: entry.ref, commit: entry.commit };
		if (options.root !== undefined && checkpoint.root !== options.root) continue;
		checkpoints.push(checkpoint);
	}
	checkpoints.sort((a, b) => b.timestamp - a.timestamp || b.id.localeCompare(a.id));
	return checkpoints;
}

/** Resolve `id` (or the literal `"last"`) to a checkpoint, or undefined. */
export async function getCheckpoint(
	runGit: RunGit,
	cwd: string,
	namespace: string,
	id: string,
	options: ListOptions = {},
): Promise<Checkpoint | undefined> {
	const checkpoints = await listCheckpoints(runGit, cwd, namespace, options);
	if (id === "last") return checkpoints[0];
	return checkpoints.find((checkpoint) => checkpoint.id === id);
}

/** Delete the given refs. Failures are reported as a count, not thrown. */
export async function deleteCheckpoints(
	runGit: RunGit,
	cwd: string,
	checkpoints: Checkpoint[],
): Promise<number> {
	let removed = 0;
	for (const checkpoint of checkpoints) {
		try {
			await deleteRef(runGit, cwd, checkpoint.ref);
			removed += 1;
		} catch {
			// A ref deleted by a concurrent session is fine to ignore.
		}
	}
	return removed;
}

/**
 * Delete refs under `namespace`. When `root` is given, checkpoints that parse
 * and belong to another root are kept; unparseable refs (a foreign or older
 * schema) are always removed, so a redesign cannot strand invisible orphans.
 */
export async function clearCheckpoints(
	runGit: RunGit,
	cwd: string,
	namespace: string,
	options: ListOptions = {},
): Promise<number> {
	const refs = await listRefs(runGit, cwd, namespace);
	if (refs.size === 0) return 0;

	const entries = [...refs.entries()].map(([ref, commit]) => ({ ref, commit }));
	const messages = await commitMessages(
		runGit,
		cwd,
		entries.map((entry) => entry.commit),
	);

	let removed = 0;
	for (const entry of entries) {
		const meta = parseMessage(messages.get(entry.commit) ?? "");
		if (options.root !== undefined && meta && meta.root !== options.root) continue;
		try {
			await deleteRef(runGit, cwd, entry.ref);
			removed += 1;
		} catch {
			// A ref deleted by a concurrent session is fine to ignore.
		}
	}
	return removed;
}

/** Delete the oldest checkpoints for `root` beyond `max`; returns the count. */
export async function pruneCheckpoints(
	runGit: RunGit,
	cwd: string,
	namespace: string,
	max: number,
	root: string,
): Promise<number> {
	if (max < 0) return 0;
	const checkpoints = await listCheckpoints(runGit, cwd, namespace, { root });
	if (checkpoints.length <= max) return 0;
	return deleteCheckpoints(runGit, cwd, checkpoints.slice(max));
}
