/**
 * todo — a TodoWrite-style task list for Pi.
 *
 * Registers a single `todo` tool that replaces the current task list, plus a
 * `/todos` command and a persistent widget that mirror it. The list is stored
 * in tool-result `details`, so it follows the active session branch and is
 * restored on `/resume` and `/tree`. A hidden reminder is injected at the end
 * of a run that did mutating work without a todo update, forcing one
 * continuation so the list does not drift behind the work.
 *
 * Load with:  pi --extension ./extensions/todo
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isExtensionEnabled } from "../../lib/env.ts";
import { registerCommands } from "./commands.ts";
import { loadTodoConfig } from "./config.ts";
import { formatNudge, isMutatingTool } from "./nudge.ts";
import { createTodoRuntime } from "./runtime.ts";
import { registerTools } from "./tools.ts";

/** Custom-entry type used for the injected lag reminder. */
export const TODO_NUDGE_CONTEXT_TYPE = "todo-nudge";

function isTodoNudge(message: AgentMessage): boolean {
	// Match on the custom type, not the marker text: a real user message that
	// quotes the marker must not be dropped.
	return (message as AgentMessage & { customType?: string }).customType === TODO_NUDGE_CONTEXT_TYPE;
}

export default function todo(pi: ExtensionAPI) {
	if (!isExtensionEnabled("todo")) return;
	const runtime = createTodoRuntime(pi);

	registerTools(pi, runtime);
	registerCommands(pi, runtime);

	// Load the widget config once per session, before the first reconstruction.
	const startSession = (ctx: ExtensionContext): void => {
		runtime.setConfig(loadTodoConfig(ctx.cwd ?? process.cwd()));
		runtime.reconstruct(ctx);
	};

	pi.on("session_start", (_event, ctx) => startSession(ctx));
	pi.on("session_tree", (_event, ctx) => runtime.reconstruct(ctx));
	pi.on("session_shutdown", (_event, ctx) => runtime.clearWidget(ctx));

	// A new user turn starts with a clean lag window, and any reminder injected
	// on the previous run is no longer current.
	pi.on("before_agent_start", () => {
		runtime.resetNudge();
		runtime.deactivateNudge();
	});

	// Only work that can change the working tree sets the lag flag; read-only
	// tools and the todo call itself are ignored.
	pi.on("tool_execution_end", (event) => {
		const annotations = pi.getAllTools().find((tool) => tool.name === event.toolName)?.annotations;
		if (isMutatingTool(event.toolName, annotations)) runtime.noteWork();
	});

	// When the run is about to settle with unfinished work done since the last
	// todo update, force one more request with a short reminder.
	pi.on("agent_before_settle", (event) => {
		if (event.outcome !== "completed") return undefined;
		if (!runtime.nudgeDue()) return undefined;
		runtime.markNudged();
		return {
			entries: [
				{
					type: "custom_message",
					customType: TODO_NUDGE_CONTEXT_TYPE,
					content: formatNudge(runtime.getTodos()),
					display: false,
				},
			],
			continue: true,
		};
	});

	// Drop a reminder once it is no longer current (a new user turn, or replay),
	// and keep only the newest while it is, so reminders never accumulate.
	pi.on("context", (event) => {
		const contexts = event.messages.filter(isTodoNudge);
		if (contexts.length === 0) return undefined;
		if (!runtime.isNudgeActive()) {
			return { messages: event.messages.filter((message) => !isTodoNudge(message)) };
		}
		if (contexts.length <= 1) return undefined;
		const last = contexts[contexts.length - 1];
		return { messages: event.messages.filter((message) => !isTodoNudge(message) || message === last) };
	});
}
