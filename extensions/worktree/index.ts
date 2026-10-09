/**
 * worktree — Isolated git worktrees (EnterWorktree / ExitWorktree) for Pi.
 *
 * Mimics Claude Code's worktree isolation:
 *   - `enter_worktree` creates (or enters) an isolated `git worktree` under
 *     `.pi/worktrees/<name>` on branch `worktree-<name>`, and rebinds every
 *     path-taking tool to it.
 *   - `exit_worktree` returns to the main checkout and cleans up, checking for
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
 * This is the `worktree` extension entrypoint: Pi calls the default export,
 * which registers the extension through {@link registerWorktree}.
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isExtensionEnabled } from "../../lib/env.ts";
import { GLYPHS } from "../../lib/ui.ts";
import { canonicalize, checkCheckout, repoRoot, unlockWorktree } from "./git.ts";
import { analyzeBashCommand, guardFileTool } from "./guard.ts";
import {
	enterWorktree,
	findInactiveOverrides,
	isWorktreeCancelled,
	refusalMessage,
	worktreeLabel,
} from "./lifecycle.ts";
import { registerCommands } from "./commands.ts";
import { type BuiltinFactory, registerRootTools } from "./root-tools.ts";
import { loadState, persistState, type WorktreeState } from "./state.ts";
import { registerTools } from "./tools.ts";
import {
	ENV_BRANCH,
	ENV_MAIN,
	ENV_ROOT,
	clearConfigCache,
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

export interface WorktreeRegistration {
	/** File Pi records as the extension entry, for inactive-override reporting. */
	entryPath: string;
	/** Test seam: override the host built-in factories used by `root-tools.ts`. */
	createBuiltin?: BuiltinFactory;
}

export function registerWorktree(pi: ExtensionAPI, { entryPath, createBuiltin }: WorktreeRegistration): void {
	registerRootTools(pi, { getRoot, getSkipOverrides }, { createBuiltin });

	pi.registerFlag("worktree", {
		description: "Create or enter a git worktree at session start",
		type: "string",
	});

	// --- lifecycle ---------------------------------------------------------

	pi.on("session_start", async (event, ctx) => {
		setBaseCwd(ctx.cwd);
		setActive(null);
		clearConfigCache();

		// A child `pi` process (subagent) inherits an active worktree. Bind to
		// it without creating, locking, or persisting anything; the parent owns
		// the lifecycle. Only on a fresh process start: a `reload` re-runs this
		// factory inside the parent, which must restore its own recorded state.
		const envRoot = event.reason === "startup" ? process.env[ENV_ROOT] : undefined;
		if (envRoot) {
			const borrowedPath = canonicalize(envRoot);
			if (existsSync(borrowedPath) && (await repoRoot(pi, borrowedPath))) {
				const borrowedMain = process.env[ENV_MAIN] ? canonicalize(process.env[ENV_MAIN]) : borrowedPath;
				const borrowed: WorktreeState = {
					active: true,
					borrowed: true,
					path: borrowedPath,
					branch: process.env[ENV_BRANCH],
					repoRoot: borrowedMain,
					baseRef: "HEAD",
					baseRefMode: "head",
					createdByUs: false,
				};
				setActive(borrowed);
				setStatus(ctx, `${GLYPHS.worktree} ${worktreeLabel(borrowed)} (inherited)`);
				publishWorktree(pi, borrowed);
				ctx.ui.notify(`Using parent worktree ${borrowed.path}`, "info");
			} else {
				delete process.env[ENV_ROOT];
				delete process.env[ENV_BRANCH];
				delete process.env[ENV_MAIN];
			}
		}

		const recorded = loadState(ctx);
		if (!getActive() && recorded?.active) {
			const check = await checkCheckout(pi, recorded.path, recorded.repoRoot);
			if (check.ok) {
				setActive(recorded);
				setStatus(ctx, `${GLYPHS.worktree} ${worktreeLabel(recorded)}`);
				ctx.ui.notify(`Restored worktree ${worktreeLabel(recorded)}`, "info");
			} else {
				// "unverified" keeps the recorded binding so a later resume can
				// retry; the others clear it because the worktree is gone/unsafe.
				if (check.reason !== "unverified") {
					persistState((customType, data) => pi.appendEntry(customType, data), { ...recorded, active: false });
				}
				setStatus(ctx, undefined);
				ctx.ui.notify(refusalMessage(check, recorded.path, ctx.cwd), "warning");
			}
		} else if (!getActive()) {
			setStatus(ctx, undefined);
		}

		setInactiveOverrides(findInactiveOverrides(pi, entryPath));
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
					const { state } = await enterWorktree(pi, ctx, { name });
					ctx.ui.notify(`Entered worktree ${worktreeLabel(state)}`, "info");
				} catch (error) {
					if (isWorktreeCancelled(error)) {
						ctx.ui.notify((error as Error).message, "info");
						return;
					}
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
					: "\nUse exit_worktree to return."),
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

/** Pi extension entrypoint. */
export default function worktreeExtension(pi: ExtensionAPI): void {
	if (!isExtensionEnabled("worktree")) return;
	registerWorktree(pi, { entryPath: canonicalize(fileURLToPath(import.meta.url)) });
}
