/**
 * memory — durable cross-session notes for Pi.
 *
 * Registers a single `memory` tool (`add`/`forget`/`list`), a `/memory` command,
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

	pi.on("session_start", async (_event, ctx) => {
		runtime.setConfig(loadMemoryConfig(ctx.cwd));
		const warning = await runtime.load(ctx.cwd, ctx.isProjectTrusted());
		if (warning && ctx.hasUI) ctx.ui.notify(`memory: ${warning}`, "warning");
	});

	// Restate stored notes before each run, bounded by the config cap.
	pi.on("before_agent_start", () => {
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

	pi.on("session_shutdown", () => runtime.reset());
}
