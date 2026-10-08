/**
 * Naming guard for the model-facing tools this package registers.
 *
 * The convention follows Claude Code's plan/worktree tools (EnterPlanMode,
 * ExitPlanMode, EnterWorktree, ExitWorktree, AskUserQuestion):
 *
 *   - lowercase snake_case;
 *   - a singleton tool is named for its domain (`git`, `todo`, `goal`, `job`,
 *     `subagent`);
 *   - a multi-word tool is verb-first (`enter_worktree`, `write_plan`,
 *     `ask_user_question`), except the documented noun-first carve-outs that
 *     mirror Claude Code (`web_search`, `web_fetch`).
 *
 * Built-in overrides (`read`/`write`/`edit`/`bash`/`grep`/`find`/`ls`) are
 * deliberately excluded: they reuse the built-in names.
 */

import { describe, expect, test } from "bun:test";
import { TODO_TOOL as todo } from "../extensions/_shared/tool-names.ts";
import { TOOL_NAME as askUserQuestion } from "../extensions/ask-user-question/tools.ts";
import { TOOL_NAME as git } from "../extensions/git/index.ts";
import { TOOL_NAME as goal } from "../extensions/goal/tools.ts";
import { TOOL_NAME as job } from "../extensions/jobs/tools.ts";
import { ENTER_TOOL, EXIT_TOOL, WRITE_PLAN_TOOL } from "../extensions/plan-mode/runtime.ts";
import { TOOL_NAME as subagent } from "../extensions/subagent/index.ts";
import { TOOL_NAME as webFetch } from "../extensions/web-access/fetch/tool.ts";
import { TOOL_NAME as webSearch } from "../extensions/web-access/search/tool.ts";
import { WORKTREE_TOOLS } from "../extensions/worktree/tools.ts";

const NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

/** Multi-word names must start with a verb, except these Claude Code noun-first names. */
const NOUN_FIRST_CARVE_OUTS = new Set(["web_search", "web_fetch"]);

const LEADING_VERBS = new Set([
	"ask",
	"enter",
	"exit",
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
	{ extension: "ask-user-question", name: askUserQuestion },
	{ extension: "git", name: git },
	{ extension: "goal", name: goal },
	{ extension: "jobs", name: job },
	{ extension: "plan-mode", name: ENTER_TOOL },
	{ extension: "plan-mode", name: WRITE_PLAN_TOOL },
	{ extension: "plan-mode", name: EXIT_TOOL },
	{ extension: "subagent", name: subagent },
	{ extension: "todo", name: todo },
	{ extension: "web-access", name: webFetch },
	{ extension: "web-access", name: webSearch },
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
			"git",
			"goal",
			"job",
			"list_worktrees",
			"prune_worktrees",
			"subagent",
			"todo",
			"web_fetch",
			"web_search",
			"write_plan",
		]);
	});
});
