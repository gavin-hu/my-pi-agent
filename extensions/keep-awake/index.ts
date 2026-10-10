/**
 * keep-awake — hold the host machine awake while Pi works.
 *
 * Holds a transient OS inhibitor (`caffeinate` on macOS, `systemd-inhibit` on
 * Linux, `SetThreadExecutionState` on Windows) so a long agent run is not
 * interrupted by system sleep or the display turning off. The configured mode
 * decides when it engages — `auto` only while the agent is running, `always`
 * for the whole session — and `/keep-awake on|off|auto` overrides it for the
 * session. A `✦` status chip shows while an inhibitor is held.
 *
 * Load with:  pi --extension ./extensions/keep-awake
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isExtensionEnabled } from "../../lib/env.ts";
import { registerCommands } from "./commands.ts";
import { loadConfig } from "./config.ts";
import { createKeepAwakeRuntime, type KeepAwakeDeps } from "./runtime.ts";

export default function keepAwake(pi: ExtensionAPI, deps: KeepAwakeDeps = {}): void {
	if (!isExtensionEnabled("keep-awake")) return;
	// A config injected through `deps` (tests, embedders) is fixed; otherwise the
	// effective config is loaded per session from the session's cwd, so a project
	// `.pi/keep-awake.json` and a re-rooted worktree are honoured.
	const injected = deps.config !== undefined;
	const runtime = createKeepAwakeRuntime(deps);

	registerCommands(pi, runtime);

	pi.on("session_start", (_event, ctx) => {
		if (!injected) runtime.configure(loadConfig(ctx.cwd ?? process.cwd()));
		runtime.start(ctx);
	});
	pi.on("agent_start", (_event, ctx) => runtime.agentStart(ctx));
	pi.on("agent_settled", (_event, ctx) => runtime.agentSettled(ctx));
	pi.on("session_shutdown", (_event, ctx) => runtime.stop(ctx));
}
