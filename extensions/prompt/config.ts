/**
 * Config-file support for the prompt extension's refine flow.
 *
 * Read from `~/.pi/agent/prompt.json` and `<cwd>/.pi/prompt.json`; project
 * values override global ones, and missing or malformed files are ignored. The
 * file is read once per session, at `session_start`.
 */

import { clampInteger, loadConfigFile } from "../../lib/config.ts";

export interface PromptConfig {
	/** Whether submitted prompts are refined at all. */
	enabled: boolean;
	/** Upper bound on clarifying questions asked in one pass. */
	maxQuestions: number;
	/** Prompts shorter than this are never refined. */
	minLength: number;
	/** Recent user/assistant turns sent to the clarifier as context; 0 sends none. */
	contextMessages: number;
	/** Ask the user to confirm the assembled goal before submitting. */
	confirmGoal: boolean;
	/** Bound on the clarifier model call in milliseconds. */
	timeoutMs: number;
}

export const DEFAULT_PROMPT_CONFIG: PromptConfig = {
	enabled: true,
	maxQuestions: 3,
	minLength: 20,
	contextMessages: 2,
	confirmGoal: true,
	timeoutMs: 30_000,
};

/** Bounds published so the config, tests, and README agree. */
export const PROMPT_LIMITS = {
	maxQuestions: { min: 1, max: 4 },
	minLength: { min: 1, max: 500 },
	contextMessages: { min: 0, max: 10 },
	timeoutMs: { min: 1000, max: 120_000 },
} as const;

/** A boolean, or the fallback when the value does not say one. */
function booleanOr(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

/** Validate a raw config object over `base`. */
export function normalizePromptConfig(raw: Record<string, unknown> | undefined, base: PromptConfig): PromptConfig {
	if (!raw) return base;
	return {
		enabled: booleanOr(raw.enabled, base.enabled),
		maxQuestions: clampInteger(
			raw.maxQuestions,
			base.maxQuestions,
			PROMPT_LIMITS.maxQuestions.min,
			PROMPT_LIMITS.maxQuestions.max,
		),
		minLength: clampInteger(raw.minLength, base.minLength, PROMPT_LIMITS.minLength.min, PROMPT_LIMITS.minLength.max),
		contextMessages: clampInteger(
			raw.contextMessages,
			base.contextMessages,
			PROMPT_LIMITS.contextMessages.min,
			PROMPT_LIMITS.contextMessages.max,
		),
		confirmGoal: booleanOr(raw.confirmGoal, base.confirmGoal),
		timeoutMs: clampInteger(raw.timeoutMs, base.timeoutMs, PROMPT_LIMITS.timeoutMs.min, PROMPT_LIMITS.timeoutMs.max),
	};
}

/** Effective config for `cwd` (global file, then project file, over defaults). */
export function loadPromptConfig(cwd: string): PromptConfig {
	return loadConfigFile(cwd, "prompt.json", DEFAULT_PROMPT_CONFIG, normalizePromptConfig);
}
