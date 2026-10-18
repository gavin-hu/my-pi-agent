/**
 * The accounting event a finished child run publishes.
 *
 * `subagent` runs each child in its own `pi` process, so the dispatcher's own
 * usage totals never include what the child spent. The event carries the child's
 * pricing inputs (provider, model, token counts, Pi's recorded dollar cost, finish
 * time) rather than a total, so the consumer can price them with the same rate
 * table and currency it uses for the session — and re-price them after a currency
 * change.
 *
 * A run with no assistant message spent nothing observable (an unknown agent, a
 * spawn failure), so it publishes nothing at all.
 */

import type { SubagentFinishedEvent } from "../../lib/events.ts";
import type { SingleResult } from "./types.ts";

/** The event for one finished run, or `null` when it produced no usage. */
export function finishedEvent(result: SingleResult): SubagentFinishedEvent | null {
	const { usage } = result;
	if (usage.turns === 0) return null;
	return {
		agent: result.agent,
		provider: result.provider ?? null,
		model: result.model ?? null,
		input: usage.input,
		output: usage.output,
		cacheRead: usage.cacheRead,
		cacheWrite: usage.cacheWrite,
		recordedCost: usage.cost,
		at: result.finishedAt ?? null,
		exitCode: result.exitCode,
	};
}
