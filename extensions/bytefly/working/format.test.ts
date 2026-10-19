import { describe, expect, test } from "bun:test";
import { formatElapsed, workingCounter } from "./format.ts";

describe("formatElapsed", () => {
	test("reads sub-second and zero as 0s", () => {
		expect(formatElapsed(0)).toBe("0s");
		expect(formatElapsed(999)).toBe("0s");
	});

	test("counts whole seconds under a minute", () => {
		expect(formatElapsed(1000)).toBe("1s");
		expect(formatElapsed(42_400)).toBe("42s");
		expect(formatElapsed(59_900)).toBe("59s");
	});

	test("pads seconds once past a minute", () => {
		expect(formatElapsed(60_000)).toBe("1m00s");
		expect(formatElapsed(65_000)).toBe("1m05s");
	});

	test("drops seconds once past an hour", () => {
		expect(formatElapsed(3_600_000)).toBe("1h00m");
		expect(formatElapsed(3_930_000)).toBe("1h05m");
	});

	test("treats a backwards or invalid clock as 0s", () => {
		expect(formatElapsed(-1)).toBe("0s");
		expect(formatElapsed(Number.NaN)).toBe("0s");
		expect(formatElapsed(Number.POSITIVE_INFINITY)).toBe("0s");
	});
});

describe("workingCounter", () => {
	test("shapes the working message", () => {
		expect(workingCounter(4000)).toBe("Working… 4s");
	});

	test("keeps the plain count before the first tool starts", () => {
		expect(workingCounter(4000, { tool: null, tools: 0 })).toBe("Working… 4s");
	});

	test("names the tool and its count once one has started", () => {
		expect(workingCounter(4000, { tool: "edit", tools: 1 })).toBe("edit · 1 tool · 4s");
	});

	test("pluralizes the tool count", () => {
		expect(workingCounter(4000, { tool: "edit", tools: 3 })).toBe("edit · 3 tools · 4s");
	});

	test("omits an empty tool name but keeps the count", () => {
		expect(workingCounter(4000, { tool: "", tools: 2 })).toBe("2 tools · 4s");
	});

	test("sanitizes a tool name to one line", () => {
		expect(workingCounter(4000, { tool: "a\nb", tools: 1 })).toBe("a b · 1 tool · 4s");
	});
});
