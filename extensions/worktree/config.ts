/**
 * Configuration for the worktree extension.
 *
 * The `worktree` section of the shared `bytefly.json`, merged from
 * `~/.pi/agent/bytefly.json` (global, through the agent directory) and
 * `<repo>/.pi/bytefly.json` (project). Project values win.
 */

import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
import { asBoolean, cleanString, clampInteger, loadConfigSection, stringList } from "../../lib/config.ts";

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
	/**
	 * Refuse the `powershell` tool while isolated. Default: true
	 *
	 * Pi's `powershell` tool is neither re-rooted nor guarded — a second grammar
	 * (backtick escapes, `Set-Location`, `$env:GIT_DIR`) would need a second parser —
	 * so inside a worktree its relative paths resolve at the main checkout. Refusing
	 * it is the only honest isolation; `false` allows it and is reported as a gap.
	 */
	blockPowershell: boolean;
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
		blockPowershell: true,
	},
};

function normalizeGuard(raw: unknown, base: WorktreeGuardConfig): WorktreeGuardConfig {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
	const value = raw as Record<string, unknown>;
	return {
		blockFileEscapes: asBoolean(value.blockFileEscapes, base.blockFileEscapes),
		blockReadEscapes: asBoolean(value.blockReadEscapes, base.blockReadEscapes),
		blockGitRedirects: asBoolean(value.blockGitRedirects, base.blockGitRedirects),
		blockSymlinkEscapes: asBoolean(value.blockSymlinkEscapes, base.blockSymlinkEscapes),
		blockUnparsableCommands: asBoolean(value.blockUnparsableCommands, base.blockUnparsableCommands),
		blockPowershell: asBoolean(value.blockPowershell, base.blockPowershell),
	};
}

/** Normalize one merged config object over the running base. */
export function normalizeConfig(raw: Record<string, unknown> | undefined, base: WorktreeConfig): WorktreeConfig {
	if (!raw) return base;
	return {
		dir: cleanString(raw.dir, base.dir),
		baseRef: raw.baseRef === "head" || raw.baseRef === "fresh" ? raw.baseRef : base.baseRef,
		branchPrefix: cleanString(raw.branchPrefix, base.branchPrefix),
		fetchRemote: asBoolean(raw.fetchRemote, base.fetchRemote),
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
	return loadConfigSection(repoRoot, "worktree", DEFAULT_CONFIG, normalizeConfig, { agentDir });
}
