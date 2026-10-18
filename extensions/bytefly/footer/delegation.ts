/**
 * The child-run ledger: what this session's delegated runs spent.
 *
 * `subagent` publishes one event per finished child process on
 * `SUBAGENT_FINISHED_CHANNEL`. The footer shows that spend as its own number, so
 * the session's total keeps meaning what it always did.
 *
 * The ledger keeps *pricing inputs*, not a total: `currency.code` can change
 * between sessions (a settings edit re-installs the footer and rebuilds the
 * pricer), and a stored figure would then be in the wrong unit. It also keeps the
 * peak tariff honest, because each record carries the time the run finished.
 *
 * Bounded on purpose: the last {@link MAX_DELEGATION_RECORDS} runs are retained —
 * each is a full child `pi` process, so hundreds in one session is already
 * extraordinary — while the run count keeps counting past the window. Every field
 * of an event is re-validated, because the bus is not a trusted channel.
 */

import type { SubagentFinishedEvent } from "../../../lib/events.ts";
import type { UsageRecord } from "./types.ts";

/** Runs whose pricing inputs are retained. */
export const MAX_DELEGATION_RECORDS = 500;

export interface DelegationLedger {
	/** Note one finished child run; a malformed payload is ignored. */
	note(event: unknown): void;
	/** How many runs finished this session, including ones past the window. */
	runs(): number;
	/** Pricing inputs for the retained runs, oldest first. */
	records(): UsageRecord[];
	/** Changes on every noted run, so a reader can tell its totals are stale. */
	version(): number;
	/** Forget everything; called at session start. */
	reset(): void;
}

/** A finite, non-negative number, or `null` when the field is not one. */
function count(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/** A non-empty string, or `null`. */
function text(value: unknown): string | null {
	return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** The event as a usage record, or `null` when it is not one we can price. */
function toRecord(event: SubagentFinishedEvent): UsageRecord | null {
	if (text(event.agent) === null) return null;
	const input = count(event.input);
	const output = count(event.output);
	const cacheRead = count(event.cacheRead);
	const cacheWrite = count(event.cacheWrite);
	const recordedCost = count(event.recordedCost);
	// A type-mismatched field is a malformed event, not a zero: refuse the whole
	// record rather than counting a run whose spend is unknown.
	if (input === null || output === null || cacheRead === null || cacheWrite === null || recordedCost === null) {
		return null;
	}
	return {
		provider: text(event.provider),
		model: text(event.model),
		input,
		output,
		cacheRead,
		cacheWrite,
		recordedCost,
		at: typeof event.at === "number" && Number.isFinite(event.at) ? event.at : null,
		isAssistant: true,
	};
}

export function createDelegationLedger(): DelegationLedger {
	let retained: UsageRecord[] = [];
	let total = 0;
	let version = 0;

	return {
		note(event) {
			if (!event || typeof event !== "object") return;
			const record = toRecord(event as SubagentFinishedEvent);
			if (!record) return;
			total += 1;
			version += 1;
			retained.push(record);
			// Keep the window at the cap without re-allocating the whole array per run
			// until it is actually exceeded.
			if (retained.length > MAX_DELEGATION_RECORDS) retained = retained.slice(-MAX_DELEGATION_RECORDS);
		},
		runs: () => total,
		records: () => [...retained],
		version: () => version,
		reset() {
			retained = [];
			total = 0;
			version = 0;
		},
	};
}
