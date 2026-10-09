/**
 * Snapshot storage: metadata encoding and ref-backed listing.
 *
 * Each snapshot is a commit under `refs/pi/rewind/<id>`. The metadata line in
 * the commit body is the source of truth; a malformed message is skipped rather
 * than trusted, so one bad object cannot break the list.
 */

import { commitMessages, deleteRef, listRefs, type RunGit } from "./git.ts";
import type { Snapshot, SnapshotReason } from "./types.ts";

/** Prefix of the metadata line in a snapshot commit body. */
export const META_MARKER = "pi-rewind: ";

/** Metadata schema version; refs written by other versions are ignored. */
export const META_VERSION = 3;

const REASONS: readonly SnapshotReason[] = ["auto", "pre-restore"];

/** Full ref name for a snapshot id. */
export function refFor(namespace: string, id: string): string {
	return `${namespace}/${id}`;
}

/** Id encoded in a ref name under `namespace`, or undefined when it is not one. */
export function idFromRef(namespace: string, ref: string): string | undefined {
	const prefix = `${namespace}/`;
	return ref.startsWith(prefix) && ref.length > prefix.length ? ref.slice(prefix.length) : undefined;
}

/** The metadata stored in the commit body (everything except derived ref/commit). */
export type SnapshotMeta = Omit<Snapshot, "ref" | "commit"> & { v: number };

/** Commit message for a snapshot: a short subject plus the metadata line. */
export function encodeMessage(snapshot: SnapshotMeta): string {
	return [`snapshot ${snapshot.id}`, "", META_MARKER + JSON.stringify(snapshot)].join("\n");
}

/** Parse the metadata line from a commit body, or undefined when absent/invalid. */
export function parseMessage(message: string): SnapshotMeta | undefined {
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

function isMeta(value: unknown): value is SnapshotMeta {
	if (!value || typeof value !== "object") return false;
	const meta = value as Partial<SnapshotMeta>;
	return (
		meta.v === META_VERSION &&
		typeof meta.id === "string" &&
		meta.id.length > 0 &&
		typeof meta.head === "string" &&
		typeof meta.root === "string" &&
		typeof meta.timestamp === "number" &&
		typeof meta.clean === "boolean" &&
		typeof meta.includeUntracked === "boolean" &&
		typeof meta.sessionId === "string" &&
		(meta.entryId === null || typeof meta.entryId === "string") &&
		(meta.prompt === undefined || typeof meta.prompt === "string") &&
		REASONS.includes(meta.reason as SnapshotReason)
	);
}

export interface ListOptions {
	/** Only return snapshots whose recorded root matches. */
	root?: string;
}

/** All valid snapshots under `namespace`, newest first. */
export async function listSnapshots(
	runGit: RunGit,
	cwd: string,
	namespace: string,
	options: ListOptions = {},
): Promise<Snapshot[]> {
	const refs = await listRefs(runGit, cwd, namespace);
	if (refs.size === 0) return [];

	const entries = [...refs.entries()].map(([ref, commit]) => ({ ref, commit }));
	const messages = await commitMessages(
		runGit,
		cwd,
		entries.map((entry) => entry.commit),
	);

	const snapshots: Snapshot[] = [];
	for (const entry of entries) {
		const meta = parseMessage(messages.get(entry.commit) ?? "");
		if (!meta) continue;
		// Trust the ref for identity, so a rewritten message cannot alias another ref.
		const id = idFromRef(namespace, entry.ref) ?? meta.id;
		const snapshot: Snapshot = { ...meta, id, ref: entry.ref, commit: entry.commit };
		if (options.root !== undefined && snapshot.root !== options.root) continue;
		snapshots.push(snapshot);
	}
	snapshots.sort((a, b) => b.timestamp - a.timestamp || b.id.localeCompare(a.id));
	return snapshots;
}

/** Delete the given refs. Failures are reported as a count, not thrown. */
export async function deleteSnapshots(runGit: RunGit, cwd: string, snapshots: Snapshot[]): Promise<number> {
	let removed = 0;
	for (const snapshot of snapshots) {
		try {
			await deleteRef(runGit, cwd, snapshot.ref);
			removed += 1;
		} catch {
			// A ref deleted by a concurrent session is fine to ignore.
		}
	}
	return removed;
}

/** Delete the oldest snapshots for `root` beyond `max`; returns the count. */
export async function pruneSnapshots(
	runGit: RunGit,
	cwd: string,
	namespace: string,
	max: number,
	root: string,
): Promise<number> {
	if (max < 0) return 0;
	const snapshots = await listSnapshots(runGit, cwd, namespace, { root });
	if (snapshots.length <= max) return 0;
	return deleteSnapshots(runGit, cwd, snapshots.slice(max));
}
