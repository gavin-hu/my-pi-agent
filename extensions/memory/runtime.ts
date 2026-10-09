/**
 * Session-scoped memory state for the memory extension.
 *
 * Resolves the two store paths once per session, reads the notes, and keeps them
 * in memory so the injected context and the tool read a consistent view. The
 * project store is loaded and written only while the project is trusted.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DEFAULT_MEMORY_CONFIG, type MemoryConfig } from "./config.ts";
import { type MemoryEntries, scopeLabel } from "./format.ts";
import {
	applyAdd,
	applyClear,
	applyForget,
	mutateMemoryFile,
	parseEntries,
	readMemoryFile,
	resolveMemoryPaths,
	type MemoryPaths,
} from "./store.ts";
import type { MemoryScope } from "./types.ts";

export interface MemoryRuntime {
	/** Resolve paths and load notes for a session; returns a warning message, if any. */
	load(cwd: string, trusted: boolean): Promise<string | undefined>;
	/** Replace the recall config (loaded per session). */
	setConfig(config: MemoryConfig): void;
	config(): MemoryConfig;
	paths(): MemoryPaths | undefined;
	trusted(): boolean;
	/** Copies of the current notes, safe for callers to hold. */
	entries(): MemoryEntries;
	/** Read one store's raw text, for `/memory edit`. */
	raw(scope: MemoryScope): string;
	/** Replace one store's raw text, for `/memory edit`. */
	write(scope: MemoryScope, content: string): Promise<void>;
	/** Returns whether the store changed. */
	add(scope: MemoryScope, entry: string): Promise<boolean>;
	forget(scope: MemoryScope, entry: string): Promise<boolean>;
	clear(scope: MemoryScope): Promise<boolean>;
	/** Drop cached state on shutdown. */
	reset(): void;
}

export function createMemoryRuntime(pi: Pick<ExtensionAPI, "exec">): MemoryRuntime {
	let paths: MemoryPaths | undefined;
	let config: MemoryConfig = DEFAULT_MEMORY_CONFIG;
	let trusted = false;
	let entries: MemoryEntries = { project: [], global: [] };

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
			return warnings.length > 0 ? warnings.join(" ") : undefined;
		},
		setConfig: (next) => {
			config = next;
		},
		config: () => config,
		paths: () => paths,
		trusted: () => trusted,
		entries: () => ({ project: [...entries.project], global: [...entries.global] }),
		raw: (scope) => readMemoryFile(pathFor(scope)),
		async write(scope, content) {
			requireTrusted(scope);
			await mutateMemoryFile(pathFor(scope), () => ({ content, changed: true }));
			setEntries(scope, parseEntries(content));
		},
		async add(scope, entry) {
			requireTrusted(scope);
			const result = await mutateMemoryFile(pathFor(scope), (content) => applyAdd(content, entry));
			setEntries(scope, result.entries);
			return result.changed;
		},
		async forget(scope, entry) {
			requireTrusted(scope);
			const result = await mutateMemoryFile(pathFor(scope), (content) => applyForget(content, entry));
			setEntries(scope, result.entries);
			return result.changed;
		},
		async clear(scope) {
			requireTrusted(scope);
			const result = await mutateMemoryFile(pathFor(scope), applyClear);
			setEntries(scope, result.entries);
			return result.changed;
		},
		reset: () => {
			paths = undefined;
			config = DEFAULT_MEMORY_CONFIG;
			trusted = false;
			entries = { project: [], global: [] };
		},
	};
}
