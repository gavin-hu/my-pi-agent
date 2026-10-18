import { describe, expect, test } from "bun:test";
import type { SubagentFinishedEvent } from "../../../lib/events.ts";
import { createDelegationLedger, MAX_DELEGATION_RECORDS } from "./delegation.ts";

/** A finished child run, as the subagent extension publishes it. */
function event(over: Partial<SubagentFinishedEvent> = {}): SubagentFinishedEvent {
	return {
		agent: "explorer",
		provider: "anthropic",
		model: "opus-4.5",
		input: 1000,
		output: 200,
		cacheRead: 50,
		cacheWrite: 0,
		recordedCost: 0.02,
		at: 1_700_000_000_000,
		exitCode: 0,
		...over,
	};
}

describe("createDelegationLedger", () => {
	test("keeps the pricing inputs of each finished run", () => {
		const ledger = createDelegationLedger();
		ledger.note(event());
		expect(ledger.runs()).toBe(1);
		expect(ledger.records()).toEqual([
			{
				provider: "anthropic",
				model: "opus-4.5",
				input: 1000,
				output: 200,
				cacheRead: 50,
				cacheWrite: 0,
				recordedCost: 0.02,
				at: 1_700_000_000_000,
				isAssistant: true,
			},
		]);
	});

	test("advances the version on every noted run, so a reader can re-price", () => {
		const ledger = createDelegationLedger();
		expect(ledger.version()).toBe(0);
		ledger.note(event());
		ledger.note(event());
		expect(ledger.version()).toBe(2);
	});

	test("ignores a payload it cannot price", () => {
		const ledger = createDelegationLedger();
		for (const bad of [null, undefined, "event", 42, {}, { agent: "  " }, { agent: "explorer", input: "many" }]) {
			ledger.note(bad);
		}
		expect(ledger.runs()).toBe(0);
		expect(ledger.records()).toEqual([]);
		expect(ledger.version()).toBe(0);
	});

	test("keeps counting past the retention window and keeps the newest runs", () => {
		const ledger = createDelegationLedger();
		for (let index = 0; index < MAX_DELEGATION_RECORDS + 5; index++) ledger.note(event({ input: index }));

		expect(ledger.runs()).toBe(MAX_DELEGATION_RECORDS + 5);
		const records = ledger.records();
		expect(records).toHaveLength(MAX_DELEGATION_RECORDS);
		expect(records[0]?.input).toBe(5);
		expect(records.at(-1)?.input).toBe(MAX_DELEGATION_RECORDS + 4);
	});

	test("a null provider or model is kept as null, not invented", () => {
		const ledger = createDelegationLedger();
		ledger.note(event({ provider: null, model: null, at: null }));
		expect(ledger.records()[0]).toMatchObject({ provider: null, model: null, at: null });
	});

	test("reset forgets everything", () => {
		const ledger = createDelegationLedger();
		ledger.note(event());
		ledger.reset();
		expect(ledger.runs()).toBe(0);
		expect(ledger.records()).toEqual([]);
		expect(ledger.version()).toBe(0);
	});
});
