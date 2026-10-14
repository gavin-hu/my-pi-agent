/**
 * question — a structured "ask the user" tool for Pi.
 *
 * Registers `ask_user_question` (exposure `model-only`): one to four questions,
 * each with labelled options and a free-form "Other" answer, answered through a
 * tabbed TUI, forwarded RPC dialogs, or refused cleanly when there is no UI.
 *
 * The tool is registered inactive (`defaultActive: false`) and switched on at
 * `session_start` only when the session has a UI, so `print`/`json` runs never
 * offer the model an interaction it cannot use.
 *
 * Load with:  pi --extension ./extensions/question
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isExtensionEnabled } from "../../lib/env.ts";
import { TOOL_NAME, registerTools } from "./tools.ts";

export default function question(pi: ExtensionAPI): void {
	if (!isExtensionEnabled("question")) return;
	registerTools(pi);

	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		const active = pi.getActiveTools();
		if (!active.includes(TOOL_NAME)) pi.setActiveTools([...active, TOOL_NAME]);
	});
}
