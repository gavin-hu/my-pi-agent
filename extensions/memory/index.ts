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
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isExtensionEnabled } from "../../lib/env.ts";
import { sessionIdOf, sessionNameOf } from "../../lib/session-label.ts";
import { registerCommands } from "./commands.ts";
import { loadMemoryConfig } from "./config.ts";
import { buildInjection, MEMORY_CONTEXT_MARKER } from "./format.ts";
import { createMemoryRuntime } from "./runtime.ts";
import { registerTools } from "./tools.ts";
import { MEMORY_CONTEXT_TYPE } from "./types.ts";

export { MEMORY_CONTEXT_MARKER };

/**
 * The label this session's notes carry.
 *
 * The bus record's own name for this session, else the session's name, else nothing: an
 * unattributed note is better than a wrong name on someone's fact, so nothing here guesses.
 * The record is read through the store's own resolver rather than the board's `who()`, which
 * opens the board's store.
 */
async function labelOfSession(pi: Pick<ExtensionAPI, "exec">, ctx: ExtensionContext): Promise<string | undefined> {
	const { normalizeLabel } = await import("../../lib/session-label.ts");
	const named = normalizeLabel(sessionNameOf(ctx), "");
	const id = sessionIdOf(ctx);
	if (id === undefined) return named || undefined;
	try {
		const { busLabelFor } = await import("./store.ts");
		return normalizeLabel((await busLabelFor(pi, id, ctx.cwd)) ?? named, "") || undefined;
	} catch {
		return named || undefined;
	}
}

function isMemoryContext(message: AgentMessage): boolean {
	return (message as AgentMessage & { customType?: string }).customType === MEMORY_CONTEXT_TYPE;
}

export default function memory(pi: ExtensionAPI): void {
	if (!isExtensionEnabled("memory")) return;
	const runtime = createMemoryRuntime(pi);
	// The retention rule, loaded by the first request that needs it: a `context`
	// filter is not a surface a session start should pay for.
	let retention: Promise<typeof import("../../lib/notice.ts")> | undefined;

	registerTools(pi, runtime);
	registerCommands(pi, runtime);

	// Started, not awaited: the store read runs beside the reload, and the first turn waits
	// through `ready`, so one turn no longer pays for a scan the session may never need.
	pi.on("session_start", (_event, ctx) => {
		runtime.setConfig(loadMemoryConfig(ctx.cwd));
		// Started beside the read: a write waits for the label, and the label waits for one git
		// call and one roster read, neither of which a session that only reads notes needs.
		runtime.setActor(labelOfSession(pi, ctx));
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
	pi.on("context", async (event) => {
		const { retainNewest } = await (retention ??= import("../../lib/notice.ts"));
		const kept = retainNewest(event.messages, isMemoryContext);
		return kept ? { messages: kept } : undefined;
	});

	pi.on("session_shutdown", async () => {
		// A read still running lands before the reset clears it, so nothing from this session can
		// repopulate the view after it ended.
		await runtime.ready().catch(() => {});
		runtime.reset();
	});
}
