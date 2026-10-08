/**
 * Configuration for the rewind extension.
 *
 * Merged from `~/.pi/agent/rewind.json` (global) and
 * `<root>/.pi/rewind.json` (project). Project values win. Missing or malformed
 * files are ignored, and every value is clamped to a safe range.
 */

import { clampInteger, cleanString, loadConfigFile } from "../../../lib/config.ts";

export interface RewindConfig {
	/** Take one automatic snapshot per user prompt. Default: true. */
	autoSnapshots: boolean;
	/** Ref count kept per root before the oldest are pruned on save. */
	max: number;
	/** Include untracked, non-ignored files in a snapshot. Default: true. */
	includeUntracked: boolean;
	/** Snapshot the current state before a restore, so a rewind is undoable. */
	safetySnapshot: boolean;
	/** Prune oldest refs beyond `max` after saving. */
	autoPrune: boolean;
	/** Show a `↺ N` status chip while the session runs. */
	showStatus: boolean;
	/** Extra tool names to treat as mutating for automatic snapshots. */
	watch: string[];
	/** Tool names never to snapshot; the extension's own tools are always excluded. */
	ignore: string[];
	/** Ref namespace for stored snapshots. */
	refNamespace: string;
}

export const DEFAULT_CONFIG: RewindConfig = {
	autoSnapshots: true,
	max: 20,
	includeUntracked: true,
	safetySnapshot: true,
	autoPrune: true,
	showStatus: true,
	watch: [],
	ignore: [],
	refNamespace: "refs/pi/rewind",
};

/** Keep only trimmed, non-empty strings from an untrusted array. */
function stringList(value: unknown, fallback: string[]): string[] {
	if (!Array.isArray(value)) return fallback;
	return value
		.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
		.map((item) => item.trim());
}

/** Normalize one merged config object over the running base. */
export function normalizeConfig(raw: Record<string, unknown> | undefined, base: RewindConfig): RewindConfig {
	if (!raw) return base;
	return {
		autoSnapshots: typeof raw.autoSnapshots === "boolean" ? raw.autoSnapshots : base.autoSnapshots,
		max: clampInteger(raw.max, base.max, 0, 1000),
		includeUntracked: typeof raw.includeUntracked === "boolean" ? raw.includeUntracked : base.includeUntracked,
		safetySnapshot: typeof raw.safetySnapshot === "boolean" ? raw.safetySnapshot : base.safetySnapshot,
		autoPrune: typeof raw.autoPrune === "boolean" ? raw.autoPrune : base.autoPrune,
		showStatus: typeof raw.showStatus === "boolean" ? raw.showStatus : base.showStatus,
		watch: stringList(raw.watch, base.watch),
		ignore: stringList(raw.ignore, base.ignore),
		refNamespace: cleanString(raw.refNamespace, base.refNamespace).replace(/\/+$/, ""),
	};
}

/** Load the effective config for a repository root. */
export function loadConfig(root: string): RewindConfig {
	return loadConfigFile(root, "rewind.json", DEFAULT_CONFIG, normalizeConfig);
}
