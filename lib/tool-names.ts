/**
 * Names that more than one extension must agree on.
 *
 * Tool names are otherwise owned by the extension that registers the tool, and
 * no extension imports another's modules (see this directory's README). When an
 * orchestrating tool calls another extension's tool through `ctx.executeTool`,
 * reads another extension's registered parameter schema, lists the name in a
 * read-only policy, or passes it on a child's `--tools` allowlist, the shared
 * name lives here so a rename breaks the build on both sides instead of silently
 * disabling the integration.
 */

/** The `todo` tool, called by plan to seed the approved plan's steps. */
export const TODO_TOOL = "todo";

/** The `goal` tool, allowlisted as a reader by plan and rewind. */
export const GOAL_TOOL = "goal";

/**
 * The `plan` tool. `plan` registers it and `goal` offers the same phase to the user,
 * so the name is shared: the request channel and the registration probe both look
 * it up. Its actions are the planning verbs, so one name replaces the five tools
 * that used to spell them.
 */
export const PLAN_TOOL = "plan";

/** The `subagent` tool, which plan mode pins to read-only delegation. */
export const SUBAGENT_TOOL = "subagent";

/**
 * The `ask_user_question` tool. The `question` extension registers it, and
 * the `plan` and `rewind` read-only policies list it, so all three must agree.
 */
export const ASK_USER_QUESTION_TOOL = "ask_user_question";

/**
 * The `session` tool. `session-bus` registers it, and `team` calls it through
 * `ctx.executeTool` to send a handoff, so a rename breaks both sides.
 */
export const SESSION_TOOL = "session";

/**
 * Parameter on the `subagent` tool that forces every spawned agent to a
 * read-only tool set. Plan mode sets it on every call while planning, and
 * refuses a `subagent` whose schema does not declare it.
 */
export const SUBAGENT_READ_ONLY_PARAM = "readOnly";

/**
 * The `board` tool: the shared feature list. Plan mode keeps it active because its
 * `list` action is a read of the repository's cards, so the name is shared while the
 * write actions stay the board's to refuse.
 */
export const BOARD_TOOL = "board";

/**
 * The `read_doc` tool. `file-read` registers it, and the plan, rewind, and
 * subagent reader lists carry the name, so the document reader is one reader
 * everywhere instead of three spellings.
 */
export const READ_DOC_TOOL = "read_doc";

/**
 * The `web_search` tool. `web-access` registers it; plan's and subagent's reader
 * lists carry the name, so a rename cannot silently drop the web reader.
 */
export const WEB_SEARCH_TOOL = "web_search";

/** The `web_fetch` tool, shared the same way as {@link WEB_SEARCH_TOOL}. */
export const WEB_FETCH_TOOL = "web_fetch";
