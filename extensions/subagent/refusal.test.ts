/**
 * What a refused call and an aborted run report.
 *
 * A refusal is not a success: a model that reads "Too many background runs" as a normal
 * result plans on a run that never started. And a child aborted mid-flight has spent
 * tokens, so its partial usage is published before the abort is rethrown.
 */

import { describe, expect, test } from "bun:test";
import { SUBAGENT_FINISHED_CHANNEL } from "../../lib/events.ts";
import { callTool } from "../../test/helpers/tools.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import {
	assistantMessage,
	fakeToolCtx,
	registerSubagentTool as register,
} from "../../test/helpers/fixtures/subagent.ts";
import { createResult, emptyUsage } from "./stream.ts";
import type { SingleResult } from "./types.ts";

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
