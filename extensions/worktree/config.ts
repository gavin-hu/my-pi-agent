/**
 * Configuration for the worktree extension.
 *
 * Merged from ~/.pi/agent/worktree.json (global) and <repo>/.pi/worktree.json
 * (project). Project values win.
 */

import { join } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
import { clampInteger, cleanString, readJson } from "../../lib/config.ts";

export interface WorktreeGuardConfig {
	/** Block write/edit whose resolved path leaves the active worktree. Default: true */
	blockFileEscapes: boolean;
	/** Also block read-only tools (read/grep/find/ls) from leaving the worktree. Default: false */
	blockReadEscapes: boolean;
	/** Block git commands redirected at the main checkout. Default: true */
	blockGitRedirects: boolean;
	/** Block writes whose real path leaves the worktree through a symlink. Default: true */
	blockSymlinkEscapes: boolean;
	/** Block commands whose git behavior cannot be verified. Default: false */
	blockUnparsableCommands: boolean;
}

export interface WorktreeConfig {
	/** Directory for managed worktrees, relative to the repository root. */
	dir: string;
	/** "fresh" branches from the remote default branch; "head" from local HEAD. */
	baseRef: "fresh" | "head";
	branchPrefix: string;
	fetchRemote: boolean;
	fetchTimeoutMs: number;
	/** Cleanup behavior on exit: ask, always keep, or always remove. */
	onExit: "ask" | "keep" | "remove";
	/** Age in days after which `/worktree prune` removes a clean, unused worktree. */
	pruneAfterDays: number;
	/** Gitignored file globs copied into new worktrees; fallback when `.worktreeinclude` is absent. */
	include: string[];
	/** Built-in tool names not to override (for example ["bash"] to keep another extension's). */
	skipOverrides: string[];
	guard: WorktreeGuardConfig;
}

export const DEFAULT_CONFIG: WorktreeConfig = {
	dir: `${CONFIG_DIR_NAME}/worktrees`,
	baseRef: "fresh",
	branchPrefix: "worktree-",
	fetchRemote: true,
	fetchTimeoutMs: 5000,
	onExit: "ask",
	pruneAfterDays: 7,
	include: [],
	skipOverrides: [],
	guard: {
		blockFileEscapes: true,
		blockReadEscapes: false,
		blockGitRedirects: true,
		blockSymlinkEscapes: true,
		blockUnparsableCommands: false,
	},
};

function booleanOr(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

/** Keep only trimmed, non-empty strings from an untrusted array. */
function stringList(value: unknown, fallback: string[]): string[] {
	if (!Array.isArray(value)) return fallback;
	return value
		.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
		.map((item) => item.trim());
}

function normalizeGuard(raw: unknown, base: WorktreeGuardConfig): WorktreeGuardConfig {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
	const value = raw as Record<string, unknown>;
	return {
		blockFileEscapes: booleanOr(value.blockFileEscapes, base.blockFileEscapes),
		blockReadEscapes: booleanOr(value.blockReadEscapes, base.blockReadEscapes),
		blockGitRedirects: booleanOr(value.blockGitRedirects, base.blockGitRedirects),
		blockSymlinkEscapes: booleanOr(value.blockSymlinkEscapes, base.blockSymlinkEscapes),
		blockUnparsableCommands: booleanOr(value.blockUnparsableCommands, base.blockUnparsableCommands),
	};
}

/** Normalize one merged config object over the running base. */
export function normalizeConfig(raw: Record<string, unknown> | undefined, base: WorktreeConfig): WorktreeConfig {
	if (!raw) return base;
	return {
		dir: cleanString(raw.dir, base.dir),
		baseRef: raw.baseRef === "head" || raw.baseRef === "fresh" ? raw.baseRef : base.baseRef,
		branchPrefix: cleanString(raw.branchPrefix, base.branchPrefix),
		fetchRemote: booleanOr(raw.fetchRemote, base.fetchRemote),
		fetchTimeoutMs: clampInteger(raw.fetchTimeoutMs, base.fetchTimeoutMs, 0, 600_000),
		onExit: raw.onExit === "ask" || raw.onExit === "keep" || raw.onExit === "remove" ? raw.onExit : base.onExit,
		pruneAfterDays: clampInteger(raw.pruneAfterDays, base.pruneAfterDays, 0, 3650),
		include: stringList(raw.include, base.include),
		skipOverrides: stringList(raw.skipOverrides, base.skipOverrides),
		guard: normalizeGuard(raw.guard, base.guard),
	};
}

/** Load the effective config for a repository root. */
export function loadConfig(repoRoot: string, agentDir: string = getAgentDir()): WorktreeConfig {
	let config = normalizeConfig(readJson(join(agentDir, "worktree.json")), DEFAULT_CONFIG);
	config = normalizeConfig(readJson(join(repoRoot, CONFIG_DIR_NAME, "worktree.json")), config);
	return config;
}
