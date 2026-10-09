/**
 * rewind — prompt-anchored working-tree and conversation snapshots for Pi.
 *
 * Takes one automatic snapshot per user prompt (before the prompt's first
 * mutating tool call) and registers the `/rewind` command. A snapshot is a git
 * commit kept under `refs/pi/rewind/<id>`; a restore rewrites the working tree
 * and index without moving HEAD, so branches, commits, and the reflog are
 * untouched. `/rewind` can also move the session tree back to the selected
 * prompt, leaving the abandoned branch intact.
 *
 * This is the `rewind` extension entrypoint: Pi calls the default export, which
 * registers the extension through {@link registerRewind}.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isExtensionEnabled } from "../../lib/env.ts";
import { registerCommands } from "./commands.ts";
import { summarizePrompt } from "./format.ts";
import { createSnapshotPolicy, type SnapshotPolicy } from "./policy.ts";
import { createRuntime } from "./runtime.ts";

export function registerRewind(pi: ExtensionAPI): void {
	const runtime = createRuntime(pi);
	const policies = new Map<string, SnapshotPolicy>();

	registerCommands(pi, runtime);

	// One automatic snapshot per user prompt. The prompt summary is captured
	// when the run starts; the flag flips on the first mutating call and resets
	// on the next prompt, so a read-only prompt snapshots nothing.
	let snapshotTakenForRun = false;
	let pendingPrompt: string | undefined;
	let warned = false;

	const policyFor = (root: string): SnapshotPolicy => {
		let policy = policies.get(root);
		if (!policy) {
			policy = createSnapshotPolicy(pi, runtime.configFor(root));
			policies.set(root, policy);
		}
		return policy;
	};

	const refresh = async (ctx: ExtensionContext): Promise<void> => {
		runtime.invalidate();
		policies.clear();
		await runtime.setStatus(ctx);
	};

	pi.on("session_start", async (_event, ctx) => {
		snapshotTakenForRun = false;
		pendingPrompt = undefined;
		warned = false;
		await refresh(ctx);
		await runtime.sweepStaleIndexes(ctx);
	});

	// A tree navigation can land on a different branch with its own snapshots.
	pi.on("session_tree", async (_event, ctx) => {
		await runtime.setStatus(ctx);
	});

	// A new prompt begins a task: remember its summary and let the next mutating
	// call take the run's single snapshot.
	pi.on("before_agent_start", (event) => {
		pendingPrompt = summarizePrompt(event.prompt);
		snapshotTakenForRun = false;
		warned = false;
	});

	pi.on("session_shutdown", (_event, ctx) => {
		pendingPrompt = undefined;
		runtime.releaseIndexes();
		runtime.clearStatus(ctx);
	});

	pi.on("tool_call", async (event, ctx) => {
		// A throw here fails the model's tool call, so every failure is swallowed.
		try {
			const root = await runtime.rootFor(ctx);
			if (!root) return;
			const config = runtime.configFor(root);
			if (!config.autoSnapshots) return;
			if (snapshotTakenForRun) return;
			if (!policyFor(root).shouldSnapshot(event.toolName)) return;

			snapshotTakenForRun = true;
			await runtime.snapshot(ctx, { reason: "auto", prompt: pendingPrompt });
			await runtime.setStatus(ctx);
		} catch (error) {
			if (warned) return;
			warned = true;
			try {
				ctx.ui.notify(`Snapshot skipped: ${(error as Error).message}`, "warning");
			} catch {
				// UI may be unavailable (print/json modes).
			}
		}
	});
}

/** Pi extension entrypoint. */
export default function rewindExtension(pi: ExtensionAPI): void {
	if (!isExtensionEnabled("rewind")) return;
	registerRewind(pi);
}
