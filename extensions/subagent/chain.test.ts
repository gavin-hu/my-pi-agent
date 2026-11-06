/**
 * Chain mode: `{previous}` is the prior step's output, verbatim up to the prompt cap.
 *
 * The step's task is a template and the prior output is arbitrary child text, so the
 * substitution must not read it as a replacement pattern — a diff, a regex, or a
 * shell `$'…'` in the first step's answer is what a review chain produces every day.
 * It is also bounded: the task is one argv element, and no platform accepts an
 * arbitrarily long one.
 */

import { describe, expect, test } from "bun:test";
import { runChainMode } from "./orchestrate.ts";
import { PREVIOUS_OUTPUT_CAP } from "./schema.ts";
import { createResult } from "./stream.ts";
import type { SingleResult } from "./types.ts";
import { assistantMessage } from "../../test/helpers/fixtures/subagent.ts";

/** One finished result carrying `text` as its final assistant message. */
function completed(text: string, agent = "explorer"): SingleResult {
	return { ...createResult(agent, "t"), exitCode: 0, messages: [assistantMessage(text)] };
}

/** Run a two-step chain and return the task the second step was given. */
async function secondTask(previousOutput: string): Promise<string> {
	let seen = "";
	const run = async (options: { agentName: string; task: string }) => {
		if (options.agentName === "worker") seen = options.task;
		return completed(options.agentName === "worker" ? "done" : previousOutput, options.agentName);
	};
	const result = await runChainMode({
		run: run as never,
		args: {
			chain: [
				{ agent: "explorer", task: "find it" },
				{ agent: "worker", task: "use this: {previous}." },
			],
		},
		defaults: {},
		defaultCwd: "/repo",
		makeDetails: (results) => ({ mode: "chain", results }),
	});
	expect(result.isError).toBeFalsy();
	return seen;
}

describe("a chain's {previous}", () => {
	test("inserts the prior output verbatim when it contains $ patterns", async () => {
		// `String.replace` would expand these: `$&` re-inserts the placeholder, `` $` `` the
		// template before it, `$1` a group that does not exist.
		const output = "cost is $& and $` end, $$1";
		expect(await secondTask(output)).toBe(`use this: ${output}.`);
	});

	test("keeps a plain output plain", async () => {
		expect(await secondTask("two files changed")).toBe("use this: two files changed.");
	});

	test("bounds a prior output too large for one argv element", async () => {
		// Over Linux's 128 KiB single-argument limit, so an uncapped substitution fails the
		// next step with `spawn E2BIG` before the child ever sees its prompt.
		const task = await secondTask("x".repeat(200 * 1024));
		expect(Buffer.byteLength(task)).toBeLessThan(PREVIOUS_OUTPUT_CAP + 1024);
		expect(task.startsWith("use this: xxx")).toBe(true);
		expect(task).toContain("[Output truncated: ");
	});
});
