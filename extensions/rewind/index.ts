/**
 * rewind — prompt-anchored working-tree and conversation snapshots for Pi.
 *
 * Takes one automatic snapshot per user prompt (before the prompt's first
 * mutating tool call) and registers the `/rewind` command. A snapshot is a git
 * commit kept under `refs/pi/rewind/<id>`; a restore rewrites the working tree
 * without moving HEAD, so branches, commits, and the reflog are untouched.
 * `/rewind` can also move the session tree back to the selected prompt, leaving
 * the abandoned branch intact.
 *
 * This is the `rewind` extension entrypoint: Pi calls the default export, which
 * registers the extension through {@link registerRewind}. The factory only wires
 * events and the command; the automatic-snapshot decision lives in
 * `snapshot-run.ts`.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isExtensionEnabled } from "../../lib/env.ts";
import { registerCommands } from "./commands.ts";
import { createRuntime } from "./runtime.ts";
import { createSnapshotRun } from "./snapshot-run.ts";

export function registerRewind(pi: ExtensionAPI): void {
	const runtime = createRuntime(pi);
	const run = createSnapshotRun(pi, runtime);

	registerCommands(pi, runtime);

	pi.on("session_start", async (_event, ctx) => {
		await run.refresh(ctx);
		await runtime.sweepStaleIndexes(ctx);
	});

	// A tree navigation can land on a different branch with its own snapshots.
	pi.on("session_tree", async (_event, ctx) => {
		await runtime.setStatus(ctx);
	});

	// A run started by a custom message (a wake) has no user prompt: only a user
	// run carries one, and a newer host spells that as a union on `messageType`.
	pi.on("before_agent_start", async (event, ctx) => {
		await run.beginRun("prompt" in event ? event.prompt : undefined, ctx);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		run.reset();
		runtime.releaseIndexes();
		runtime.clearStatus(ctx);
	});

	pi.on("tool_call", async (event, ctx) => {
		await run.onToolCall(event.toolName, ctx);
	});
}

/** Pi extension entrypoint. */
export default function rewindExtension(pi: ExtensionAPI): void {
	if (!isExtensionEnabled("rewind")) return;
	registerRewind(pi);
}
