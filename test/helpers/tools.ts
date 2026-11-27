/**
 * Calling a registered tool the way Pi does.
 *
 * The goal, plan, and todo tool suites each wrapped `tool.execute` with the same
 * argument list, so a copy that drifted on it would test a call the host never
 * makes: one call id, no signal, no update callback.
 */

import type { AgentToolResult } from "@earendil-works/pi-coding-agent";

/** Execute a registered tool as Pi would, returning its result unchanged. */
export function callTool(tool: any, params: unknown, ctx: any): any {
	return tool.execute("call-1", params, undefined, undefined, ctx);
}

/**
 * The model-facing text of a tool result.
 *
 * A result's content is text and image blocks; a suite that asserts on words reads the one
 * text block its tool returns, and a result that carried none is the failure rather than an
 * assertion over undefined.
 */
export function resultText<T>(result: AgentToolResult<T>): string {
	const block = result.content[0];
	if (block?.type !== "text") throw new Error("the tool result carried no text block");
	return block.text;
}
