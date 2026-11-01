/**
 * What a failed run hands the model.
 *
 * `run.ts` accumulates a child's stderr without a bound, so a failing build or a verbose stack
 * trace used to arrive in the tool result whole — 3 MiB in the reported case — while the same
 * failure in parallel mode was capped. The cap is the mode runner's, not the stream helper's,
 * so it is pinned here through the tool: one case per mode, plus the success path the cap
 * deliberately leaves alone.
 */

import { describe, expect, test } from "bun:test";
import { callTool } from "../../test/helpers/tools.ts";
import { MODEL_OUTPUT_CAP } from "./schema.ts";
import { emptyUsage } from "./stream.ts";
import type { SingleResult } from "./types.ts";
import { assistantMessage, fakeToolCtx, registerSubagentTool } from "../../test/helpers/fixtures/subagent.ts";

/** Three mebibytes of child noise, the size the report measured. */
const HUGE_STDERR = "npm ERR! build failed\n".repeat(Math.ceil((3 * 1024 * 1024) / 23));

/** A failure carrying the noise in `stderr`, which is what `getResultOutput` falls back to. */
function noisyFailure(agent: string): SingleResult {
	return {
		agent,
		task: "t",
		exitCode: 1,
		messages: [],
		stderr: HUGE_STDERR,
		usage: emptyUsage(),
		stopReason: "error",
	};
}

function call(tool: unknown, params: unknown): Promise<any> {
	return callTool(tool, params, fakeToolCtx());
}

/** Bytes of the reply, which is what the parent's context pays for. */
const replyBytes = (text: string): number => Buffer.byteLength(text, "utf8");

describe("a failed run's model-facing text", () => {
	test("single mode caps the child's stderr and keeps it whole in details", async () => {
		const tool = registerSubagentTool(async () => noisyFailure("explorer"));

		const result = await call(tool, { agent: "explorer", task: "build it" });
		const text: string = result.content[0].text;

		expect(result.isError).toBe(true);
		expect(text).toContain("Agent explorer error:");
		expect(replyBytes(text)).toBeLessThan(MODEL_OUTPUT_CAP + 200);
		expect(text).toContain("[Output truncated:");
		expect(text).toContain("Full output preserved in tool details.");
		expect(result.details.results[0].stderr).toBe(HUGE_STDERR);
	});

	test("chain mode caps the failing step's stderr and keeps it whole in details", async () => {
		const tool = registerSubagentTool(async (options) =>
			options.agentName === "planner"
				? noisyFailure("planner")
				: {
						agent: options.agentName,
						task: "t",
						exitCode: 0,
						messages: [assistantMessage("found it")],
						stderr: "",
						usage: emptyUsage(),
					},
		);

		const result = await call(tool, {
			chain: [
				{ agent: "explorer", task: "one" },
				{ agent: "planner", task: "two" },
			],
		});
		const text: string = result.content[0].text;

		expect(result.isError).toBe(true);
		expect(text).toContain("Chain stopped at step 2 (planner):");
		expect(replyBytes(text)).toBeLessThan(MODEL_OUTPUT_CAP + 200);
		expect(text).toContain("[Output truncated:");
		expect(result.details.results[1].stderr).toBe(HUGE_STDERR);
	});

	test("a successful single reply is returned whole, since only a failure is noise", async () => {
		const big = "x".repeat(MODEL_OUTPUT_CAP + 1_000);
		const tool = registerSubagentTool(async (options) => ({
			agent: options.agentName,
			task: "t",
			exitCode: 0,
			messages: [assistantMessage(big)],
			stderr: "",
			usage: emptyUsage(),
		}));

		const result = await call(tool, { agent: "explorer", task: "summarise" });

		expect(result.isError).toBeUndefined();
		expect(result.content[0].text).toBe(big);
	});
});
