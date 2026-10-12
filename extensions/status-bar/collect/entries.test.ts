import { describe, expect, test } from "bun:test";
import { scanUsage } from "./entries.ts";

const assistant = (usage: any) => ({ type: "message", message: { role: "assistant", usage } });
const toolResult = (usage: any) => ({ type: "message", message: { role: "toolResult", usage } });
const usageEntry = (usage: any) => ({ type: "usage", usage });

const u = (input: number, output: number, cacheRead: number, cacheWrite: number, total: number) => ({
	input,
	output,
	cacheRead,
	cacheWrite,
	cost: { total },
});

describe("scanUsage", () => {
	test("sums every usage source and tracks the latest cache hit rate", () => {
		const entries = [
			assistant(u(100, 50, 100, 0, 0.01)),
			usageEntry(u(10, 5, 0, 20, 0.02)),
			toolResult(u(1, 1, 0, 0, 0.001)),
			{ type: "compaction", usage: u(2, 2, 0, 0, 0.003) },
			{ type: "message", message: { role: "user" } },
		];

		const { usage, cacheHitRate } = scanUsage(entries);

		expect(usage.input).toBe(113);
		expect(usage.output).toBe(58);
		expect(usage.cacheRead).toBe(100);
		expect(usage.cacheWrite).toBe(20);
		expect(usage.cost).toBeCloseTo(0.034);
		// latest assistant: prompt = 100 + 100 + 0, cacheRead = 100.
		expect(cacheHitRate).toBeCloseTo(50);
	});

	test("is empty for no entries", () => {
		expect(scanUsage([])).toEqual({
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
			cacheHitRate: null,
		});
	});
});
