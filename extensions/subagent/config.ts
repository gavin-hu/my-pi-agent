/**
 * Config-file support for subagent runs.
 *
 * The `subagent` section of the shared `bytefly.json` (global then project,
 * project wins). Only the container is configurable — a run's deadline and
 * whether it keeps a transcript on disk — never an agent's prompt or tools.
 */

import { clampInteger, loadConfigSection } from "../../lib/config.ts";

/** Which finished runs keep a transcript on disk. */
export const TRANSCRIPT_MODES = ["off", "failed", "all"] as const;

/** One of {@link TRANSCRIPT_MODES}. */
export type TranscriptMode = (typeof TRANSCRIPT_MODES)[number];

export interface SubagentConfig {
	/** Wall-clock limit for one child run in ms; `0` disables it. */
	timeoutMs: number;
	/** Which runs write a transcript under `.pi/subagents/`. */
	transcripts: TranscriptMode;
	/** Age in days after which a run directory is pruned at session start. */
	retentionDays: number;
	/** Most run directories kept, oldest pruned first. */
	maxRuns: number;
	/** Background children allowed to run at once. */
	backgroundMax: number;
}

export const DEFAULT_SUBAGENT_CONFIG: SubagentConfig = {
	timeoutMs: 600_000,
	transcripts: "off",
	retentionDays: 14,
	maxRuns: 100,
	backgroundMax: 4,
};

/** An unknown value read as one of {@link TRANSCRIPT_MODES}, or `fallback`. */
function asTranscriptMode(value: unknown, fallback: TranscriptMode): TranscriptMode {
	if (typeof value !== "string") return fallback;
	return TRANSCRIPT_MODES.find((mode) => mode === value) ?? fallback;
}

/** Validate a raw config object over `base`. */
export function normalizeSubagentConfig(
	raw: Record<string, unknown> | undefined,
	base: SubagentConfig,
): SubagentConfig {
	if (!raw) return base;
	return {
		timeoutMs: clampInteger(raw.timeoutMs, base.timeoutMs, 0, 3_600_000),
		transcripts: asTranscriptMode(raw.transcripts, base.transcripts),
		retentionDays: clampInteger(raw.retentionDays, base.retentionDays, 1, 3650),
		maxRuns: clampInteger(raw.maxRuns, base.maxRuns, 1, 1000),
		backgroundMax: clampInteger(raw.backgroundMax, base.backgroundMax, 1, 8),
	};
}

/** Effective subagent config from the shared `subagent` section. */
export function loadSubagentConfig(cwd: string): SubagentConfig {
	return loadConfigSection(cwd, "subagent", DEFAULT_SUBAGENT_CONFIG, normalizeSubagentConfig);
}
