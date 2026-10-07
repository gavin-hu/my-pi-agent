/**
 * Configuration for the checkpoint extension.
 *
 * Merged from `~/.pi/agent/checkpoint.json` (global) and
 * `<root>/.pi/checkpoint.json` (project). Project values win. Missing or
 * malformed files are ignored, and every value is clamped to a safe range.
 */

import { clampInteger, cleanString, loadConfigFile } from "../_shared/config.ts";
import { CHECKPOINT_MODES, type CheckpointMode } from "./types.ts";

export interface CheckpointConfig {
	/** Take automatic snapshots at all. Default: true. */
	enabled: boolean;
	/** Automatic snapshot granularity: one per turn, per mutating call, or off. */
	mode: CheckpointMode;
	/** Ref count kept per root before the oldest are pruned on save. */
	max: number;
	/** Include untracked, non-ignored files in a snapshot. Default: true. */
	includeUntracked: boolean;
	/** Snapshot the current state before a restore, so a rewind is undoable. */
	safetyCheckpoint: boolean;
	/** Prune oldest refs beyond `max` after saving. */
	autoPrune: boolean;
	/** Show a `⧉ N` status chip while the session runs. */
	showStatus: boolean;
	/** Extra tool names to treat as mutating for automatic snapshots. */
	watch: string[];
	/** Tool names never to snapshot; the extension's own tools are always excluded. */
	ignore: string[];
	/** Ref namespace for stored checkpoints. */
	refNamespace: string;
}

export const DEFAULT_CONFIG: CheckpointConfig = {
	enabled: true,
	mode: "turn",
	max: 20,
	includeUntracked: true,
	safetyCheckpoint: true,
	autoPrune: true,
	showStatus: true,
	watch: [],
	ignore: [],
	refNamespace: "refs/pi/checkpoints",
};

/** Keep only trimmed, non-empty strings from an untrusted array. */
function stringList(value: unknown, fallback: string[]): string[] {
	if (!Array.isArray(value)) return fallback;
	return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
}

/** Normalize one merged config object over the running base. */
export function normalizeConfig(raw: Record<string, unknown> | undefined, base: CheckpointConfig): CheckpointConfig {
	if (!raw) return base;
	const mode = cleanString(raw.mode, base.mode);
	return {
		enabled: typeof raw.enabled === "boolean" ? raw.enabled : base.enabled,
		mode: (CHECKPOINT_MODES as readonly string[]).includes(mode) ? (mode as CheckpointMode) : base.mode,
		max: clampInteger(raw.max, base.max, 0, 1000),
		includeUntracked: typeof raw.includeUntracked === "boolean" ? raw.includeUntracked : base.includeUntracked,
		safetyCheckpoint: typeof raw.safetyCheckpoint === "boolean" ? raw.safetyCheckpoint : base.safetyCheckpoint,
		autoPrune: typeof raw.autoPrune === "boolean" ? raw.autoPrune : base.autoPrune,
		showStatus: typeof raw.showStatus === "boolean" ? raw.showStatus : base.showStatus,
		watch: stringList(raw.watch, base.watch),
		ignore: stringList(raw.ignore, base.ignore),
		refNamespace: cleanString(raw.refNamespace, base.refNamespace).replace(/\/+$/, ""),
	};
}

/** Load the effective config for a repository root. */
export function loadConfig(root: string): CheckpointConfig {
	return loadConfigFile(root, "checkpoint.json", DEFAULT_CONFIG, normalizeConfig);
}
