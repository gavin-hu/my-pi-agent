/**
 * The seat's runtime: what it hides, what it refuses, and what it records.
 *
 * The gate's cases are about a closed list rather than a default: a tool the list never
 * named is refused however it annotates itself, and every refusal names the hatch.
 */

import { describe, expect, test } from "bun:test";
import { LEAD_MODE_ENTRY_TYPE } from "../../lib/mode-state.ts";
import { GLYPHS, STATUS_KEYS } from "../../lib/tui/glyphs.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { createFakePi } from "../../test/helpers/fakes.ts";
import { createLeadRuntime, LEAD_ALLOWED_TOOLS, LEAD_PHRASING } from "./runtime.ts";

const ACTIVE = [
	"read",
	"grep",
	"bash",
	"write",
	"edit",
	"worktree",
	"job",
	"watch",
	"powershell",
	"board",
	"team",
	"session",
	"plan",
	"todo",
	"goal",
	"question",
	"web_search",
	"web_fetch",
	"subagent",
];

/** A pi whose `subagent` declares the read-only pin, plus two annotated strangers the list has never heard of. */
function makePi(options: { active?: string[]; pinnedSubagent?: boolean; allTools?: unknown[] } = {}) {
	const subagent =
		options.pinnedSubagent === false
			? { name: "subagent", parameters: { properties: {} } }
			: {
					name: "subagent",
					parameters: { properties: { readOnly: { type: "boolean" } } },
				};
	return createFakePi({
		active: options.active ?? ACTIVE,
		allTools: options.allTools ?? [
			subagent,
			{ name: "mcp_read", annotations: { readOnlyHint: true } },
			{ name: "mcp_write", annotations: { readOnlyHint: false } },
			{ name: "mystery" },
		],
	});
}

function setup(options: { active?: string[]; pinnedSubagent?: boolean; branch?: unknown[] } = {}) {
	const fake = makePi(options);
	const ctx = fakeCtx({ mode: "tui", hasUI: true, branch: options.branch ?? [] });
	return { ...fake, ctx: ctx.ctx, statusCalls: ctx.statusCalls, runtime: createLeadRuntime(fake.pi) };
}

describe("lead runtime — the tool set", () => {
	test("hides the code tools and keeps the coordination surface", () => {
		const { runtime, ctx, activeTools } = setup();
		runtime.enable(ctx);
		const active = activeTools();
		for (const kept of ["read", "grep", "bash", "board", "team", "session", "plan", "todo", "goal", "question"]) {
			expect(active).toContain(kept);
		}
		for (const hidden of ["write", "edit", "worktree", "job", "watch", "powershell"]) {
			expect(active).not.toContain(hidden);
		}
	});

	test("leaving puts the user's set back, without the tool the seat had to activate", () => {
		const { runtime, ctx, activeTools } = setup({ active: ["read", "write", "bash"] });
		runtime.enable(ctx);
		expect(activeTools()).toContain("plan");
		runtime.disable(ctx);
		expect(activeTools().sort()).toEqual(["bash", "read", "write"]);
	});

	test("records the seat on the branch when the user takes it", () => {
		const { runtime, ctx, entries } = setup({ active: ["read", "write"] });
		runtime.enable(ctx);
		const entry = entries.at(-1);
		expect(entry?.customType).toBe(LEAD_MODE_ENTRY_TYPE);
		expect((entry?.data as { enabled?: unknown }).enabled).toBe(true);
		expect((entry?.data as { removed?: unknown }).removed).toEqual(["write"]);
	});

	test("publishes the seat's chip, and clears it on the way out", () => {
		const { runtime, ctx, statusCalls } = setup();
		runtime.enable(ctx);
		expect(statusCalls).toContainEqual({ key: STATUS_KEYS.leadMode, text: `${GLYPHS.lead} lead` });
		runtime.disable(ctx);
		expect(statusCalls.at(-1)).toEqual({ key: STATUS_KEYS.leadMode, text: undefined });
	});

	test("a branch that does not hold the seat restores nothing", () => {
		const { runtime, ctx, activeTools } = setup({ active: ["read", "write"], branch: [] });
		runtime.reconcile(ctx, true);
		expect(runtime.isEnabled()).toBe(false);
		expect(activeTools()).toEqual(["read", "write"]);
	});
});

/** A branch the seat is recorded on, as one entry. */
function seatBranch(removed: string[] = ["write"]): unknown[] {
	return [{ type: "custom", customType: LEAD_MODE_ENTRY_TYPE, data: { enabled: true, removed } }];
}

/**
 * The one reconcile: what the branch and the page say together, and the exit that outranks both.
 *
 * The five states are the arms and disarms the mode had no door for, and the last two cases are
 * tonight's defect: an off-switch that said it worked while the gate kept the leash.
 */
describe("lead runtime — reconcile", () => {
	test("arms from a lead branch while the page is served here, and records nothing", () => {
		const { runtime, ctx, activeTools, entries } = setup({ active: ["read", "write", "bash"], branch: seatBranch() });
		runtime.reconcile(ctx, true);
		expect(runtime.isEnabled()).toBe(true);
		expect(activeTools()).toContain("read");
		expect(activeTools()).not.toContain("write");
		// The branch already says it: arming is an adoption, not a second write.
		expect(entries).toHaveLength(0);
	});

	test("a lead branch with no page here stays off, and clears the chip", () => {
		const { runtime, ctx, activeTools, entries, statusCalls } = setup({
			active: ["read", "write"],
			branch: seatBranch(),
		});
		runtime.reconcile(ctx, false);
		expect(runtime.isEnabled()).toBe(false);
		expect(activeTools()).toEqual(["read", "write"]);
		expect(entries).toHaveLength(0);
		expect(statusCalls.at(-1)).toEqual({ key: STATUS_KEYS.leadMode, text: undefined });
	});

	test("a page that stops puts the user's set back and says so on the branch", () => {
		const { runtime, ctx, activeTools, entries } = setup({ active: ["read", "write"], branch: seatBranch() });
		runtime.reconcile(ctx, true);
		runtime.reconcile(ctx, false);
		expect(runtime.isEnabled()).toBe(false);
		expect(activeTools()).toContain("write");
		const entry = entries.at(-1);
		expect(entry?.customType).toBe(LEAD_MODE_ENTRY_TYPE);
		expect((entry?.data as { enabled?: unknown }).enabled).toBe(false);
	});

	test("a branch that moved on disarms without re-adding the host's set", () => {
		const branch = seatBranch();
		const { runtime, ctx, activeTools, entries } = setup({ active: ["read", "write"], branch });
		runtime.reconcile(ctx, true);
		branch.splice(0);
		runtime.reconcile(ctx, true);
		expect(runtime.isEnabled()).toBe(false);
		// The host put the target branch's base set back; re-adding would widen it.
		expect(activeTools()).not.toContain("write");
		expect(entries).toHaveLength(0);
	});

	test("asking the same question twice changes nothing", () => {
		const { runtime, ctx, activeTools, entries, statusCalls } = setup({
			active: ["read", "write"],
			branch: seatBranch(),
		});
		runtime.reconcile(ctx, true);
		const narrowed = activeTools();
		const drawn = statusCalls.length;
		runtime.reconcile(ctx, true);
		expect(activeTools()).toEqual(narrowed);
		expect(entries).toHaveLength(0);
		// The chip is redrawn and nothing else moves: no entry, no second hide.
		expect(statusCalls.length).toBe(drawn + 1);
	});

	test("an exit holds for the session even when the branch still says lead", () => {
		const { runtime, ctx } = setup({ active: ["read", "write"], branch: seatBranch() });
		runtime.reconcile(ctx, true);
		runtime.disable(ctx);
		expect(runtime.isEnabled()).toBe(false);
		// The branch this double carries never took the write — tonight's lost-write state.
		runtime.reconcile(ctx, true);
		expect(runtime.isEnabled()).toBe(false);
	});

	test("a new session is a new role: the latch does not carry over", () => {
		const branch = seatBranch();
		const { runtime, ctx } = setup({ active: ["read", "write"], branch });
		runtime.reconcile(ctx, true);
		runtime.disable(ctx);
		const next = fakeCtx({ mode: "tui", hasUI: true, branch, sessionId: "s2" }).ctx;
		runtime.reconcile(next, true);
		expect(runtime.isEnabled()).toBe(true);
	});
});

describe("lead runtime — the gate", () => {
	test("refuses code by name, and names the hatch", async () => {
		const { runtime, ctx } = setup();
		runtime.enable(ctx);
		for (const tool of ["edit", "write", "worktree", "job", "watch"]) {
			const reason = await runtime.refusal(tool, {});
			expect(reason).toContain(tool);
			expect(reason).toContain("/board stop");
		}
	});

	test("allows the coordination surface and the readers", async () => {
		const { runtime, ctx } = setup();
		runtime.enable(ctx);
		for (const tool of [
			"board",
			"team",
			"session",
			"todo",
			"goal",
			"question",
			"read",
			"grep",
			"web_search",
			"run_doctor",
		]) {
			expect(await runtime.refusal(tool, {})).toBeUndefined();
		}
	});

	test("refuses a stranger however it annotates itself", async () => {
		const { runtime, ctx } = setup();
		runtime.enable(ctx);
		// `readOnlyHint` is the tool's own testimony; the closed list is the decision.
		expect(await runtime.refusal("mcp_read", {})).toContain("/board stop");
		expect(await runtime.refusal("mcp_write", {})).toContain("/board stop");
		expect(await runtime.refusal("mystery", {})).toContain("/board stop");
	});

	test("keeps the plan tool for a card's plan, and refuses entering plan mode", async () => {
		const { runtime, ctx } = setup();
		runtime.enable(ctx);
		expect(await runtime.refusal("plan", { action: "write" })).toBeUndefined();
		expect(await runtime.refusal("plan", { action: "steps" })).toBeUndefined();
		const enter = await runtime.refusal("plan", { action: "enter" });
		expect(enter).toContain("/board stop");
	});

	test("judges bash as read-only git, and runs what it approved", async () => {
		const { runtime, ctx } = setup();
		runtime.enable(ctx);
		const log: Record<string, unknown> = { command: "git log -1" };
		expect(await runtime.refusal("bash", log)).toBeUndefined();
		expect(log.command).toContain("--no-textconv");

		const write = await runtime.refusal("bash", { command: "rm -rf build" });
		expect(write).toContain("in lead mode");
		expect(write).toContain("/board stop");
		expect(await runtime.refusal("bash", { command: "  " })).toContain("/board stop");
	});

	test("names the by-revision forms between the reason and the hatch", async () => {
		const { runtime, ctx } = setup();
		runtime.enable(ctx);
		const line = await runtime.refusal("bash", { command: "git -C /tmp/other status" });
		expect(line).toContain('"git -C" is not a read-only subcommand.');
		expect(line).toContain("`git show <sha>:<path>`");
		// The hatch stays last: the alternative sits between the reason and the way out.
		expect(line?.indexOf("`git show <sha>:<path>`")).toBeLessThan(line?.indexOf("/board stop") ?? -1);

		// A subcommand's own `-c` runs now; the global one is still refused by position.
		expect(await runtime.refusal("bash", { command: "git grep -c TODO" })).toBeUndefined();
		const global = await runtime.refusal("bash", { command: "git -c alias.x=!sh x" });
		expect(global).toContain("/board stop");
		expect(global).not.toContain("`git show <sha>:<path>`");
	});

	test("forces a delegated child read-only, and refuses one that cannot be", async () => {
		const pinned = setup();
		pinned.runtime.enable(pinned.ctx);
		const call: Record<string, unknown> = { prompt: "look" };
		expect(await pinned.runtime.refusal("subagent", call)).toBeUndefined();
		expect(call.readOnly).toBe(true);

		const unpinned = setup({ pinnedSubagent: false });
		unpinned.runtime.enable(unpinned.ctx);
		expect(await unpinned.runtime.refusal("subagent", { prompt: "look" })).toContain("/board stop");
	});

	test("says nothing at all while the seat is not held", async () => {
		const { runtime } = setup();
		expect(await runtime.refusal("edit", {})).toBeUndefined();
		expect(await runtime.refusal("bash", { command: "rm -rf build" })).toBeUndefined();
	});
});

describe("lead runtime — what it allows", () => {
	test("allows the seat's own verbs and the readers, and nothing else", () => {
		for (const tool of [
			"board",
			"team",
			"session",
			"plan",
			"todo",
			"goal",
			"question",
			"bash",
			"read_doc",
			"run_doctor",
		]) {
			expect(LEAD_ALLOWED_TOOLS).toContain(tool as never);
		}
		for (const tool of ["edit", "write", "worktree", "job", "watch"]) {
			expect(LEAD_ALLOWED_TOOLS).not.toContain(tool as never);
		}
		expect(LEAD_PHRASING.label).toBe("lead mode");
	});
});
