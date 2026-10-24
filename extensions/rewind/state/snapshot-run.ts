/**
 * Per-run state for automatic snapshots.
 *
 * The unit is the task, not the tool call: one snapshot per user prompt, taken
 * before the prompt's first mutating tool call. `beginRun` resolves the run's
 * root, policy, and config up front, so `onToolCall` can guard synchronously —
 * no `await` sits between the check and the claim, and parallel sibling calls
 * in one assistant message cannot each take a snapshot. Extracted from the
 * registrar so `index.ts` only wires events.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { summarizePrompt } from "../text/format.ts";
import { createSnapshotPolicy, type SnapshotPolicy } from "./policy.ts";
import type { RewindRuntime } from "./runtime.ts";

export interface SnapshotRun {
	/**
	 * Start a run for `prompt` — `undefined` when a custom message started it: reset
	 * run state and resolve the snapshot decision.
	 */
	beginRun(prompt: string | undefined, ctx: ExtensionContext): Promise<void>;
	/** Take the run's single snapshot before the first mutating call, at most once. */
	onToolCall(toolName: string, ctx: ExtensionContext): Promise<void>;
	/** Drop run-scoped state (on session shutdown). */
	reset(): void;
	/** Drop caches and run state, then repaint status (on session start). */
	refresh(ctx: ExtensionContext): Promise<void>;
}

export function createSnapshotRun(pi: ExtensionAPI, runtime: RewindRuntime): SnapshotRun {
	const policies = new Map<string, SnapshotPolicy>();
	let snapshotTakenForRun = false;
	let pendingPrompt: string | undefined;
	let warned = false;
	// Resolved once per run in `beginRun`, so `onToolCall` needs no `await`
	// between its guard and its claim.
	let runRoot: string | undefined;
	let runPolicy: SnapshotPolicy | undefined;
	let runAutoSnapshots = false;

	const policyFor = (root: string): SnapshotPolicy => {
		let policy = policies.get(root);
		if (!policy) {
			policy = createSnapshotPolicy(pi, runtime.configFor(root));
			policies.set(root, policy);
		}
		return policy;
	};

	const reset = (): void => {
		snapshotTakenForRun = false;
		pendingPrompt = undefined;
		warned = false;
		runRoot = undefined;
		runPolicy = undefined;
		runAutoSnapshots = false;
	};

	const beginRun = async (prompt: string | undefined, ctx: ExtensionContext): Promise<void> => {
		reset();
		pendingPrompt = summarizePrompt(prompt);
		try {
			const root = await runtime.rootFor(ctx);
			if (!root) return;
			runRoot = root;
			runPolicy = policyFor(root);
			runAutoSnapshots = runtime.configFor(root).autoSnapshots;
		} catch {
			// Root resolution is best-effort; a run without it snapshots nothing.
		}
	};

	const onToolCall = async (toolName: string, ctx: ExtensionContext): Promise<void> => {
		// Synchronous guard: no `await` before the claim. A throw below is caught,
		// because a failure here must not block the model's tool call.
		if (!runRoot || !runPolicy || !runAutoSnapshots) return;
		if (snapshotTakenForRun) return;
		if (!runPolicy.shouldSnapshot(toolName)) return;
		snapshotTakenForRun = true;

		try {
			await runtime.snapshot(ctx, { reason: "auto", prompt: pendingPrompt });
			await runtime.setStatus(ctx);
		} catch (error) {
			// Release the claim so a later mutating call in this run can retry.
			snapshotTakenForRun = false;
			if (warned) return;
			warned = true;
			try {
				ctx.ui.notify(`Snapshot skipped: ${error instanceof Error ? error.message : String(error)}`, "warning");
			} catch {
				// UI may be unavailable (print/json modes).
			}
		}
	};

	const refresh = async (ctx: ExtensionContext): Promise<void> => {
		runtime.invalidate();
		policies.clear();
		reset();
		await runtime.setStatus(ctx);
	};

	return { beginRun, onToolCall, reset, refresh };
}
