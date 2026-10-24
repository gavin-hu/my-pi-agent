/**
 * A split plan store, for the suites that join a unit.
 *
 * Approval writes a `## Team` table into the plan and turns `plan.split` on; these
 * suites start from that state instead of driving an approval, so the fixture is
 * one plan file plus one settings file. The caller owns its temp directories.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir, useEnv } from "../env.ts";
import type { TempTracker } from "../git.ts";

/** The plan a split suite joins: a lead unit, one owner, one dependency. */
export const SPLIT_PLAN = [
	"# Split plan",
	"",
	"## Steps",
	"",
	"- [ ] contract",
	"",
	"## Team",
	"",
	"Lead: contract",
	"",
	"| unit | paths | test | depends on |",
	"| --- | --- | --- | --- |",
	"| contract | src/contract | bun test src/contract | — |",
	"| core | src/core | bun test src/core | contract |",
].join("\n");

/** The lead's unit name, which a refusal has to repeat. */
export const SPLIT_LEAD = "contract";

/** The plan file's stem, which a `join` names as `team`. */
export const SPLIT_TEAM = "2026-10-24-0820-split";

export interface SplitStoreOptions {
	/** Whether `plan.split` is on; off is how a suite proves the refusal names it. */
	on?: boolean;
	/** A different plan body, for the refusals that read the table. */
	content?: string;
}

export interface SplitStore {
	/** The plan store directory, for a runtime's `plans` option. */
	plans: string;
	/** The plan file's stem, which a `join` names as `team`. */
	team: string;
	/** Put `PI_CODING_AGENT_DIR` back. */
	restore(): void;
}

/** Write one split plan and one settings file, and point the agent dir at them. */
export function splitStore(temps: TempTracker, team = SPLIT_TEAM, options: SplitStoreOptions = {}): SplitStore {
	const plans = temps.track(tempDir("pi-split-plans-"));
	writeFileSync(join(plans, `${team}.md`), options.content ?? SPLIT_PLAN);
	const agent = temps.track(tempDir("pi-split-agent-"));
	writeFileSync(join(agent, "bytefly.json"), JSON.stringify({ plan: { split: options.on ?? true } }));
	const scoped = useEnv({ PI_CODING_AGENT_DIR: agent });
	return { plans, team, restore: scoped.restore };
}
