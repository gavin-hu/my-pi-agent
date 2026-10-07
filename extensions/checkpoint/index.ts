/**
 * checkpoint — working-tree snapshots and rewind for Pi.
 *
 * Registers the `checkpoint` tool and `/checkpoint` command, and (by default)
 * snapshots the working tree before the first mutating tool call of each turn.
 * A snapshot is a git commit kept under `refs/pi/checkpoints/<id>`; restoring it
 * rewrites the working tree and index without moving HEAD, so branches, commits,
 * and the reflog are untouched.
 *
 * Load with:  pi --extension ./extensions/checkpoint
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerCommands } from "./commands.ts";
import { createSnapshotPolicy, type SnapshotPolicy } from "./policy.ts";
import { createRuntime } from "./runtime.ts";
import { registerTools } from "./tools.ts";

export default function checkpoint(pi: ExtensionAPI): void {
	const runtime = createRuntime(pi);
	const policies = new Map<string, SnapshotPolicy>();

	registerTools(pi, runtime);
	registerCommands(pi, runtime);

	// Automatic snapshot bookkeeping. The flag is set synchronously before the
	// first await so parallel tool calls in one turn cannot double-snapshot.
	let snapshotTakenThisTurn = false;
	let turnIndex = 0;
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
		snapshotTakenThisTurn = false;
		warned = false;
		await refresh(ctx);
	});

	// A tree navigation can land on a different branch with its own checkpoints.
	pi.on("session_tree", async (_event, ctx) => {
		await runtime.setStatus(ctx);
	});

	pi.on("turn_start", (event) => {
		turnIndex = event.turnIndex;
		snapshotTakenThisTurn = false;
		warned = false;
	});

	pi.on("session_shutdown", (_event, ctx) => {
		runtime.clearStatus(ctx);
	});

	pi.on("tool_call", async (event, ctx) => {
		// A throw here fails the model's tool call, so every failure is swallowed.
		try {
			const root = await runtime.rootFor(ctx);
			if (!root) return;
			const config = runtime.configFor(root);
			if (!config.enabled || config.mode === "off") return;
			if (!policyFor(root).shouldSnapshot(event.toolName)) return;
			if (config.mode === "turn" && snapshotTakenThisTurn) return;

			snapshotTakenThisTurn = true;
			await runtime.snapshot(ctx, { reason: "auto", tool: event.toolName, turn: turnIndex });
			await runtime.setStatus(ctx);
		} catch (error) {
			if (warned) return;
			warned = true;
			try {
				ctx.ui.notify(`Checkpoint skipped: ${(error as Error).message}`, "warning");
			} catch {
				// UI may be unavailable (print/json modes).
			}
		}
	});
}
