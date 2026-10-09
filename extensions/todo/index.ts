/**
 * todo — a TodoWrite-style task list for Pi.
 *
 * Registers a single `todo` tool that replaces the current task list, plus a
 * `/todos` command and a persistent widget that mirror it. The list is stored
 * in tool-result `details`, so it follows the active session branch and is
 * restored on `/resume` and `/tree`.
 *
 * Load with:  pi --extension ./extensions/todo
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isExtensionEnabled } from "../../lib/env.ts";
import { registerCommands } from "./commands.ts";
import { loadTodoConfig } from "./config.ts";
import { createTodoRuntime } from "./runtime.ts";
import { registerTools } from "./tools.ts";

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
}
