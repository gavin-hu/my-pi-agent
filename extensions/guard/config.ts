/**
 * Configuration for the guard extension.
 *
 * Merged from ~/.pi/agent/guard.json (global) and <cwd>/.pi/guard.json
 * (project). Project values win. Everything is validated: unknown fields are
 * ignored, numbers are clamped, and invalid regexes are dropped by the
 * consumers that compile them.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";

export interface GuardProtectedConfig {
	/** Gitignore-style patterns matched against the repo-relative path. `!` re-allows. */
	paths: string[];
	/** What to do when a write/edit touches a protected path. */
	action: "block" | "confirm";
}

export interface GuardCommandConfig {
	/** Keep the built-in dangerous-command checks. */
	includeBuiltins: boolean;
	/** Extra regex sources that always block, added to the built-ins. */
	block: string[];
	/** Extra regex sources that require confirmation, added to the built-ins. */
	confirm: string[];
	/** Regex sources; a match short-circuits to allow (overrides block/confirm). */
	allow: string[];
}

export interface GuardAnnotationConfig {
	/** Confirm any tool whose `annotations.destructiveHint` is true. */
	confirmDestructive: boolean;
	/** Also confirm tools with no hints that are not read-only (broad MCP heuristic). */
	confirmMissingHints: boolean;
}

export interface GuardConfig {
	/** Master switch. */
	enabled: boolean;
	protected: GuardProtectedConfig;
	commands: GuardCommandConfig;
	annotations: GuardAnnotationConfig;
	/** A confirm verdict with no UI: block (fail-safe) or allow. */
	nonInteractive: "block" | "allow";
	/** Remember an approved command/path for the rest of the session. */
	rememberConfirmations: boolean;
	/** Auto-dismiss a confirmation dialog after this many ms (0 = never). */
	confirmTimeoutMs: number;
}

export const DEFAULT_PROTECTED_PATHS = [
	".env",
	".env.*",
	"!.env.example",
	".git",
	".git/**",
	"**/node_modules/**",
	"**/.ssh/**",
	"**/.aws/**",
	"**/.gnupg/**",
	"**/*.pem",
	"**/*.key",
	"**/*.p12",
	"**/id_rsa",
	"**/id_ed25519",
	"bun.lock",
	"package-lock.json",
	"pnpm-lock.yaml",
	"yarn.lock",
];

export const DEFAULT_CONFIG: GuardConfig = {
	enabled: true,
	protected: {
		paths: [...DEFAULT_PROTECTED_PATHS],
		action: "block",
	},
	commands: {
		includeBuiltins: true,
		block: [],
		confirm: [],
		allow: [],
	},
	annotations: {
		confirmDestructive: true,
		confirmMissingHints: false,
	},
	nonInteractive: "block",
	rememberConfirmations: true,
	confirmTimeoutMs: 120_000,
};

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
	const number = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(number)) return fallback;
	return Math.min(max, Math.max(min, Math.round(number)));
}

function stringListOrEmpty(value: unknown, fallback: string[]): string[] {
	if (!Array.isArray(value)) return fallback;
	return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

function readJson(path: string): Record<string, unknown> | undefined {
	try {
		if (!existsSync(path)) return undefined;
		const parsed = JSON.parse(readFileSync(path, "utf-8"));
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
}

function asObject(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/** Validate and clamp a raw config object over a base config. */
export function normalizeConfig(
	raw: Record<string, unknown> | undefined,
	base: GuardConfig = DEFAULT_CONFIG,
): GuardConfig {
	if (!raw) return base;

	const protectedRaw = asObject(raw.protected);
	const commandsRaw = asObject(raw.commands);
	const annotationsRaw = asObject(raw.annotations);

	const protectedPaths = protectedRaw?.paths;
	const action = protectedRaw?.action;

	return {
		enabled: typeof raw.enabled === "boolean" ? raw.enabled : base.enabled,
		protected: {
			// An explicit empty array is meaningful: it disables path protection.
			paths: Array.isArray(protectedPaths) ? stringListOrEmpty(protectedPaths, base.protected.paths) : base.protected.paths,
			action: action === "confirm" || action === "block" ? action : base.protected.action,
		},
		commands: {
			includeBuiltins:
				typeof commandsRaw?.includeBuiltins === "boolean"
					? commandsRaw.includeBuiltins
					: base.commands.includeBuiltins,
			block: stringListOrEmpty(commandsRaw?.block, base.commands.block),
			confirm: stringListOrEmpty(commandsRaw?.confirm, base.commands.confirm),
			allow: stringListOrEmpty(commandsRaw?.allow, base.commands.allow),
		},
		annotations: {
			confirmDestructive:
				typeof annotationsRaw?.confirmDestructive === "boolean"
					? annotationsRaw.confirmDestructive
					: base.annotations.confirmDestructive,
			confirmMissingHints:
				typeof annotationsRaw?.confirmMissingHints === "boolean"
					? annotationsRaw.confirmMissingHints
					: base.annotations.confirmMissingHints,
		},
		nonInteractive: raw.nonInteractive === "allow" || raw.nonInteractive === "block" ? raw.nonInteractive : base.nonInteractive,
		rememberConfirmations:
			typeof raw.rememberConfirmations === "boolean" ? raw.rememberConfirmations : base.rememberConfirmations,
		confirmTimeoutMs: clampInteger(raw.confirmTimeoutMs, base.confirmTimeoutMs, 0, 3_600_000),
	};
}

/**
 * Load the effective config for a working directory: defaults, then the global
 * file, then the project file. Missing or malformed files are ignored.
 */
export function loadConfig(cwd: string): GuardConfig {
	let config = DEFAULT_CONFIG;
	config = normalizeConfig(readJson(join(getAgentDir(), "guard.json")), config);
	config = normalizeConfig(readJson(join(cwd, CONFIG_DIR_NAME, "guard.json")), config);
	return config;
}
