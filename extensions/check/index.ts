/**
 * check — cross-stack verification runs.
 *
 * Registers `/check` and the `run_check` tool. Detection and parsing know about
 * project manifests and runner output; the runtime, screens, and tool speak in
 * commands and failures, never in a language or package manager.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isExtensionEnabled } from "../../lib/env.ts";
import { registerCheckCommand } from "./commands.ts";
import { createCheckRuntime } from "./runtime.ts";
import { registerCheckTool } from "./tools.ts";

export function registerCheck(pi: ExtensionAPI): void {
	const runtime = createCheckRuntime();
	registerCheckTool(pi, runtime);
	registerCheckCommand(pi, runtime);
	pi.on("session_shutdown", () => runtime.shutdown());
}

/** Pi extension entrypoint. */
export default function checkExtension(pi: ExtensionAPI): void {
	if (!isExtensionEnabled("check")) return;
	registerCheck(pi);
}
