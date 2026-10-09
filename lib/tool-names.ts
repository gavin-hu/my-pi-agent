/**
 * Names that more than one extension must agree on.
 *
 * Tool names are otherwise owned by the extension that registers the tool, and
 * no extension imports another's modules (see this directory's README). When an
 * orchestrating tool calls another extension's tool through `ctx.executeTool`,
 * or reads another extension's registered parameter schema, the shared name
 * lives here so a rename breaks the build on both sides instead of silently
 * disabling the integration.
 */

/** The `todo` tool, called by plan to seed the approved plan's steps. */
export const TODO_TOOL = "todo";

/** The `subagent` tool, which plan mode pins to read-only delegation. */
export const SUBAGENT_TOOL = "subagent";

/**
 * Parameter on the `subagent` tool that forces every spawned agent to a
 * read-only tool set. Plan mode sets it on every call while planning, and
 * refuses a `subagent` whose schema does not declare it.
 */
export const SUBAGENT_READ_ONLY_PARAM = "readOnly";
