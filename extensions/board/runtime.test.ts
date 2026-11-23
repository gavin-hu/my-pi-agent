/**
 * The seat's runtime: what it hides, what it refuses, and what it records.
 *
 * The gate's cases are about the default rather than a list: a tool nobody allowed
 * is refused, a read-only tool the host annotated passes even though the list has
 * never heard of it, and every refusal names the hatch.
 */

import { describe, expect, test } from "bun:test";
import { LEAD_MODE_ENTRY_TYPE } from "../../lib/mode-state.ts";
import { STATUS_KEYS } from "../../lib/tui/glyphs.ts";
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

/** A pi whose `subagent` declares the read-only pin, plus one annotated reader the list has never heard of. */
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

	test("records the seat on the branch, and adopts it again on restore", () => {
		const first = setup({ active: ["read", "write"] });
		first.runtime.enable(first.ctx);
		const entry = first.entries.at(-1);
		expect(entry?.customType).toBe(LEAD_MODE_ENTRY_TYPE);
		expect((entry?.data as { enabled?: unknown }).enabled).toBe(true);
		expect((entry?.data as { removed?: unknown }).removed).toEqual(["write"]);

		// A resumed session reads the list the branch carries rather than capturing a new one.
		const resumed = setup({
			active: ["read", "plan"],
			branch: [{ type: "custom", customType: LEAD_MODE_ENTRY_TYPE, data: { enabled: true, removed: ["write"] } }],
		});
		resumed.runtime.restore(resumed.ctx);
		expect(resumed.runtime.isEnabled()).toBe(true);
		expect(resumed.activeTools()).toEqual(["read", "plan"]);
		resumed.runtime.disable(resumed.ctx);
		expect(resumed.activeTools()).toContain("write");
	});

	test("publishes the seat's chip, and clears it on the way out", () => {
		const { runtime, ctx, statusCalls } = setup();
		runtime.enable(ctx);
		expect(statusCalls).toContainEqual({ key: STATUS_KEYS.leadMode, text: "⏵ lead" });
		runtime.disable(ctx);
		expect(statusCalls.at(-1)).toEqual({ key: STATUS_KEYS.leadMode, text: undefined });
	});

	test("a different branch that does not hold the seat restores nothing", () => {
		const { runtime, ctx, activeTools } = setup({ active: ["read", "write"], branch: [] });
		runtime.restore(ctx);
		expect(runtime.isEnabled()).toBe(false);
		expect(activeTools()).toEqual(["read", "write"]);
	});
});

describe("lead runtime — the gate", () => {
	test("refuses code by name, and names the hatch", async () => {
		const { runtime, ctx } = setup();
		runtime.enable(ctx);
		for (const tool of ["edit", "write", "worktree", "job", "watch"]) {
			const reason = await runtime.refusal(tool, {});
			expect(reason).toContain(tool);
			expect(reason).toContain("/board exit");
		}
	});

	test("allows the coordination surface and the readers", async () => {
		const { runtime, ctx } = setup();
		runtime.enable(ctx);
		for (const tool of ["board", "team", "session", "todo", "goal", "question", "read", "grep", "web_search"]) {
			expect(await runtime.refusal(tool, {})).toBeUndefined();
		}
	});

	test("denies by default, and passes only an annotated read-only stranger", async () => {
		const { runtime, ctx } = setup();
		runtime.enable(ctx);
		expect(await runtime.refusal("mcp_read", {})).toBeUndefined();
		expect(await runtime.refusal("mcp_write", {})).toContain("/board exit");
		expect(await runtime.refusal("mystery", {})).toContain("/board exit");
	});

	test("keeps the plan tool for a card's plan, and refuses entering plan mode", async () => {
		const { runtime, ctx } = setup();
		runtime.enable(ctx);
		expect(await runtime.refusal("plan", { action: "write" })).toBeUndefined();
		expect(await runtime.refusal("plan", { action: "steps" })).toBeUndefined();
		const enter = await runtime.refusal("plan", { action: "enter" });
		expect(enter).toContain("/board exit");
	});

	test("judges bash as read-only git, and runs what it approved", async () => {
		const { runtime, ctx } = setup();
		runtime.enable(ctx);
		const log: Record<string, unknown> = { command: "git log -1" };
		expect(await runtime.refusal("bash", log)).toBeUndefined();
		expect(log.command).toContain("--no-textconv");

		const write = await runtime.refusal("bash", { command: "rm -rf build" });
		expect(write).toContain("in lead mode");
		expect(write).toContain("/board exit");
		expect(await runtime.refusal("bash", { command: "  " })).toContain("/board exit");
	});

	test("forces a delegated child read-only, and refuses one that cannot be", async () => {
		const pinned = setup();
		pinned.runtime.enable(pinned.ctx);
		const call: Record<string, unknown> = { prompt: "look" };
		expect(await pinned.runtime.refusal("subagent", call)).toBeUndefined();
		expect(call.readOnly).toBe(true);

		const unpinned = setup({ pinnedSubagent: false });
		unpinned.runtime.enable(unpinned.ctx);
		expect(await unpinned.runtime.refusal("subagent", { prompt: "look" })).toContain("/board exit");
	});

	test("says nothing at all while the seat is not held", async () => {
		const { runtime } = setup();
		expect(await runtime.refusal("edit", {})).toBeUndefined();
		expect(await runtime.refusal("bash", { command: "rm -rf build" })).toBeUndefined();
	});
});

describe("lead runtime — what it allows", () => {
	test("allows the seat's own verbs and the readers, and nothing else", () => {
		for (const tool of ["board", "team", "session", "plan", "todo", "goal", "question", "bash", "read_doc"]) {
			expect(LEAD_ALLOWED_TOOLS).toContain(tool as never);
		}
		for (const tool of ["edit", "write", "worktree", "job", "watch"]) {
			expect(LEAD_ALLOWED_TOOLS).not.toContain(tool as never);
		}
		expect(LEAD_PHRASING.label).toBe("lead mode");
	});
});
