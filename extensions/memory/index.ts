/**
 * memory — durable cross-session notes for Pi.
 *
 * Registers a single `memory` tool (`add`/`update`/`forget`/`list`), a `/memory` command,
 * and a hidden `[MEMORY]` context injection. Notes are stored as human-editable
 * markdown in two files — global under the agent directory, project under the
 * repository root's `.pi/` — so they survive `/new`, `/resume`, and `/tree`.
 *
 * Load with:  pi --extension ./extensions/memory
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isExtensionEnabled } from "../../lib/env.ts";
import { registerCommands } from "./commands.ts";
import { loadMemoryConfig } from "./config.ts";
import { buildInjection, MEMORY_CONTEXT_MARKER } from "./format.ts";
import { createMemoryRuntime } from "./runtime.ts";
import { registerTools } from "./tools.ts";
import { MEMORY_CONTEXT_TYPE } from "./types.ts";

export { MEMORY_CONTEXT_MARKER };

function isMemoryContext(message: AgentMessage): boolean {
	return (message as AgentMessage & { customType?: string }).customType === MEMORY_CONTEXT_TYPE;
}

export default function memory(pi: ExtensionAPI): void {
	if (!isExtensionEnabled("memory")) return;
	const runtime = createMemoryRuntime(pi);

	registerTools(pi, runtime);
	registerCommands(pi, runtime);

	// Started, not awaited: the store read runs beside the reload, and the first turn waits
	// through `ready`, so one turn no longer pays for a scan the session may never need.
	pi.on("session_start", (_event, ctx) => {
		runtime.setConfig(loadMemoryConfig(ctx.cwd));
		runtime.load(ctx.cwd, ctx.isProjectTrusted()).then(
			(warning) => {
				if (warning && ctx.hasUI) ctx.ui.notify(`memory: ${warning}`, "warning");
			},
			() => {
				// A failed read still leaves an empty store behind: the notes are optional, and
				// the tool reports the store itself when it is asked.
			},
		);
	});

	// Restate stored notes before each run, bounded by the config cap.
	pi.on("before_agent_start", async () => {
		await runtime.ready();
		const config = runtime.config();
		if (!config.inject) return undefined;
		const body = buildInjection(runtime.entries(), config.maxInjectBytes);
		if (!body) return undefined;
		return { message: { customType: MEMORY_CONTEXT_TYPE, content: body, display: false } };
	});

	// Keep only the newest injection; older runs' copies are dropped.
	pi.on("context", (event) => {
		const contexts = event.messages.filter(isMemoryContext);
		if (contexts.length <= 1) return undefined;
		const last = contexts[contexts.length - 1];
		return { messages: event.messages.filter((message) => !isMemoryContext(message) || message === last) };
	});

	pi.on("session_shutdown", async () => {
		// A read still running lands before the reset clears it, so nothing from this session can
		// repopulate the view after it ended.
		await runtime.ready().catch(() => {});
		runtime.reset();
	});
}
