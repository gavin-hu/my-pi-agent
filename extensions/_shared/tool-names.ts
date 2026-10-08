/**
 * Tool names that more than one extension must agree on.
 *
 * Tool names are otherwise owned by the extension that registers the tool, and
 * no extension imports another's modules (see this directory's README). When an
 * orchestrating tool calls another extension's tool through `ctx.executeTool`,
 * the shared name lives here so a rename breaks the build on both sides instead
 * of silently disabling the integration.
 */

/** The `todo` tool, called by plan-mode to seed the approved plan's steps. */
export const TODO_TOOL = "todo";
