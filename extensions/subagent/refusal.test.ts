/**
 * What a refused call and an aborted run report.
 *
 * A refusal is not a success: a model that reads "Too many background runs" as a normal
 * result plans on a run that never started. A call that would exceed the session's children
 * is refused whole for the same reason — a batch that half-ran leaves the model planning on
 * results it half has. And a child aborted mid-flight has spent tokens, so its partial usage
 * is published before the abort is rethrown.
 */

import { describe, expect, test } from "bun:test";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { SUBAGENT_FINISHED_CHANNEL } from "../../lib/events.ts";
import { callTool, resultText } from "../../test/helpers/tools.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import {
	assistantMessage,
	fakeToolCtx,
	registerSubagentTool as register,
} from "../../test/helpers/fixtures/subagent.ts";
import { createResult, emptyUsage } from "./stream.ts";
import type { SingleResult, SubagentDetails } from "./types.ts";

const ctx = () => fakeToolCtx({ cwd: "/repo" });
/** The branch a background call records its entry on. */
const branchCtx = () => ({ ...ctx(), sessionManager: fakeCtx({ sessionId: "s1" }).ctx.sessionManager });

describe("a refused background call", () => {
	test("an unknown agent is an error, not a result", async () => {
		const tool = register(async () => ({ ...createResult("explorer", "t"), exitCode: 0 }));
		const result = await callTool(tool, { agent: "ghost", task: "t", background: true }, ctx());
		expect(result.isError).toBe(true);
	});

	test("a full background capacity is an error, not a result", async () => {
		const tool = register(async () => new Promise<SingleResult>(() => {}));
		for (let i = 0; i < 4; i++) {
			const started = await callTool(tool, { agent: "explorer", task: "t", background: true }, branchCtx());
			expect(started.isError).toBeFalsy();
		}
		const refused = await callTool(tool, { agent: "explorer", task: "t", background: true }, branchCtx());
		expect(refused.isError).toBe(true);
	});
});

describe("a call that would exceed the session's children", () => {
	/** A child that never settles, so a call's children stay in flight. */
	const never = async () => new Promise<SingleResult>(() => {});
	/** A child that settles at once, so a call releases what it reserved. */
	const settle = async () => ({ ...createResult("explorer", "t"), exitCode: 0 });
	/** A batch of `count` independent tasks. */
	const tasks = (count: number) =>
		Array.from({ length: count }, (_, index) => ({ agent: "explorer", task: `t${index}` }));
	/** What a race returns when the call did not settle, so a missing refusal fails instead of hanging the suite. */
	const PENDING = "still running";

	/** Await a call only once it has settled by itself: a refusal returns at once, a started run waits on its child. */
	async function settled(call: Promise<AgentToolResult<SubagentDetails>>): Promise<AgentToolResult<SubagentDetails>> {
		expect(await Promise.race([call, PENDING]), "the call should have been refused at once").not.toBe(PENDING);
		return call;
	}

	test("is refused whole, naming what is in flight and what it planned", async () => {
		const tool = register(never);
		void callTool(tool, { tasks: tasks(8) }, ctx());
		const refused = await settled(callTool(tool, { agent: "explorer", task: "t" }, ctx()));
		expect(refused.isError).toBe(true);
		expect(resultText(refused)).toContain("8 in flight, this call plans 1");
	});

	test("reserves a batch's whole plan, though only four of it runs at once", async () => {
		const tool = register(never);
		void callTool(tool, { tasks: tasks(8) }, ctx());
		const refused = await settled(callTool(tool, { tasks: tasks(4) }, ctx()));
		expect(refused.isError).toBe(true);
		expect(resultText(refused)).toContain("8 in flight, this call plans 4");
	});

	test("lets two batches of four share the eight, so the cap is the sum of plans", async () => {
		const tool = register(never);
		void callTool(tool, { tasks: tasks(4) }, ctx());
		void callTool(tool, { tasks: tasks(4) }, ctx());
		const refused = await settled(callTool(tool, { agent: "explorer", task: "t" }, ctx()));
		expect(refused.isError).toBe(true);
	});

	test("releases what it reserved once the call settles", async () => {
		const tool = register(settle);
		for (let call = 0; call < 9; call++) {
			const result = await callTool(tool, { tasks: tasks(8) }, ctx());
			expect(result.isError, `call ${call + 1} of 9`).toBeFalsy();
		}
	});
});

describe("an aborted run", () => {
	test("publishes the usage it reached before the abort", async () => {
		const partial: SingleResult = {
			...createResult("explorer", "t"),
			messages: [assistantMessage("half", { input: 700, output: 40 })],
			usage: { ...emptyUsage(), turns: 1, input: 700, output: 40, cost: 0.04 },
			exitCode: 1,
			stopReason: "aborted",
			errorMessage: "Aborted",
		};
		const tool = register(async () => {
			throw Object.assign(new Error("Subagent was aborted"), { result: partial });
		});
		const seen: unknown[] = [];
		tool.pi.events.on(SUBAGENT_FINISHED_CHANNEL, (event: unknown) => seen.push(event));
		// The abort rejects the call, and the event is published before that reaches the host.
		await expect(callTool(tool, { agent: "explorer", task: "t" }, ctx())).rejects.toThrow("Subagent was aborted");
		expect(seen).toHaveLength(1);
		expect((seen[0] as { input?: number }).input).toBe(700);
	});
});
