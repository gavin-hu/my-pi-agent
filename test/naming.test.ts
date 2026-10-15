/**
 * Naming guard for the model-facing tools this package registers.
 *
 * The convention follows Claude Code's plan/worktree tools (EnterPlanMode,
 * ExitPlanMode, EnterWorktree, ExitWorktree, AskUserQuestion):
 *
 *   - lowercase snake_case;
 *   - a singleton tool is named for its domain (`todo`, `goal`, `job`,
 *     `subagent`);
 *   - a multi-word tool is verb-first (`enter_worktree`, `write_plan`,
 *     `ask_user_question`), except the documented noun-first carve-outs that
 *     mirror Claude Code (`web_search`, `web_fetch`).
 *
 * Built-in overrides (`read`/`write`/`edit`/`bash`/`grep`/`find`/`ls`) are
 * deliberately excluded: they reuse the built-in names.
 */

import { describe, expect, test } from "bun:test";
import { TODO_TOOL as todo } from "../lib/tool-names.ts";
import { TOOL_NAME as askUserQuestion } from "../extensions/question/tools.ts";
import { TOOL_NAME as readDoc } from "../extensions/document/tool.ts";
import { TOOL_NAME as runDoctor } from "../extensions/bytefly/doctor/tools.ts";
import { TOOL_NAME as openPath } from "../extensions/file-open/schema.ts";
import { TOOL_NAME as goal } from "../extensions/goal/tools.ts";
import { TOOL_NAME as job } from "../extensions/job/tools.ts";
import { TOOL_NAME as memory } from "../extensions/memory/tools.ts";
import { ENTER_TOOL, EXIT_TOOL, SET_PLAN_STEPS_TOOL, WRITE_PLAN_TOOL } from "../extensions/plan/runtime.ts";
import { TOOL_NAME as subagent } from "../extensions/subagent/index.ts";
import { TOOL_NAME as watch } from "../extensions/watch/tools.ts";
import { TOOL_NAME as webFetch } from "../extensions/web-access/fetch/tool.ts";
import { TOOL_NAME as webSearch } from "../extensions/web-access/search/tool.ts";
import { TOOL_NAME as wechatSend } from "../extensions/wechat/tools.ts";
import { WORKTREE_TOOLS } from "../extensions/worktree/tools.ts";

const NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

/** Multi-word names must start with a verb, except these Claude Code noun-first names. */
const NOUN_FIRST_CARVE_OUTS = new Set(["web_search", "web_fetch"]);

const LEADING_VERBS = new Set([
	"ask",
	"enter",
	"exit",
	"open",
	"prune",
	"list",
	"write",
	"read",
	"get",
	"set",
	"clear",
	"send",
	"start",
	"stop",
	"kill",
	"wait",
	"run",
]);

/** Every tool this package registers, with the extension that owns it. */
const REGISTERED: Array<{ extension: string; name: string }> = [
	{ extension: "question", name: askUserQuestion },
	{ extension: "document", name: readDoc },
	{ extension: "bytefly", name: runDoctor },
	{ extension: "file-open", name: openPath },
	{ extension: "goal", name: goal },
	{ extension: "job", name: job },
	{ extension: "memory", name: memory },
	{ extension: "plan", name: ENTER_TOOL },
	{ extension: "plan", name: WRITE_PLAN_TOOL },
	{ extension: "plan", name: EXIT_TOOL },
	{ extension: "plan", name: SET_PLAN_STEPS_TOOL },
	{ extension: "subagent", name: subagent },
	{ extension: "todo", name: todo },
	{ extension: "watch", name: watch },
	{ extension: "web-access", name: webFetch },
	{ extension: "web-access", name: webSearch },
	{ extension: "wechat", name: wechatSend },
	{ extension: "worktree", name: WORKTREE_TOOLS.enter },
	{ extension: "worktree", name: WORKTREE_TOOLS.exit },
	{ extension: "worktree", name: WORKTREE_TOOLS.prune },
	{ extension: "worktree", name: WORKTREE_TOOLS.list },
];

const names = REGISTERED.map((entry) => entry.name);

describe("extension tool naming", () => {
	test("every name is lowercase snake_case", () => {
		for (const { extension, name } of REGISTERED) {
			expect(NAME_PATTERN.test(name), `${extension}: ${name}`).toBe(true);
		}
	});

	test("names are unique", () => {
		expect(new Set(names).size).toBe(names.length);
	});

	test("multi-word names are verb-first (or documented noun-first carve-outs)", () => {
		for (const name of names) {
			if (!name.includes("_") || NOUN_FIRST_CARVE_OUTS.has(name)) continue;
			const leadingVerb = name.split("_")[0];
			expect(LEADING_VERBS.has(leadingVerb), `${name} should be verb-first`).toBe(true);
		}
	});

	test("the full registered set matches the reviewed snapshot", () => {
		expect([...names].sort()).toEqual([
			"ask_user_question",
			"enter_plan_mode",
			"enter_worktree",
			"exit_plan_mode",
			"exit_worktree",
			"goal",
			"job",
			"list_worktrees",
			"memory",
			"open_path",
			"prune_worktrees",
			"read_doc",
			"run_doctor",
			"send_wechat",
			"set_plan_steps",
			"subagent",
			"todo",
			"watch",
			"web_fetch",
			"web_search",
			"write_plan",
		]);
	});
});
