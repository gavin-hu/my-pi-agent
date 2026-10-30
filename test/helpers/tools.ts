/**
 * Calling a registered tool the way Pi does.
 *
 * The goal, plan, and todo tool suites each wrapped `tool.execute` with the same
 * argument list, so a copy that drifted on it would test a call the host never
 * makes: one call id, no signal, no update callback.
 */

/** Execute a registered tool as Pi would, returning its result unchanged. */
export function callTool(tool: any, params: unknown, ctx: any): any {
	return tool.execute("call-1", params, undefined, undefined, ctx);
}
