/**
 * Register bytefly's next-steps surface.
 *
 * Four pieces, each doing one thing:
 *
 * 1. `before_agent_start` writes the instruction into the system-prompt sections
 *    (never a message or an entry, so nothing persists and nothing needs dedupe),
 *    and re-reads the `suggest` section so the control-center row applies to the
 *    next turn rather than the next session.
 * 2. `message_end` keeps the run's last assistant text, which is what the parse
 *    reads at settle; `agent_start` clears it.
 * 3. `agent_settled` lifts a matching block out of that reply and appends a
 *    `bytefly-next-steps` entry. It runs after the turn separator's own append
 *    because `index.ts` registers it after, which is what puts the aside *below*
 *    the turn rule — a test pins that order.
 * 4. The entry renderer draws the stored items (see `component.ts`).
 *
 * The reply's own copy of the block is removed by the markdown transformer in
 * `../message/`, using the same `parseNextSteps`, so the items appear once.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createPadStore, type PadSource } from "../pad.ts";
import { createRailSource, type RailSource } from "../chrome.ts";
import { NextStepsComponent } from "./component.ts";
import { loadSuggestConfig } from "./config.ts";
import { NEXT_STEP_SECTION, nextStepInstruction } from "./instruction.ts";
import { parseNextSteps } from "./parse.ts";
import { NEXT_STEPS_ENTRY_TYPE, type NextStepsData } from "./types.ts";

/** The reply text of one assistant message, its text parts joined in order. */
function replyText(content: readonly { type: string; text?: string }[]): string {
	return content
		.filter((part) => part.type === "text")
		.map((part) => part.text ?? "")
		.join("\n");
}

/** Register the instruction, the lift, and the entry renderer. */
export function registerNextSteps(
	pi: ExtensionAPI,
	pad: PadSource = createPadStore(),
	rail: RailSource = createRailSource(),
): void {
	// This run's last assistant text, and whether the section is on for this turn.
	let lastReply = "";
	let enabled = false;

	pi.registerEntryRenderer<NextStepsData>(NEXT_STEPS_ENTRY_TYPE, (entry, _options, theme) => {
		const data = entry.data;
		if (!data || !Array.isArray(data.items) || data.items.length === 0) return undefined;
		return new NextStepsComponent(data, theme, pad.resolve(), rail.resolve());
	});

	pi.on("before_agent_start", (event, ctx: ExtensionContext) => {
		enabled = loadSuggestConfig(ctx.cwd).enabled;
		lastReply = "";
		if (!enabled) return;
		event.systemPromptOptions.sections[NEXT_STEP_SECTION] = nextStepInstruction();
	});

	pi.on("agent_start", () => {
		lastReply = "";
	});

	pi.on("message_end", (event) => {
		const message = event.message;
		if (message.role !== "assistant") return;
		lastReply = replyText(message.content);
	});

	pi.on("agent_settled", (event, ctx) => {
		// The transcript is interactive-only; keep RPC/JSON/print sessions clean.
		if (!enabled || event.aborted || ctx.mode !== "tui") return;
		const parsed = parseNextSteps(lastReply);
		if (!parsed) return;
		pi.appendEntry<NextStepsData>(NEXT_STEPS_ENTRY_TYPE, { items: parsed.items });
	});

	pi.on("session_shutdown", () => {
		lastReply = "";
		enabled = false;
	});
}
