/**
 * The lag reminder at the settle boundary: the one continuation it forces, and every
 * call that must not force one.
 *
 * A suite of its own because these cases drive the whole extension — `todo(pi)` and the
 * host's events — where `runtime.test.ts` drives the runtime they share, and because the
 * settle boundary is where the tracker rule is proved rather than only its classifier.
 */

import { describe, expect, test } from "bun:test";
import todo, { TODO_NUDGE_CONTEXT_TYPE } from "./index.ts";
import { EMPTY_LIST_MUTATIONS, TODO_NUDGE_MARKER } from "./nudge.ts";
import { TOOL_NAME } from "./tools.ts";
import type { Todo } from "./types.ts";
import { emit, emitFirst, makeFakePi } from "../../test/helpers/fakes.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { otherMessage } from "../../test/helpers/entries.ts";
import { nudgeMessage, resultEntry } from "../../test/helpers/fixtures/todo.ts";

const pending = (content: string): Todo => ({ content, status: "pending" });
const completed = (content: string): Todo => ({ content, status: "completed" });

describe("lag reminder integration", () => {
	async function started(branch: unknown[] = []) {
		const { pi, handlers, tools } = makeFakePi();
		todo(pi);
		const { ctx } = fakeCtx({ mode: "print", branch });
		await emit(pi, "session_start", { reason: "startup" }, ctx);
		return { pi, handlers, tools, ctx };
	}

	const settle = { type: "agent_before_settle", outcome: "completed", entries: [] } as const;
	const work = { type: "tool_execution_end", toolName: "edit" } as const;

	test("injects one reminder when work happened without a todo update", async () => {
		const { pi, ctx } = await started([resultEntry([pending("one")])]);
		await emit(pi, "tool_execution_end", work, ctx);

		const result = await emitFirst(pi, "agent_before_settle", settle, ctx);
		expect(result.continue).toBe(true);
		expect(result.entries).toHaveLength(1);
		expect(result.entries[0].type).toBe("custom_message");
		expect(result.entries[0].customType).toBe(TODO_NUDGE_CONTEXT_TYPE);
		expect(result.entries[0].display).toBe(false);
		expect(result.entries[0].content).toContain(TODO_NUDGE_MARKER);
	});

	test("does not remind without work, for read-only work, or for a failed tool call", async () => {
		const cases: Array<{ name: string; event?: unknown; branch?: unknown[] }> = [
			{ name: "no work" },
			{ name: "read-only", event: { type: "tool_execution_end", toolName: "read" } },
			{ name: "failed", event: { type: "tool_execution_end", toolName: "edit", isError: true } },
		];
		for (const { name, event, branch = [resultEntry([pending("one")])] } of cases) {
			const { pi, ctx } = await started(branch);
			if (event) await emit(pi, "tool_execution_end", event, ctx);
			expect(await emitFirst(pi, "agent_before_settle", settle, ctx), name).toBeUndefined();
		}
	});

	test("appends the reminder to boundary entries another handler proposed", async () => {
		const { pi, ctx } = await started([resultEntry([pending("one")])]);
		await emit(pi, "tool_execution_end", work, ctx);
		const prior = { type: "custom", customType: "other-ext", data: {} };
		const result = await emitFirst(pi, "agent_before_settle", { ...settle, entries: [prior] }, ctx);
		expect(result.continue).toBe(true);
		expect(result.entries).toEqual([
			prior,
			expect.objectContaining({ type: "custom_message", customType: TODO_NUDGE_CONTEXT_TYPE }),
		]);
	});

	test("does not remind when every item is completed or there is only a single edit", async () => {
		const completedRun = await started([resultEntry([completed("done")])]);
		await emit(completedRun.pi, "tool_execution_end", work, completedRun.ctx);
		expect(await emitFirst(completedRun.pi, "agent_before_settle", settle, completedRun.ctx)).toBeUndefined();

		const emptyRun = await started();
		await emit(emptyRun.pi, "tool_execution_end", work, emptyRun.ctx);
		expect(await emitFirst(emptyRun.pi, "agent_before_settle", settle, emptyRun.ctx)).toBeUndefined();
	});

	test("does not remind for a session tracker's call, though its hint says it may write", async () => {
		// plan and goal really do write — a plan file outside the checkout, session entries — so
		// their hint is `readOnlyHint: false` and the fall-through counted a planning turn as work.
		// The host supplies the hint; this double gives it the two trackers as that host would.
		const { pi, ctx } = await started([resultEntry([pending("one")])]);
		pi.allTools = [
			{ name: "plan", annotations: { readOnlyHint: false } },
			{ name: "goal", annotations: { readOnlyHint: false } },
		];
		for (const toolName of ["plan", "goal"]) {
			await emit(pi, "tool_execution_end", { type: "tool_execution_end", toolName }, ctx);
			expect(await emitFirst(pi, "agent_before_settle", settle, ctx), toolName).toBeUndefined();
		}
		// An edit in the same session still reminds, so the case cannot pass by silencing the rule.
		await emit(pi, "tool_execution_end", work, ctx);
		expect(await emitFirst(pi, "agent_before_settle", settle, ctx)).toBeDefined();
	});

	test("does not remind for a card write or a bus message, and does remind for a review", async () => {
		// The other half of the class: a card and the bus live in the agent directory too, so a claim,
		// a note or a send says nothing about the checkout. `review` is the one board call that can have
		// done work, because it runs the contract's command in the tree the card names. It comes last
		// because the reminder is capped at one per user turn, so an earlier one would mask it.
		const { pi, ctx } = await started([resultEntry([pending("one")])]);
		pi.allTools = [
			{ name: "board", annotations: { readOnlyHint: false } },
			{ name: "session", annotations: { readOnlyHint: false } },
		];
		const call = (toolName: string, action: string) => ({
			type: "tool_execution_end",
			toolName,
			result: { details: { action } },
		});
		await emit(pi, "tool_execution_end", call("board", "contract"), ctx);
		await emit(pi, "tool_execution_end", call("session", "send"), ctx);
		expect(await emitFirst(pi, "agent_before_settle", settle, ctx)).toBeUndefined();

		await emit(pi, "tool_execution_end", call("board", "review"), ctx);
		expect(await emitFirst(pi, "agent_before_settle", settle, ctx)).toBeDefined();
	});

	test("reminds after repeated work with no list", async () => {
		const { pi, ctx } = await started();
		for (let i = 0; i < EMPTY_LIST_MUTATIONS; i++) await emit(pi, "tool_execution_end", work, ctx);

		const result = await emitFirst(pi, "agent_before_settle", settle, ctx);
		expect(result.continue).toBe(true);
		expect(result.entries[0].content).toContain("no todo list was recorded");
	});

	test("does not remind for repeated shell reads with no list", async () => {
		const { pi, ctx } = await started();
		for (let i = 0; i < EMPTY_LIST_MUTATIONS; i++) {
			await emit(pi, "tool_execution_end", { type: "tool_execution_end", toolName: "bash" }, ctx);
		}

		expect(await emitFirst(pi, "agent_before_settle", settle, ctx)).toBeUndefined();
	});

	test("does not second-guess a list the model cleared this turn", async () => {
		const { pi, tools, ctx } = await started();
		await tools.get(TOOL_NAME).execute("call-1", { todos: [] }, undefined, undefined, ctx);
		for (let i = 0; i < EMPTY_LIST_MUTATIONS; i++) await emit(pi, "tool_execution_end", work, ctx);

		expect(await emitFirst(pi, "agent_before_settle", settle, ctx)).toBeUndefined();
	});

	test("reminds at most once per user turn", async () => {
		const { pi, ctx } = await started([resultEntry([pending("one")])]);
		await emit(pi, "tool_execution_end", work, ctx);
		const first = await emitFirst(pi, "agent_before_settle", settle, ctx);
		const second = await emitFirst(pi, "agent_before_settle", settle, ctx);
		expect(first.continue).toBe(true);
		expect(second).toBeUndefined();
	});

	test("does not remind for an aborted or failed run", async () => {
		const { pi, ctx } = await started([resultEntry([pending("one")])]);
		await emit(pi, "tool_execution_end", work, ctx);
		const result = await emitFirst(pi, "agent_before_settle", { type: "agent_before_settle", outcome: "aborted" }, ctx);
		expect(result).toBeUndefined();
	});

	test("a new user turn clears the lag window and expires the reminder", async () => {
		const { pi, ctx } = await started([resultEntry([pending("one")])]);
		await emit(pi, "tool_execution_end", work, ctx);
		await emitFirst(pi, "agent_before_settle", settle, ctx);
		await emit(pi, "before_agent_start", {}, ctx);
		const result = await emitFirst(pi, "agent_before_settle", settle, ctx);
		expect(result).toBeUndefined();
	});

	test("strips a stale reminder and keeps only the newest while active", async () => {
		const { pi, ctx } = await started([resultEntry([pending("one")])]);
		const stripped = await emitFirst(pi, "context", { messages: [nudgeMessage(), otherMessage()] }, ctx);
		expect(stripped.messages).toEqual([otherMessage()]);

		await emit(pi, "tool_execution_end", work, ctx);
		await emitFirst(pi, "agent_before_settle", settle, ctx);
		const newest = nudgeMessage("newest");
		const kept = await emitFirst(pi, "context", { messages: [nudgeMessage(), otherMessage(), newest] }, ctx);
		expect(kept.messages).toEqual([otherMessage(), newest]);
	});
});
