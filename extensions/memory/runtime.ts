/**
 * Session-scoped memory state for the memory extension.
 *
 * Resolves the two store paths once per session, reads the notes, and keeps them
 * in memory so the injected context and the tool read a consistent view. That
 * cache is validated against a per-store file stamp before every read, so an
 * external edit lands without a restart. The project store is loaded and written
 * only while the project is trusted.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DEFAULT_MEMORY_CONFIG, type MemoryConfig } from "./config.ts";
import { type MemoryEntries, scopeLabel } from "./format.ts";
import {
	applyAdd,
	applyClear,
	applyForget,
	applyMerge,
	applyUpdate,
	memoryFileStamp,
	mutateMemoryFile,
	parseEntries,
	readMemoryFile,
	resolveMemoryPaths,
	sameStamp,
	type MemoryFileStamp,
	type MemoryPaths,
} from "./store.ts";
import { MEMORY_SCOPES, type MemoryScope } from "./types.ts";

interface MemoryRefreshResult {
	/** Scopes whose on-disk content differed and was re-read. */
	changed: MemoryScope[];
	/** Joinable read errors; the affected scope kept its previous entries. */
	warning?: string;
}

/** Outcome of an `add`: `existing` names the stored note that matched, if any. */
interface AddResult {
	changed: boolean;
	existing?: string;
}

/** Outcome of a scope move: whether the source lost the note, and a target match. */
export interface MoveResult {
	moved: boolean;
	/** The note the target store already had, when it matched as a near-duplicate. */
	existing?: string;
}

export interface MemoryRuntime {
	/** Resolve paths and load notes for a session; returns a warning message, if any. */
	load(cwd: string, trusted: boolean): Promise<string | undefined>;
	/** Replace the recall config (loaded per session). */
	setConfig(config: MemoryConfig): void;
	config(): MemoryConfig;
	paths(): MemoryPaths | undefined;
	trusted(): boolean;
	/** Copies of the current notes, refreshed from disk first, safe to hold. */
	entries(): MemoryEntries;
	/** Re-read any store whose file changed on disk; never throws. */
	refresh(): MemoryRefreshResult;
	/** Read one store's raw text, for `/memory edit`. */
	raw(scope: MemoryScope): string;
	/** Replace one store's raw text, for `/memory edit`. */
	write(scope: MemoryScope, content: string): Promise<void>;
	/** Returns whether the store changed, and the matched note for a duplicate. */
	add(scope: MemoryScope, entry: string): Promise<AddResult>;
	update(scope: MemoryScope, from: string, to: string): Promise<boolean>;
	forget(scope: MemoryScope, entry: string): Promise<boolean>;
	clear(scope: MemoryScope): Promise<boolean>;
	/** File size of each store in bytes; `undefined` when it was not read. */
	sizes(): Record<MemoryScope, number | undefined>;
	/** Merge two notes in `scope` into one, in a single write. */
	merge(scope: MemoryScope, first: string, second: string, merged: string): Promise<boolean>;
	/**
	 * Move a note from one scope to the other: written to the target first, then
	 * removed from the source, so a failure between the two leaves a duplicate
	 * rather than losing the note.
	 */
	move(from: MemoryScope, to: MemoryScope, entry: string): Promise<MoveResult>;
	/** Drop cached state on shutdown. */
	reset(): void;
}

export function createMemoryRuntime(pi: Pick<ExtensionAPI, "exec">): MemoryRuntime {
	let paths: MemoryPaths | undefined;
	let config: MemoryConfig = DEFAULT_MEMORY_CONFIG;
	let trusted = false;
	let entries: MemoryEntries = { project: [], global: [] };
	let stamps: Record<MemoryScope, MemoryFileStamp | undefined> = { project: undefined, global: undefined };

	const pathFor = (scope: MemoryScope): string => {
		if (!paths) throw new Error("memory is not initialized yet.");
		return scope === "global" ? paths.global : paths.project;
	};

	const requireTrusted = (scope: MemoryScope): void => {
		if (scope === "project" && !trusted) {
			throw new Error(`Project memory is unavailable for an untrusted project; use scope "${scopeLabel("global")}".`);
		}
	};

	const setEntries = (scope: MemoryScope, next: string[]): void => {
		entries = { ...entries, [scope]: next };
	};

	const stampOf = (scope: MemoryScope): MemoryFileStamp | undefined => {
		try {
			return memoryFileStamp(pathFor(scope));
		} catch {
			return undefined;
		}
	};

	/** Adopt freshly read notes and record the stamp they were read at, so a
	 * self-write is not mistaken for an external change. */
	const commit = (scope: MemoryScope, next: string[]): void => {
		setEntries(scope, next);
		stamps = { ...stamps, [scope]: stampOf(scope) };
	};

	const refresh = (): MemoryRefreshResult => {
		const changed: MemoryScope[] = [];
		const warnings: string[] = [];
		if (!paths) return { changed };
		for (const scope of MEMORY_SCOPES) {
			if (scope === "project" && !trusted) {
				// Never cache a stamp for a store we are not allowed to read.
				stamps = { ...stamps, project: undefined };
				continue;
			}
			const stamp = stampOf(scope);
			if (sameStamp(stamp, stamps[scope])) continue;
			try {
				const next = parseEntries(readMemoryFile(pathFor(scope)));
				commit(scope, next);
				changed.push(scope);
			} catch (error) {
				// Keep the last good view and its stamp, so the next read retries.
				warnings.push(error instanceof Error ? error.message : String(error));
			}
		}
		return warnings.length > 0 ? { changed, warning: warnings.join(" ") } : { changed };
	};

	return {
		async load(cwd, isTrusted) {
			trusted = isTrusted;
			const resolved = await resolveMemoryPaths(pi, cwd);
			paths = resolved;
			const warnings: string[] = [];
			const read = (scope: MemoryScope): string[] => {
				const path = scope === "global" ? resolved.global : resolved.project;
				try {
					return parseEntries(readMemoryFile(path));
				} catch (error) {
					warnings.push(error instanceof Error ? error.message : String(error));
					return [];
				}
			};
			entries = { global: read("global"), project: trusted ? read("project") : [] };
			stamps = { project: trusted ? stampOf("project") : undefined, global: stampOf("global") };
			return warnings.length > 0 ? warnings.join(" ") : undefined;
		},
		setConfig: (next) => {
			config = next;
		},
		config: () => config,
		paths: () => paths,
		sizes: () => {
			// A store we may not read reports no size, the same way `refresh` refuses
			// to cache a stamp for it.
			return {
				project: trusted ? stampOf("project")?.size : undefined,
				global: stampOf("global")?.size,
			};
		},
		trusted: () => trusted,
		entries: () => {
			refresh();
			return { project: [...entries.project], global: [...entries.global] };
		},
		refresh,
		raw: (scope) => readMemoryFile(pathFor(scope)),
		async write(scope, content) {
			requireTrusted(scope);
			await mutateMemoryFile(pathFor(scope), () => ({ content, changed: true }));
			commit(scope, parseEntries(content));
		},
		async add(scope, entry) {
			requireTrusted(scope);
			const result = await mutateMemoryFile(pathFor(scope), (content) => applyAdd(content, entry));
			commit(scope, result.entries);
			return result.existing === undefined
				? { changed: result.changed }
				: { changed: result.changed, existing: result.existing };
		},
		async forget(scope, entry) {
			requireTrusted(scope);
			const result = await mutateMemoryFile(pathFor(scope), (content) => applyForget(content, entry));
			commit(scope, result.entries);
			return result.changed;
		},
		async update(scope, from, to) {
			requireTrusted(scope);
			const result = await mutateMemoryFile(pathFor(scope), (content) => applyUpdate(content, from, to));
			commit(scope, result.entries);
			return result.changed;
		},
		async clear(scope) {
			requireTrusted(scope);
			const result = await mutateMemoryFile(pathFor(scope), applyClear);
			commit(scope, result.entries);
			return result.changed;
		},
		async merge(scope, first, second, merged) {
			requireTrusted(scope);
			const result = await mutateMemoryFile(pathFor(scope), (content) => applyMerge(content, first, second, merged));
			commit(scope, result.entries);
			return result.changed;
		},
		async move(from, to, entry) {
			if (from === to) throw new Error(`The note is already in ${scopeLabel(from)} memory.`);
			// Refuse before any write: an untrusted target, or a note that is not in the
			// source, must leave both stores exactly as they were.
			requireTrusted(to);
			// `entries()` refreshes both stores from disk first, so the check is against
			// what is on disk now, not the cache a previous call left behind.
			if (!this.entries()[from].includes(entry)) {
				throw new Error(`No ${scopeLabel(from)} memory note matches "${entry}".`);
			}
			// Target first: the one failure possible across two files then leaves the note
			// in both scopes, where `/memory doctor` reports it and `m` merges it, instead
			// of deleting the only copy.
			const added = await this.add(to, entry);
			const moved = await this.forget(from, entry);
			return added.existing === undefined ? { moved } : { moved, existing: added.existing };
		},
		reset: () => {
			paths = undefined;
			config = DEFAULT_MEMORY_CONFIG;
			trusted = false;
			entries = { project: [], global: [] };
			stamps = { project: undefined, global: undefined };
		},
	};
}
