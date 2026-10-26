/**
 * Shared runtime state for the worktree extension.
 *
 * Pi loads one extension factory per runtime, and every tool, command, and
 * event handler shares the active worktree, cached config, and process-level
 * hooks defined here. Keeping them in one module lets the lifecycle, tool, and
 * command modules stay stateless functions.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { STATUS_KEYS } from "../../lib/tui/glyphs.ts";
import { ENV_ROOT } from "../../lib/env.ts";
import { loadConfig, type WorktreeConfig } from "./config.ts";
import type { WorktreeState } from "./state.ts";

const STATUS_KEY = STATUS_KEYS.worktree;

/** Environment variables a parent session passes to child processes (subagents). */
export { ENV_ROOT };
export const ENV_BRANCH = "PI_WORKTREE_BRANCH";
/** Main checkout a borrowed worktree forked from, so a child knows its `repoRoot`. */
export const ENV_MAIN = "PI_WORKTREE_MAIN";

/**
 * The channel `publishWorktree` announces on, for another extension that follows the active
 * root without polling; `docs/extensions/worktree.md` names it as the contract.
 *
 * Not exported: the channel is an event name on `pi.events`, so what crosses the boundary
 * is the string a listener subscribes to, and the constant is this module's own.
 */
const WORKTREE_EVENT_CHANNEL = "worktree:changed";

let active: WorktreeState | null = null;
/** Directory to use when not isolated (the session cwd at startup). */
let baseCwd = process.cwd();
let inactiveOverrides: string[] = [];
let gitignoreOffered = false;
/** Commands this session let through although the guard could not verify them. */
let unverifiableCommands = 0;
const configCache = new Map<string, WorktreeConfig>();

export function getActive(): WorktreeState | null {
	return active;
}

export function setActive(state: WorktreeState | null): void {
	active = state;
}

/** Root every path-taking tool resolves against. */
export function getRoot(): string {
	return active ? active.path : baseCwd;
}

export function setBaseCwd(cwd: string): void {
	baseCwd = cwd;
}

/**
 * Overridden tools whose effective implementation is not ours, because
 * `skipOverrides` excluded them or the config could not be read.
 */
export function getInactiveOverrides(): string[] {
	return inactiveOverrides;
}

export function setInactiveOverrides(names: string[]): void {
	inactiveOverrides = names;
}

export function isGitignoreOffered(): boolean {
	return gitignoreOffered;
}

export function markGitignoreOffered(): void {
	gitignoreOffered = true;
}

/** Re-arm the offer for the next session; `session_start` owns the reset. */
export function resetGitignoreOffer(): void {
	gitignoreOffered = false;
}

/**
 * Count a bash command the guard let through without being able to verify it.
 * Session-scoped on purpose: it is the one gap a user cannot see in the
 * transcript, so `/worktree` reports how often it happened.
 */
export function noteUnverifiableCommand(): void {
	unverifiableCommands += 1;
}

export function getUnverifiableCommands(): number {
	return unverifiableCommands;
}

/** Forget the previous session's diagnostics; called from `session_start`. */
export function resetDiagnostics(): void {
	unverifiableCommands = 0;
}

/** Cached config for the hot `tool_call` path; cleared on enter and exit. */
export function configFor(root: string): WorktreeConfig {
	let config = configCache.get(root);
	if (!config) {
		config = loadConfig(root);
		configCache.set(root, config);
	}
	return config;
}

export function clearConfigCache(): void {
	configCache.clear();
}

export function getSkipOverrides(): string[] {
	try {
		return configFor(active?.repoRoot ?? baseCwd).skipOverrides;
	} catch {
		return [];
	}
}

export function setStatus(ctx: ExtensionContext, text: string | undefined): void {
	try {
		ctx.ui.setStatus(STATUS_KEY, text);
	} catch {
		// UI may be unavailable (print/json modes, shutdown).
	}
}

export function lockReasonFor(ctx: ExtensionContext): string {
	return `pi:${process.pid}:${ctx.sessionManager.getSessionId()}`;
}

/** Notify other extensions (and the subagent extension) about the active worktree. */
export function publishWorktree(pi: ExtensionAPI, state: WorktreeState | null): void {
	try {
		pi.events.emit(
			WORKTREE_EVENT_CHANNEL,
			state ? { active: true, path: state.path, branch: state.branch, borrowed: !!state.borrowed } : { active: false },
		);
	} catch {
		// Event bus is optional.
	}
}

/**
 * Export the active worktree to the process environment. Child `pi` processes
 * (subagents) inherit it and bind to the same worktree instead of the main
 * checkout; see the borrowed-worktree path in `index.ts`.
 */
export function applyWorktreeEnv(state: WorktreeState | null): void {
	if (state && !state.borrowed) {
		process.env[ENV_ROOT] = state.path;
		process.env[ENV_MAIN] = state.repoRoot;
		if (state.branch) process.env[ENV_BRANCH] = state.branch;
		else delete process.env[ENV_BRANCH];
		return;
	}
	if (!state) {
		delete process.env[ENV_ROOT];
		delete process.env[ENV_BRANCH];
		delete process.env[ENV_MAIN];
	}
}
