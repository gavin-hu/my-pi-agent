/**
 * Always-on prompt budget: the per-turn injected context, and every tool surface a request pays for.
 *
 * The injected-context builders are pure, so a regression in the text re-injected every turn fails
 * fast. A tool's surface is its description, its line in the tools list, its guidelines, and its
 * parameter schema as JSON — summed the way a request pays for them — and the ceilings live in one
 * table, `CEILINGS`, one row per always-on multi-verb tool.
 *
 * Every number is measured on the **registered** surface (`helpers/registered.ts`), never on an
 * exported constant's copy: a ceiling read from an export would pass while the text the model
 * receives had grown, and the copy is the half that drifts. That is the same loader
 * `tool-caps.test.ts` uses for the schema keywords, so one definition answers both questions.
 * `test/dependencies.test.ts` holds the registration graph; this holds the text.
 */

import { describe, expect, test } from "bun:test";
import {
	buildBoardContext,
	buildLeadContext,
	LEAD_CONTEXT_MARKER,
	MAX_CONTEXT_CARDS,
	MAX_CONTEXT_CHARS,
	MAX_LEAD_CHARS,
	MAX_LEAD_LINES,
} from "../extensions/board/context.ts";
import { buildGoalContext, GOAL_CONTEXT_MARKER } from "../extensions/goal/index.ts";
import { PLAN_MODE_MARKER, planModeContext } from "../extensions/plan/index.ts";
import { WECHAT_CHANNEL_PROMPT } from "../extensions/wechat/text/channel.ts";
import { formatWorktreeSection } from "../extensions/worktree/index.ts";
import type { WorktreeState } from "../extensions/worktree/state.ts";
import { LEAD_ROUND } from "../lib/workflow/round-text.ts";
import { numberedCard } from "./helpers/fixtures/board.ts";
import { type RegisteredTool, registeredTools } from "./helpers/registered.ts";

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

/**
 * The always-on text of one tool, summed the way a request pays for it: its description, the
 * line in the tools list, its guidelines, and its parameter schema as JSON.
 *
 * Read from the *registered* definition (`helpers/registered.ts`), never from a constant's
 * copy. That is the rule the table below rests on: a ceiling measured on an export would pass
 * while the text the model receives had grown, and the copy is the half that drifts — so the
 * loader is shared with `tool-caps.test.ts`, which reads the same definitions' schema keywords.
 */
function surface(tool: RegisteredTool): number {
	return (
		tool.description.length +
		tool.promptSnippet.length +
		tool.promptGuidelines.join("\n").length +
		JSON.stringify(tool.parameters ?? {}).length
	);
}

/** The registered definition of one tool, or a failure naming which is missing. */
async function toolNamed(name: string): Promise<RegisteredTool> {
	const tool = (await registeredTools()).find((candidate) => candidate.name === name);
	if (tool === undefined) throw new Error(`no registered tool "${name}"`);
	return tool;
}

/** One surface's ceiling: the characters, the guidelines' joined length, and the longest bullet. */
interface Ceiling {
	tool: string;
	/** Most characters the registered surface may cost, measured. It may only fall. */
	max: number;
	/** Most characters the guidelines may join to, measured. It may only fall. */
	guidelines: number;
	/**
	 * The longest single bullet the surface had when it was first measured; a bullet may not grow
	 * past it. Per row rather than one number for the package: the 170 this file used to hold was
	 * what `board`'s three cost, and two surfaces that joined the table already had a 177 and a
	 * 178-character bullet, so a package-wide bound here would be a new rule, not a measurement.
	 */
	longest: number;
}

/**
 * The ceilings of every always-on multi-verb tool, measured rather than quoted.
 *
 * One table, one home: a tool with verbs pays for its whole surface on every request, so its
 * ceiling lives here, beside the three that had one before this table existed. The two
 * mode-shaped tools with no `action` parameter (`subagent`'s three modes, `send_wechat`'s one
 * of three fields) are rows too — they are just as redraw-heavy a call surface — and the case
 * below fails a registered tool that has an `action` and no row here, so a new verb-shaped tool
 * cannot arrive with nobody having measured it. A single-verb tool (`goal`, `todo`, `read_doc`,
 * `open_path`, `web_search`, `run_doctor`) is out of scope: it has no verb list to choose wrong —
 * unless its surface carries a configured value the model must know before it calls, which is why
 * `web_fetch` is a row: the body cap it publishes would otherwise grow unseen, and an unmeasured
 * surface drifts back into a refusal the model cannot anticipate (#898).
 */
const CEILINGS: readonly Ceiling[] = [
	// 8,156 before the restating bullets were cut; 7,200 held until `review` took the one-line
	// `override`; 6,378 after every union became a string enum; 6,284 when the two note fields
	// merged; 6,282 after #821, where `lane` gave up the transition clause `move`'s own doc states
	// and `root` gained the tree it names, paid out of that deletion.
	// 6,282 → 6,225 after #831: `contract`'s doc gave up the four field names its own parameters state
	// (−46), and `reclaim` gained the claim it leaves behind (+29, less than the deletion, so the
	// ceiling falls with the surface rather than staying where it was).
	// 6,225 → 6,197 after #944: `shelve` and `unshelve` (+129) and `until` (+83) were paid for by four
	// restatements — `list`'s `lane`/`mine`/`card` clauses, `move`'s `override` clause, `archive`'s
	// bound clause (its own `olderThan` states it), and `contract`'s "because the wording changed" —
	// plus shorter `action`, `query`, `path`, `verify` and `priority` descriptions. `review`'s
	// `session send` parenthetical and `list`'s group names were deliberately kept: each is a fact
	// stated nowhere else on this surface.
	{ tool: "board", max: 6_197, guidelines: 361, longest: 150 },
	// 3,111 before the verb list stopped being written twice; 2,349 after `claim`/`reclaim` left;
	// 2,335 when `action` became a string enum and the bus's bounds moved into the schema.
	{ tool: "team", max: 2_335, guidelines: 662, longest: 167 },
	// 2,135 before the parameters stopped restating the description; 2,159 after #748's bounds;
	// 2,154 after #821 — the `action` doc took the fact that separates the two readers (`inbox`
	// consumes, `read` keeps), and the description's `(consume/show)` copy is what paid for it.
	// 2,154 → 2,274 after #835: `release` took `holder`, ~120 net once `key` gave up its restatement
	// and `about` its `maxLength` tail — the field costs that and buys a peer's claims moving to the
	// seat, so a stalled wave is re-dispatchable without a restart. A ceiling that rises without the
	// second half is drift with a green test.
	{ tool: "session", max: 2_274, guidelines: 367, longest: 151 },
	{ tool: "plan", max: 5_575, guidelines: 617, longest: 157 },
	{ tool: "subagent", max: 2_757, guidelines: 602, longest: 137 },
	{ tool: "job", max: 2_670, guidelines: 431, longest: 128 },
	{ tool: "watch", max: 2_509, guidelines: 382, longest: 116 },
	{ tool: "worktree", max: 2_017, guidelines: 534, longest: 177 },
	// 1,889 -> 1,857 when `scope` stopped claiming it is used by four actions: `list` reads it too,
	// and the sentence that named the four was longer than the one that names what the field does.
	{ tool: "memory", max: 1_857, guidelines: 474, longest: 108 },
	{ tool: "question", max: 1_639, guidelines: 380, longest: 144 },
	{ tool: "send_wechat", max: 1_232, guidelines: 390, longest: 178 },
	{ tool: "code_review", max: 1_143, guidelines: 293, longest: 102 },
	// Measured at the commit that published the caps (#898): the row exists so the sentence naming the
	// configured body cap cannot grow without a gate saying so. `longest` is the second guideline (90),
	// not the surface's first impression of it.
	{ tool: "web_fetch", max: 2_195, guidelines: 208, longest: 90 },
];

describe("the always-on tool surfaces", () => {
	test("every verb-shaped tool is measured, and every ceiling names a registered tool", async () => {
		const tools = await registeredTools();
		const rows = new Set(CEILINGS.map((ceiling) => ceiling.tool));
		const missing = tools
			.filter((tool) => tool.parameters?.properties?.action !== undefined && !rows.has(tool.name))
			.map((tool) => tool.name);
		expect(missing, "add a measured row to CEILINGS").toEqual([]);
		const unknown = [...rows].filter((name) => !tools.some((tool) => tool.name === name));
		expect(unknown, "a ceiling for a tool this package does not register").toEqual([]);
	});

	test("holds each surface to its ceiling", async () => {
		const offenders: string[] = [];
		for (const ceiling of CEILINGS) {
			const tool = await toolNamed(ceiling.tool);
			const measured = surface(tool);
			if (measured > ceiling.max) offenders.push(`${ceiling.tool}: ${measured} > ${ceiling.max}`);
		}
		expect(offenders, "fund an addition by deleting a restatement, not by raising the ceiling").toEqual([]);
	});

	test("keeps each guideline to a bullet-sized line, in every measured tool", async () => {
		// Before #821 this bound was three copies of one case over three tools, so a surface that
		// joined the table arrived with no bullet bound at all — and two of the seven that joined
		// had a 177 and a 178-character bullet in place. The bound is now one case over the table,
		// and each row carries its own longest rather than the package adopting a number four
		// unmeasured surfaces would fail.
		const offenders: string[] = [];
		for (const ceiling of CEILINGS) {
			const tool = await toolNamed(ceiling.tool);
			const joined = tool.promptGuidelines.join("\n").length;
			if (joined > ceiling.guidelines) offenders.push(`${ceiling.tool}: guidelines ${joined} > ${ceiling.guidelines}`);
			for (const guideline of tool.promptGuidelines) {
				if (!guideline.endsWith(".")) offenders.push(`${ceiling.tool}: a guideline does not end with a full stop`);
				if (guideline.length > ceiling.longest) {
					offenders.push(`${ceiling.tool}: a guideline is ${guideline.length} > ${ceiling.longest}`);
				}
			}
		}
		expect(offenders).toEqual([]);
	});
});

describe("the team tool surface", () => {
	test("keeps every verb in the description", async () => {
		// The verb list is written once, in the description: the `action` parameter used to repeat
		// every sentence of it, and the copy is what drifted. `claim` and `reclaim` left because they
		// were two doors onto `board`'s store ops; the round keeps the verbs that reach another session.
		const tool = await toolNamed("team");
		for (const verb of ["assign", "offer", "ask"]) expect(tool.description).toContain(`\`${verb}\``);
	});

	test("states the lead's duty once, in the tool a lead works in", async () => {
		// `board`'s `approve` doc gave the `team.lead` key up to this bullet, so the two cannot
		// disagree about who signs; the gate's own sentence stays in the action doc that owns it.
		const tool = await toolNamed("team");
		const naming = tool.promptGuidelines.filter((guideline) => guideline.includes("team.lead"));
		expect(naming).toHaveLength(1);
		expect(naming[0]).toContain("`approve`");
		expect(naming[0]).toContain("`review`");
		// The round's one line, spliced from `lib/workflow/round-text.ts`: `/team`'s description says
		// the same sentence, so the two surfaces that name the round cannot describe it differently.
		expect(naming[0]).toContain(LEAD_ROUND);
	});
});

describe("the session tool surface", () => {
	test("names every action in its description", async () => {
		// The prose and the schema cannot drift apart: every verb a caller can pass is one the
		// description tells it about.
		const tool = await toolNamed("session");
		for (const action of ["status", "send", "inbox", "read", "claim", "release", "join"]) {
			expect(tool.description).toContain(`\`${action}\``);
		}
	});

	test("says which reader consumes the mail, in the field the verb is chosen in", async () => {
		// `inbox` consumes what it showed and `read` keeps every file (`tools.ts`), which is the
		// difference between losing mail and keeping it. The one-word standoff `(consume/show)` is
		// what a model read as a blur, so the sentence lives in the `action` description — where the
		// choice is made — and the description gave up its copy to pay for it.
		const tool = await toolNamed("session");
		expect(tool.parameters?.properties?.action?.description).toContain("`inbox` consumes, `read` keeps");
	});

	test("keeps claim and release on paths, which is what separates them from board's card verbs", async () => {
		// `board` claims a card and this claims a file: the object is the whole difference, so it
		// stays in the line a caller reads before choosing a tool.
		const tool = await toolNamed("session");
		expect(tool.description).toContain("`claim`/`release` (paths)");
	});
});

describe("the board tool surface", () => {
	test("keeps three guidelines, and leaves every other fact to the field or action that owns it", async () => {
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
		// 14 `approve`'s doc gave up when `team` took the config key. Then two sentences changed
		// hands: `reclaim`'s gained the lead's authority it had dropped (+23, the sentence `team`
		// had been stating alone), paid by the two gate clauses `approve` and `review` still
		// carried and the first guideline already states (-75) — 7,121. Then `reclaim` gained the
		// holder's case (+38: a holder's reclaim is its own `release`, and the name alone does not
		// say so), paid by `edit`'s field list that every parameter description already states (-69).
		// 7,013, measured rather than quoted: the surface stood 77 under the 7,090 this comment had
		// been calling "today", and `query` took the card's id in for no character at all —
		// `or a note matches` → `or note match` funds `id, `. It then stood 15 under 7,013 without this
		// comment hearing of it — 6,998 at the base of the cap raise. That raise cost 31: 2 for the two
		// note descriptions' digits, and 29 for the cap clause `verify` never stated until it shared
		// `MAX_CONTRACT` with its three siblings. It gave back 30, which is why the surface is 6,999:
		// `review` repeated `approve`'s "the lead, who does not hold the card" and now says "the same
		// lead" (-23), and `blockedBy` writes `≤` where it wrote "at most" (-7) — which is how its 200
		// came to be the `MAX_BLOCKED` every other capped description reads.
		//
		// #748 then moved every cap out of the prose and into the schema, which is where Pi validates
		// it: the five union fields became string enums (-670, the form a provider that supports
		// neither `anyOf` nor `const` needs) and the caps became `maxLength`/`maxItems` read from their
		// constants (+49 against the deleted `≤N characters` clauses). 6,378 ≤ 6,378 then, and that
		// was the largest single fall the surface had taken. The bounds themselves are held by
		// `tool-caps.test.ts`, which reads them from the registered schemas; this file is budgets.
		// #752 then merged the two note fields — `add`'s `note` and the `text` three other verbs
		// published for the same thing — so one field's JSON left while a description absorbed it:
		// 6,378 → 6,284, and the ceiling fell with the surface rather than keeping 94 characters
		// nobody measured: 6,284 ≤ 6,284. #821 spent the passage the other way: `root` gained the tree
		// it names (+58) and `lane` gave up the transition clause `move`'s own doc already states, so
		// the four blocks come to 6,282 and the ceiling lives in `CEILINGS` with the others.
		//
		// What stays here is the shape, not the price: three bullets, one idea each.
		const tool = await toolNamed("board");
		expect(tool.promptGuidelines).toHaveLength(3);
	});

	test("the seat's line stays inside its own ceiling, every turn", () => {
		// Paid on every turn while the seat is held, so the ceiling is the price of the mode: the
		// literals are here as well as in the constant, so lowering the constant cannot lower the
		// budget the mode is held to. #854 spent 140 of the rise on the round the line now carries —
		// a blocked card with its decision and the seat's own mail — so 620 is a decision, not a drift.
		const many = Array.from({ length: 40 }, (_, index) => `#${100 + index}`);
		const line = buildLeadContext({
			approve: many,
			review: many,
			untold: many,
			unclaimed: many,
			blocked: many.map((ref) => ({ ref, why: "x".repeat(200) })),
			mail: 12,
			peers: many,
		});
		expect(MAX_LEAD_CHARS).toBe(620);
		expect(MAX_LEAD_LINES).toBe(6);
		expect(line.length).toBeLessThanOrEqual(620);
		expect(line.split("\n").length).toBeLessThanOrEqual(6);
		expect(line.startsWith(LEAD_CONTEXT_MARKER)).toBe(true);
		expect(line).toContain("/board stop");
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
