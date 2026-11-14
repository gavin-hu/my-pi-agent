/**
 * Always-on prompt budget: the per-turn injected context, and the one tool surface large
 * enough to have its own ceiling.
 *
 * The injected-context builders are pure, so a regression in the text re-injected every turn
 * fails fast. The board tool's surface is the largest in the package, so its four blocks are
 * summed here the way a request pays for them; `test/dependencies.test.ts` holds the
 * registration graph, and this holds the text.
 */

import { describe, expect, test } from "bun:test";
import { BoardParams } from "../extensions/board/schema.ts";
import { BOARD_DESCRIPTION, BOARD_GUIDELINES, BOARD_SNIPPET } from "../extensions/board/tools.ts";
import { TEAM_DESCRIPTION, TEAM_GUIDELINES, TEAM_SNIPPET } from "../extensions/team/types.ts";
import { TeamParams } from "../extensions/team/schema.ts";
import { buildBoardContext, MAX_CONTEXT_CHARS, MAX_CONTEXT_CARDS } from "../extensions/board/context.ts";
import { numberedCard } from "./helpers/fixtures/board.ts";
import { GOAL_CONTEXT_MARKER, buildGoalContext } from "../extensions/goal/index.ts";
import { planModeContext, PLAN_MODE_MARKER } from "../extensions/plan/index.ts";
import { WECHAT_CHANNEL_PROMPT } from "../extensions/wechat/text/channel.ts";
import { formatWorktreeSection } from "../extensions/worktree/index.ts";
import type { WorktreeState } from "../extensions/worktree/state.ts";

const WORKTREE: WorktreeState = {
	active: true,
	path: "/main/.pi/worktrees/feat",
	branch: "worktree-feat",
	repoRoot: "/main",
	baseRef: "HEAD",
	baseRefMode: "head",
	createdByUs: true,
};

describe("injected prompt budget", () => {
	test("plan mode context stays within its ceiling", () => {
		const context = planModeContext();
		expect(context.length).toBeLessThanOrEqual(960);
		expect(context).toContain(PLAN_MODE_MARKER);
	});

	test("an active goal adds one bullet and stays within the ceiling", () => {
		const context = planModeContext({ objective: "x".repeat(2000), status: "active" });
		expect(context).toContain("- Current session goal: ");
		expect(context.split("\n").length).toBe(planModeContext().split("\n").length + 1);
		// The objective is clipped, with an ellipsis, so a long goal cannot break the
		// ceiling; `goal` still injects the full objective every turn.
		expect(context).toContain("…");
		expect(context.length).toBeLessThanOrEqual(960);
	});

	test("an achieved goal is not restated", () => {
		expect(planModeContext({ objective: "done", status: "achieved" })).toBe(planModeContext());
	});

	test("goal context is the marker plus the objective, with no fixed prose", () => {
		expect(buildGoalContext({ objective: "ship it", status: "active" })).toBe(`${GOAL_CONTEXT_MARKER}\nship it`);
	});

	test("worktree section stays within its ceiling and keeps the facts", () => {
		const section = formatWorktreeSection(WORKTREE);
		expect(section.length).toBeLessThanOrEqual(260);
		expect(section).toContain(WORKTREE.path);
		expect(section).toContain("worktree` action `exit");
	});

	test("an inherited worktree says not to exit it", () => {
		expect(formatWorktreeSection({ ...WORKTREE, borrowed: true })).toContain("inherited");
	});

	test("the wechat channel contract stays within its ceiling and names the medium", () => {
		// Always on for every peer request: keep it small, and keep the rules a
		// terminal-shaped answer gets wrong (the phone, and commands).
		expect(WECHAT_CHANNEL_PROMPT.length).toBeLessThanOrEqual(700);
		expect(WECHAT_CHANNEL_PROMPT.split("\n").length).toBeLessThanOrEqual(12);
		expect(WECHAT_CHANNEL_PROMPT).toContain("on a phone");
		expect(WECHAT_CHANNEL_PROMPT).toContain("run a command");
		expect(WECHAT_CHANNEL_PROMPT).toContain("recommendation");
		expect(WECHAT_CHANNEL_PROMPT).toContain("attachment");
	});
});

/** The `team` tool's always-on characters, summed the same way and for the same reason. */
function teamSurface(): number {
	return (
		TEAM_DESCRIPTION.length +
		TEAM_SNIPPET.length +
		TEAM_GUIDELINES.join("\n").length +
		JSON.stringify(TeamParams).length
	);
}

describe("the team tool surface", () => {
	test("stays under its ceiling, and keeps every verb in the description", () => {
		// 3,111 before the verb list stopped being written twice: the `action` parameter repeated
		// every sentence of the description, and the copy is what drifted, so the parameter now
		// names the fields each verb reads and the description is the only place that says what a
		// verb does. The fifth guideline is the lead's duty, the one thing no action doc owned;
		// 2,686 today, and the ceiling is what stops a surface with no gate before it growing back.
		expect(teamSurface()).toBeLessThanOrEqual(2_700);
		expect(TEAM_GUIDELINES.join("\n").length).toBeLessThanOrEqual(720);
	});

	test("states the lead's duty once, in the tool a lead works in", () => {
		// `board`'s `approve` doc gave the `team.lead` key up to this bullet, so the two cannot
		// disagree about who signs; the gate's own sentence stays in the action doc that owns it.
		const naming = TEAM_GUIDELINES.filter((guideline) => guideline.includes("team.lead"));
		expect(naming).toHaveLength(1);
		expect(naming[0]).toContain("`approve`");
		expect(naming[0]).toContain("`review`");
	});
});

/** The board tool's always-on characters, summed the way a request pays for them. */
function boardSurface(): number {
	return (
		BOARD_DESCRIPTION.length +
		BOARD_SNIPPET.length +
		BOARD_GUIDELINES.join("\n").length +
		JSON.stringify(BoardParams).length
	);
}

describe("the board tool surface", () => {
	test("stays under its ceiling, with three guidelines", () => {
		// 8,156 characters before the restating bullets were cut; the ceiling is what the
		// three that are not already in the schema, the description, or the action docs cost.
		// 7,200 held until `review` took the one-line `override`, which is the record a card
		// closed outside the gate had no way to carry: that parameter costs ~200 and buys the
		// difference between a forced close and a signed one. A card's `type` and `breaking`
		// cost ~330 more, paid by the description's facet list and by dropping the parameter
		// descriptions that restated the action docs. The surface then drifted 7 under 7,400
		// without the sentence here saying so, which is why the number below is measured rather
		// than quoted: 6,986 today, after a pass that deleted only what was written twice —
		// `contract` repeating `path`'s sentence, `list` repeating the refusal `card` names and
		// the `query` match `query` names, `verify` repeating the approval rule the contract's
		// line already states, and `action` pointing at the description right above it — and
		// tightened `approve` and `archived` without losing a field. The last four came off
		// `verify`, which stopped promising that an empty command takes the line off the moment a
		// contract could not be approved without one. `round`'s nine group names stayed:
		// `tools.test.ts` holds that every group the rollup reports reaches the model named.
		// 7,193 for `olderThan`: the archive sweep's one bound, a parameter and its line in the
		// action doc, which buys the difference between clearing a graveyard and archiving what
		// just shipped. The workflow then moved into the first guideline — both gates, so a
		// checklist no longer stops at `execute` — paid by 12 characters off the second and the
		// 14 `approve`'s doc gave up when `team` took the config key: 7,173 today. The gate is the
		// number; this comment is why.
		expect(boardSurface()).toBeLessThanOrEqual(7_193);
		expect(BOARD_GUIDELINES).toHaveLength(3);
		expect(BOARD_GUIDELINES.join("\n").length).toBeLessThanOrEqual(400);
	});

	test("keeps each guideline to a bullet-sized line", () => {
		for (const guideline of BOARD_GUIDELINES) {
			expect(guideline.endsWith(".")).toBe(true);
			expect(guideline.length).toBeLessThanOrEqual(170);
		}
	});

	test("the first-turn line stays inside its own ceiling", () => {
		// Injected once per session, before its first turn: it is spent once, but it is spent in
		// every session that holds a card, so it is held to the same kind of budget as plan mode.
		const held = [1, 2, 3, 4, 5].map((n) => numberedCard(String(n), { lane: "plan", owner: { label: "api-core" } }));
		const line = buildBoardContext(held) ?? "";
		expect(line.length).toBeLessThanOrEqual(MAX_CONTEXT_CHARS);
		expect(line.split("\n").length).toBeLessThanOrEqual(MAX_CONTEXT_CARDS + 2);
	});
});
