/**
 * pi-worktree — Isolated git worktrees (EnterWorktree / ExitWorktree) for Pi.
 *
 * Mimics Claude Code's worktree isolation:
 *   - `worktree_enter` creates (or enters) an isolated `git worktree` under
 *     `.pi/worktrees/<name>` on branch `worktree-<name>`, and rebinds every
 *     path-taking tool to it.
 *   - `worktree_exit` returns to the main checkout and cleans up, checking for
 *     uncommitted work and unpushed commits first.
 *
 * Pi has no mutable session cwd and its built-ins capture cwd at construction,
 * so isolation is implemented by overriding the built-in tools at load time
 * (`root-tools.ts`) and re-rooting them at call time through the active root.
 *
 * This module wires the pieces together: shared state lives in `runtime.ts`,
 * the lifecycle in `lifecycle.ts`, and the model surface in `tools.ts` and
 * `commands.ts`.
 *
 * Load with:  pi --extension ./worktree
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { canonicalize, checkCheckout, repoRoot, unlockWorktree } from "./git.ts";
import { analyzeBashCommand, guardFileTool } from "./guard.ts";
import { enterWorktree, findInactiveOverrides, refusalMessage, worktreeLabel } from "./lifecycle.ts";
import { registerCommands } from "./commands.ts";
import { registerRootTools } from "./root-tools.ts";
import { loadState, persistState, type WorktreeState } from "./state.ts";
import { registerTools } from "./tools.ts";
import {
	ENV_BRANCH,
	ENV_ROOT,
	configFor,
	getActive,
	getInactiveOverrides,
	getRoot,
	getSkipOverrides,
	publishWorktree,
	setActive,
	setBaseCwd,
	setInactiveOverrides,
	setStatus,
} from "./runtime.ts";

export { WORKTREE_EVENT_CHANNEL } from "./runtime.ts";
export type { EnterOptions, ExitOptions } from "./lifecycle.ts";

/** This extension entry file, as Pi records it for our tool registrations. */
function extensionEntryPath(): string | undefined {
	try {
		return canonicalize(fileURLToPath(import.meta.url));
	} catch {
		return undefined;
	}
}

export default function (pi: ExtensionAPI) {
	registerRootTools(pi, { getRoot, getSkipOverrides });

	pi.registerFlag("worktree", {
		description: "Create or enter a git worktree at session start",
		type: "string",
	});

	// --- lifecycle ---------------------------------------------------------

	pi.on("session_start", async (event, ctx) => {
		setBaseCwd(ctx.cwd);
		setActive(null);

		// A child `pi` process (subagent) inherits an active worktree. Bind to
		// it without creating, locking, or persisting anything; the parent owns
		// the lifecycle. Only on a fresh process start: a `reload` re-runs this
		// factory inside the parent, which must restore its own recorded state.
		const envRoot = event.reason === "startup" ? process.env[ENV_ROOT] : undefined;
		if (envRoot) {
			const borrowedPath = canonicalize(envRoot);
			if (existsSync(borrowedPath) && (await repoRoot(pi, borrowedPath))) {
				const borrowed: WorktreeState = {
					active: true,
					borrowed: true,
					path: borrowedPath,
					branch: process.env[ENV_BRANCH],
					repoRoot: borrowedPath,
					baseRef: "HEAD",
					baseRefMode: "head",
					createdByUs: false,
				};
				setActive(borrowed);
				setStatus(ctx, `⧉ ${worktreeLabel(borrowed)} (inherited)`);
				publishWorktree(pi, borrowed);
				ctx.ui.notify(`Using parent worktree ${borrowed.path}`, "info");
			} else {
				delete process.env[ENV_ROOT];
				delete process.env[ENV_BRANCH];
			}
		}

		const recorded = loadState(ctx);
		if (!getActive() && recorded?.active) {
			const check = await checkCheckout(pi, recorded.path, recorded.repoRoot);
			if (check.ok) {
				setActive(recorded);
				setStatus(ctx, `⧉ ${worktreeLabel(recorded)}`);
				ctx.ui.notify(`Restored worktree ${worktreeLabel(recorded)}`, "info");
			} else {
				persistState((customType, data) => pi.appendEntry(customType, data), { ...recorded, active: false });
				setStatus(ctx, undefined);
				ctx.ui.notify(refusalMessage(check, recorded.path, ctx.cwd), "warning");
			}
		} else if (!getActive()) {
			setStatus(ctx, undefined);
		}

		setInactiveOverrides(findInactiveOverrides(pi, extensionEntryPath()));
		const inactive = getInactiveOverrides();
		if (inactive.length > 0) {
			ctx.ui.notify(
				`Worktree isolation is not active for: ${inactive.join(", ")}. Those tools keep their default behavior; set skipOverrides or remove the conflicting extension.`,
				"warning",
			);
		}

		if (event.reason === "startup" && !getActive()) {
			const flag = pi.getFlag("worktree");
			if (typeof flag === "string" && flag.trim()) {
				const name = flag.trim() === "true" ? undefined : flag.trim();
				try {
					await enterWorktree(pi, ctx, { name });
				} catch (error) {
					ctx.ui.notify(`Could not enter worktree: ${(error as Error).message}`, "error");
				}
			}
		}
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		// Release our lock but never remove the worktree on shutdown; cleanup is
		// an explicit exit or `/worktree prune`.
		const state = getActive();
		if (state && !state.borrowed && state.lockReason) {
			try {
				await unlockWorktree(pi, state.repoRoot, state.path);
			} catch {
				// Shutdown must not throw.
			}
		}
		setStatus(ctx, undefined);
	});

	pi.on("before_agent_start", (event) => {
		const state = getActive();
		if (!state) return;
		event.systemPromptOptions.cwd = state.path;
		event.systemPromptOptions.sections = {
			...event.systemPromptOptions.sections,
			worktree:
				`You are working in an isolated git worktree; relative paths resolve there, not in the main checkout.\n` +
				`  worktree: ${state.path}\n` +
				`  branch:   ${state.branch ?? "(detached)"}\n` +
				`  main:     ${state.repoRoot}\n` +
				`Do not edit files or run git against the main checkout.` +
				(state.borrowed
					? "\nThis worktree was inherited from the parent session; do not try to exit it."
					: "\nUse worktree_exit to return."),
		};
	});

	pi.on("tool_call", (event) => {
		const state = getActive();
		if (!state) return;
		const config = configFor(state.repoRoot);
		if (event.toolName === "bash") {
			const command = (event.input as { command?: string }).command ?? "";
			return analyzeBashCommand(command, state.path, config);
		}
		return guardFileTool(event.toolName, event.input, state.path, config);
	});

	// --- model surface -----------------------------------------------------

	registerTools(pi);
	registerCommands(pi);
}
