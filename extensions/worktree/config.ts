/**
 * Configuration for the worktree extension.
 *
 * Merged from ~/.pi/agent/worktree.json (global) and <repo>/.pi/worktree.json
 * (project). Project values win.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";

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
	/** Age in days after which `/worktree-prune` removes a clean, unused worktree. */
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

function readJson(path: string): Partial<WorktreeConfig> | undefined {
	try {
		if (!existsSync(path)) return undefined;
		const parsed = JSON.parse(readFileSync(path, "utf-8"));
		return parsed && typeof parsed === "object" ? (parsed as Partial<WorktreeConfig>) : undefined;
	} catch {
		return undefined;
	}
}

function merge(base: WorktreeConfig, next: Partial<WorktreeConfig> | undefined): WorktreeConfig {
	if (!next) return base;
	return {
		...base,
		...next,
		guard: { ...base.guard, ...(next.guard ?? {}) },
		include: next.include ?? base.include,
		skipOverrides: next.skipOverrides ?? base.skipOverrides,
	};
}

/** Load the effective config for a repository root. */
export function loadConfig(repoRoot: string): WorktreeConfig {
	let config = merge(DEFAULT_CONFIG, readJson(join(getAgentDir(), "worktree.json")));
	config = merge(config, readJson(join(repoRoot, CONFIG_DIR_NAME, "worktree.json")));
	return config;
}
