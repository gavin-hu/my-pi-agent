/**
 * The model-facing tools this package registers, and the extension that owns each.
 *
 * One list, two readers: `naming.test.ts` holds the name shape and the entry READMEs'
 * tool columns to it, and `tool-caps.test.ts` holds the schema each registered tool
 * publishes to the same set — so a tool cannot be documented, named, or shaped without
 * being on this list, and a list copied into a second file cannot drift from this one.
 *
 * Each name is imported from the module that registers it, never spelled here: a rename
 * breaks the build on both sides instead of leaving a stale string behind.
 */

import { TODO_TOOL as todo } from "../../lib/tool-names.ts";
import { BOARD_TOOL as board } from "../../extensions/board/types.ts";
import { TEAM_TOOL as team } from "../../extensions/team/types.ts";
import { TOOL_NAME as question } from "../../extensions/question/tools.ts";
import { TOOL_NAME as runDoctor } from "../../extensions/bytefly/doctor/tools.ts";
import { TOOL_NAME as readDoc } from "../../extensions/file-read/schema.ts";
import { TOOL_NAME as codeReview } from "../../extensions/code-review/schema.ts";
import { TOOL_NAME as openPath } from "../../extensions/file-open/schema.ts";
import { TOOL_NAME as goal } from "../../extensions/goal/tools.ts";
import { TOOL_NAME as job } from "../../extensions/job/tools.ts";
import { TOOL_NAME as memory } from "../../extensions/memory/tools.ts";
import { PLAN_TOOL } from "../../extensions/plan/runtime.ts";
import { TOOL_NAME as session } from "../../extensions/session-bus/tools.ts";
import { TOOL_NAME as subagent } from "../../extensions/subagent/index.ts";
import { TOOL_NAME as watch } from "../../extensions/watch/tools.ts";
import { TOOL_NAME as webFetch } from "../../extensions/web-access/fetch/tool.ts";
import { TOOL_NAME as webSearch } from "../../extensions/web-access/search/tool.ts";
import { TOOL_NAME as wechatSend } from "../../extensions/wechat/tools.ts";
import { WORKTREE_TOOL } from "../../extensions/worktree/tools.ts";

/** Every tool this package registers, with the extension that owns it. */
export const REGISTERED: ReadonlyArray<{ extension: string; name: string }> = [
	{ extension: "board", name: board },
	{ extension: "team", name: team },
	{ extension: "question", name: question },
	{ extension: "file-read", name: readDoc },
	{ extension: "bytefly", name: runDoctor },
	{ extension: "file-open", name: openPath },
	{ extension: "code-review", name: codeReview },
	{ extension: "goal", name: goal },
	{ extension: "job", name: job },
	{ extension: "memory", name: memory },
	{ extension: "plan", name: PLAN_TOOL },
	{ extension: "session-bus", name: session },
	{ extension: "subagent", name: subagent },
	{ extension: "todo", name: todo },
	{ extension: "watch", name: watch },
	{ extension: "web-access", name: webFetch },
	{ extension: "web-access", name: webSearch },
	{ extension: "wechat", name: wechatSend },
	{ extension: "worktree", name: WORKTREE_TOOL },
];
