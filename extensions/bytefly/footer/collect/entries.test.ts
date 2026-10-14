import { describe, expect, test } from "bun:test";
import { usageRecords } from "./entries.ts";

const ACTIVE = { provider: "anthropic", model: "opus-4.5" };

const u = (input: number, output: number, cacheRead: number, cacheWrite: number, total: number) => ({
	input,
	output,
	cacheRead,
	cacheWrite,
	cost: { total },
});

const assistant = (usage: any) => ({
	type: "message",
	timestamp: "2026-01-05T03:00:00.000Z",
	message: { role: "assistant", provider: "anthropic", model: "opus-4.5", usage },
});

const toolResult = (usage: any, timestamp: number) => ({
	type: "message",
	message: { role: "toolResult", usage, timestamp },
});

describe("usageRecords", () => {
	test("reads every usage source", () => {
		const entries = [
			assistant(u(100, 50, 100, 0, 0.01)),
			{
				type: "usage",
				provider: "deepseek",
				model: "deepseek-flash",
				usage: u(10, 5, 0, 20, 0.02),
				timestamp: "2026-01-05T04:00:00.000Z",
			},
			toolResult(u(1, 1, 0, 0, 0.001), 1_700_000_000_000),
			{ type: "compaction", usage: u(2, 2, 0, 0, 0.003), timestamp: "2026-01-05T05:00:00.000Z" },
			{ type: "message", message: { role: "user" } },
		];

		const { records } = usageRecords(entries, ACTIVE);

		expect(records).toHaveLength(4);
		expect(records[0]).toMatchObject({ input: 100, output: 50, cacheRead: 100, recordedCost: 0.01, isAssistant: true });
		expect(records[1]).toMatchObject({
			provider: "deepseek",
			model: "deepseek-flash",
			cacheWrite: 20,
			recordedCost: 0.02,
		});
		expect(records[2]).toMatchObject({ cacheWrite: 0, at: 1_700_000_000_000 });
		expect(records[3]).toMatchObject({ input: 2, output: 2 });
	});

	test("keeps the latest assistant cache hit rate", () => {
		const { cacheHitRate } = usageRecords(
			[assistant(u(100, 50, 100, 0, 0.01)), assistant(u(100, 10, 300, 0, 0.02))],
			ACTIVE,
		);
		expect(cacheHitRate).toBeCloseTo(75);
	});

	test("reports 0% when the latest assistant read no cache", () => {
		const { cacheHitRate } = usageRecords(
			[assistant(u(100, 50, 100, 0, 0.01)), assistant(u(100, 10, 0, 0, 0.02))],
			ACTIVE,
		);
		expect(cacheHitRate).toBe(0);
	});

	test("is null when the latest assistant had no prompt at all", () => {
		const { cacheHitRate } = usageRecords(
			[assistant(u(100, 50, 100, 0, 0.01)), assistant(u(0, 10, 0, 0, 0.02))],
			ACTIVE,
		);
		expect(cacheHitRate).toBeNull();
	});

	test("inherits the model in effect for an entry that does not name one", () => {
		const entries = [
			{ type: "model_change", provider: "deepseek", modelId: "deepseek-flash" },
			toolResult(u(1, 1, 0, 0, 0), 1),
		];

		expect(usageRecords(entries, ACTIVE).records[0]).toMatchObject({ provider: "deepseek", model: "deepseek-flash" });
	});

	test("lets an assistant call move the model in effect", () => {
		const entries = [assistant(u(1, 1, 0, 0, 0)), toolResult(u(1, 1, 0, 0, 0), 1)];

		const records = usageRecords(entries, { provider: "deepseek", model: "deepseek-flash" }).records;

		expect(records[1]).toMatchObject({ provider: "anthropic", model: "opus-4.5" });
	});

	test("prefers an entry's own model over the model in effect", () => {
		const entries = [
			{ type: "model_change", provider: "deepseek", modelId: "deepseek-flash" },
			assistant(u(1, 1, 0, 0, 0)),
		];

		expect(usageRecords(entries, undefined).records[0]).toMatchObject({ provider: "anthropic", model: "opus-4.5" });
	});

	test("falls back to the active model, and to none when the session has none", () => {
		const entry = { type: "compaction", usage: u(1, 1, 0, 0, 0), timestamp: "2026-01-05T05:00:00.000Z" };

		expect(usageRecords([entry], ACTIVE).records[0]).toMatchObject({ provider: "anthropic", model: "opus-4.5" });
		expect(usageRecords([entry], undefined).records[0]).toMatchObject({ provider: null, model: null });
	});

	test("prefers the entry timestamp and falls back to the message one", () => {
		const iso = usageRecords(
			[{ type: "usage", usage: u(1, 1, 0, 0, 0), timestamp: "2026-01-05T03:00:00.000Z" }],
			undefined,
		);
		const ms = usageRecords([toolResult(u(1, 1, 0, 0, 0), 1_700_000_000_000)], undefined);
		const undated = usageRecords([{ type: "compaction", usage: u(1, 1, 0, 0, 0), timestamp: "not-a-date" }], undefined);

		expect(iso.records[0].at).toBe(Date.parse("2026-01-05T03:00:00.000Z"));
		expect(ms.records[0].at).toBe(1_700_000_000_000);
		expect(undated.records[0].at).toBeNull();
	});

	test("is empty for no entries", () => {
		expect(usageRecords([], ACTIVE)).toEqual({ records: [], cacheHitRate: null });
	});
});
