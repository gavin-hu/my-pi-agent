/**
 * The host boundary: read Pi's own numbers once, in one place.
 *
 * Everything here is a read. `getContextUsage()` already rebuilds the session
 * projection, and the composition needs that projection too, so the caller
 * collects once per screen open or refresh rather than per frame; the component
 * then renders from the report it was handed.
 *
 * Only active tools are counted, because only they are declared to the model.
 * A tool definition is estimated from the schema and text the host would send,
 * not from a rendered prompt, so the number is an estimate like every other row.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { estimateChars } from "./report.ts";
import type { ContextInputs } from "./types.ts";

/** Estimated tokens a set of tool definitions adds to the request. */
function toolTokens(tools: ReturnType<ExtensionAPI["getAllTools"]>): number {
	let chars = 0;
	for (const tool of tools) {
		// `promptGuidelines` are rendered into the system prompt's rules section,
		// which `ctx.getSystemPrompt()` already contains, so counting them here
		// would count them twice.
		chars += JSON.stringify({ name: tool.name, description: tool.description, parameters: tool.parameters }).length;
	}
	return estimateChars(chars);
}

/** Read everything the report needs from one host context. */
export function collectInputs(pi: ExtensionAPI, ctx: ExtensionContext): ContextInputs {
	const usage = ctx.getContextUsage();
	const model = ctx.model ? { provider: ctx.model.provider, id: ctx.model.id } : null;
	const activeNames = new Set(pi.getActiveTools());
	const allTools = pi.getAllTools();
	const activeTools = allTools.filter((tool) => activeNames.has(tool.name));
	const session = ctx.sessionManager;

	return {
		model,
		window: usage?.contextWindow ?? ctx.model?.contextWindow ?? 0,
		systemPrompt: ctx.getSystemPrompt(),
		tools: {
			active: activeNames.size,
			total: allTools.length,
			tokens: toolTokens(activeTools),
		},
		usage,
		messages: session.buildSessionProjection().messages,
		branch: session.getBranch(),
		settings: pi.getSettings(),
	};
}
