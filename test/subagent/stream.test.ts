import { describe, expect, test } from "bun:test";
import {
	applyEvent,
	emptyUsage,
	getFinalOutput,
	getResultOutput,
	isFailedResult,
	mapWithConcurrencyLimit,
	parseJsonLine,
	truncateOutput,
} from "../../extensions/subagent/stream.ts";
import type { SingleResult } from "../../extensions/subagent/types.ts";
import { assistantMessage } from "./helpers.ts";

function result(): SingleResult {
	return { agent: "explorer", task: "t", exitCode: 0, messages: [], stderr: "", usage: emptyUsage() };
}

describe("parseJsonLine", () => {
	test("parses objects and ignores blanks and garbage", () => {
		expect(parseJsonLine('{"type":"message_end"}')).toEqual({ type: "message_end" });
		expect(parseJsonLine("")).toBeUndefined();
		expect(parseJsonLine("   ")).toBeUndefined();
		expect(parseJsonLine("not json")).toBeUndefined();
		expect(parseJsonLine("42")).toBeUndefined();
	});
});

describe("applyEvent", () => {
	test("records assistant messages and sums usage across turns", () => {
		const target = result();
		applyEvent(target, { type: "message_end", message: assistantMessage("one", { input: 10, output: 2, totalTokens: 12, cost: 0.1 }) });
		applyEvent(target, { type: "message_end", message: assistantMessage("two", { input: 5, output: 3, cacheRead: 4, cacheWrite: 1, totalTokens: 20, cost: 0.2 }) });

		expect(target.messages).toHaveLength(2);
		expect(target.usage).toMatchObject({ turns: 2, input: 15, output: 5, cacheRead: 4, cacheWrite: 1, contextTokens: 20 });
		expect(target.usage.cost).toBeCloseTo(0.3);
		expect(target.model).toBe("claude-sonnet-4-5");
	});

	test("keeps the first model and the latest stop reason", () => {
		const target = result();
		applyEvent(target, { type: "message_end", message: assistantMessage("x", { model: "first", stopReason: "error", errorMessage: "boom" }) });
		applyEvent(target, { type: "message_end", message: assistantMessage("y", { model: "second" }) });
		expect(target.model).toBe("first");
		expect(target.stopReason).toBe("stop");
		expect(target.errorMessage).toBe("boom");
	});

	test("records non-assistant messages without touching usage", () => {
		const target = result();
		applyEvent(target, { type: "message_end", message: { role: "user", content: "hi" } });
		expect(target.messages).toHaveLength(1);
		expect(target.usage.turns).toBe(0);
	});

	test("counts tool execution errors but does not fail the run", () => {
		const target = result();
		expect(applyEvent(target, { type: "tool_execution_end", isError: true })).toBe(true);
		expect(applyEvent(target, { type: "tool_execution_end", isError: false })).toBe(false);
		expect(target.toolErrors).toBe(1);
		expect(isFailedResult(target)).toBe(false);
	});

	test("ignores unrelated events", () => {
		expect(applyEvent(result(), { type: "tool_execution_start" })).toBe(false);
		expect(applyEvent(result(), null)).toBe(false);
	});
});

describe("result helpers", () => {
	test("getFinalOutput returns the last assistant text", () => {
		const target = result();
		target.messages.push(assistantMessage("first"), assistantMessage("last"));
		expect(getFinalOutput(target.messages)).toBe("last");
		expect(getFinalOutput([])).toBe("");
	});

	test("isFailedResult covers exit code and stop reasons", () => {
		expect(isFailedResult(result())).toBe(false);
		expect(isFailedResult({ ...result(), exitCode: 1 })).toBe(true);
		expect(isFailedResult({ ...result(), stopReason: "error" })).toBe(true);
		expect(isFailedResult({ ...result(), stopReason: "aborted" })).toBe(true);
	});

	test("getResultOutput prefers error detail over output", () => {
		const target = result();
		target.messages.push(assistantMessage("partial"));
		target.stopReason = "error";
		target.errorMessage = "model exploded";
		expect(getResultOutput(target)).toBe("model exploded");
		target.errorMessage = undefined;
		target.stderr = "stderr text";
		expect(getResultOutput(target)).toBe("stderr text");
		target.stderr = "";
		expect(getResultOutput(target)).toBe("partial");
		expect(getResultOutput(result())).toBe("(no output)");
	});
});

describe("truncateOutput", () => {
	test("leaves short output unchanged", () => {
		expect(truncateOutput("hello", 100)).toBe("hello");
	});

	test("caps UTF-8 bytes and reports what was omitted", () => {
		const text = "é".repeat(100); // 200 bytes
		const truncated = truncateOutput(text, 50);
		expect(Buffer.byteLength(truncated, "utf8")).toBeGreaterThan(50);
		expect(truncated).toContain("Output truncated");
		expect(truncated.startsWith("é".repeat(25))).toBe(true);
	});
});

describe("mapWithConcurrencyLimit", () => {
	test("preserves input order", async () => {
		const output = await mapWithConcurrencyLimit([1, 2, 3, 4, 5], 2, async (value) => {
			await new Promise((resolve) => setTimeout(resolve, (6 - value) * 2));
			return value * 10;
		});
		expect(output).toEqual([10, 20, 30, 40, 50]);
	});

	test("never exceeds the concurrency limit", async () => {
		let active = 0;
		let peak = 0;
		await mapWithConcurrencyLimit([1, 2, 3, 4, 5, 6], 2, async () => {
			active++;
			peak = Math.max(peak, active);
			await new Promise((resolve) => setTimeout(resolve, 1));
			active--;
		});
		expect(peak).toBeLessThanOrEqual(2);
	});

	test("returns an empty array for no items", async () => {
		expect(await mapWithConcurrencyLimit([], 4, async () => 1)).toEqual([]);
	});
});
