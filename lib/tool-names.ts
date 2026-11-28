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

/**
 * The `team` tool: the lead's half of the board. `team` registers it, and a session
 * holding the seat lists it by name — a rename that missed the list would take
 * dispatch away from the one mode built to dispatch.
 */
export const TEAM_TOOL = "team";

/** The `subagent` tool, which plan mode pins to read-only delegation. */
export const SUBAGENT_TOOL = "subagent";

/**
 * The `question` tool. The `question` extension registers it, and the `plan` and
 * `rewind` read-only policies list it, so all three must agree.
 */
export const QUESTION_TOOL = "question";

/**
 * The `session` tool. `session-bus` registers it, and `team` calls it through
 * `ctx.executeTool` to send a handoff, so a rename breaks both sides.
 */
export const SESSION_TOOL = "session";

/**
 * The `run_doctor` tool. `bytefly` registers it, and a session holding the board's
 * seat lists it by name, so the reader that says which prerequisite is missing is
 * part of the round rather than a tool the seat has to leave for.
 */
export const RUN_DOCTOR_TOOL = "run_doctor";

/**
 * Parameter on the `subagent` tool that forces every spawned agent to a
 * read-only tool set. Plan mode sets it on every call while planning, and
 * refuses a `subagent` whose schema does not declare it. The board's write gate
 * pins it the same way while the session holds no card in `execute`.
 */
export const SUBAGENT_READ_ONLY_PARAM = "readOnly";

/**
 * The `write` tool. Plan mode hides it, and the board's write gate refuses it by the
 * lane of the card the session holds — two guards, one name, so a rename cannot leave
 * one of them judging a tool that no longer exists.
 */
export const WRITE_TOOL = "write";

/** The `edit` tool, judged by both the same way as {@link WRITE_TOOL}. */
export const EDIT_TOOL = "edit";

/**
 * The `bash` tool. Both modes keep it only so read-only git stays possible, and
 * `lib/git/read-command.ts` is the one body that decides — so the name is here rather
 * than spelled once per guard.
 */
export const BASH_TOOL = "bash";

/**
 * The `job` tool. It runs a background command, so the board's write gate judges it by the action a
 * call names — the gate names tools rather than importing another extension's verb table, so the
 * name lives here and the actions are the gate's own record.
 */
export const JOB_TOOL = "job";

/** The `watch` tool, judged as {@link JOB_TOOL} is: its `add` starts a command to tail. */
export const WATCH_TOOL = "watch";

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
