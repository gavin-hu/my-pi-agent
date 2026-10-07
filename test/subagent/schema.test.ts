import { describe, expect, test } from "bun:test";
import { MAX_PARALLEL_TASKS, resolveMode } from "../../extensions/subagent/schema.ts";

const task = (agent: string) => ({ agent, task: "do a thing" });

describe("resolveMode", () => {
	test("detects single mode from agent + task", () => {
		expect(resolveMode({ agent: "explorer", task: "find it" })).toEqual({ mode: "single" });
	});

	test("detects parallel mode from tasks", () => {
		expect(resolveMode({ tasks: [task("explorer"), task("planner")] })).toEqual({ mode: "parallel" });
	});

	test("detects chain mode from chain", () => {
		expect(resolveMode({ chain: [task("explorer"), task("planner")] })).toEqual({ mode: "chain" });
	});

	test("rejects an empty call", () => {
		const result = resolveMode({});
		expect("error" in result && result.error).toContain("Provide one mode");
	});

	test("rejects mixing chain with tasks", () => {
		const result = resolveMode({ chain: [task("explorer")], tasks: [task("planner")] });
		expect("error" in result && result.error).toContain("not both");
	});

	test("rejects mixing a single agent with tasks", () => {
		const result = resolveMode({ agent: "explorer", task: "x", tasks: [task("planner")] });
		expect("error" in result && result.error).toContain("not both");
	});

	test("rejects an agent without a task", () => {
		const result = resolveMode({ agent: "explorer" });
		expect("error" in result).toBe(true);
	});

	test("enforces the parallel task cap even when schema validation is bypassed", () => {
		const tooMany = new Array(MAX_PARALLEL_TASKS + 1).fill(null).map(() => task("explorer"));
		const rejected = resolveMode({ tasks: tooMany });
		expect("error" in rejected && rejected.error).toContain(`Max is ${MAX_PARALLEL_TASKS}`);

		const atCap = new Array(MAX_PARALLEL_TASKS).fill(null).map(() => task("explorer"));
		expect(resolveMode({ tasks: atCap })).toEqual({ mode: "parallel" });
	});
});
