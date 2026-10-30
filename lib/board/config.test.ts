/**
 * The `board` section: the two numbers a lane is held to, and the name a signature carries.
 *
 * One reader for one section, so the cases here are about each key falling back on its own and
 * about the project's file winning over the global one — the two ways a merged setting surprises
 * the person who set it.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../../test/helpers/env.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { DEFAULT_BOARD_CONFIG, normalizeBoardConfig, readBoardConfig } from "./config.ts";
import { DEFAULT_LEAD } from "./lead.ts";
import { MAX_WIP } from "./limits.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** A repository directory whose `.pi/bytefly.json` holds `document`. */
function projectWith(document: unknown): string {
	const cwd = temps.track(tempDir("pi-board-config-"));
	mkdirSync(join(cwd, ".pi"), { recursive: true });
	writeFileSync(join(cwd, ".pi", "bytefly.json"), typeof document === "string" ? document : JSON.stringify(document));
	return cwd;
}

/** An agent directory whose `bytefly.json` holds `document`. */
function agentWith(document: unknown): string {
	const agentDir = temps.track(tempDir("pi-board-agent-"));
	writeFileSync(join(agentDir, "bytefly.json"), typeof document === "string" ? document : JSON.stringify(document));
	return agentDir;
}

describe("normalizeBoardConfig", () => {
	test("an absent section is the default board", () => {
		expect(normalizeBoardConfig(undefined)).toEqual(DEFAULT_BOARD_CONFIG);
		expect(DEFAULT_BOARD_CONFIG).toEqual({ wip: { plan: 3, execute: 5 }, lead: DEFAULT_LEAD });
	});

	test("each key falls back on its own", () => {
		expect(normalizeBoardConfig({ lead: "billing-lead" })).toEqual({
			wip: { plan: 3, execute: 5 },
			lead: "billing-lead",
		});
		expect(normalizeBoardConfig({ wip: { plan: 2 } })).toEqual({ wip: { plan: 2, execute: 5 }, lead: DEFAULT_LEAD });
	});

	test("a limit is clamped, and a lead is a label", () => {
		expect(normalizeBoardConfig({ wip: { plan: 0, execute: 99 } })).toEqual({
			wip: { plan: 1, execute: MAX_WIP },
			lead: DEFAULT_LEAD,
		});
		// A name is flattened and capped by the same rule every label obeys.
		expect(normalizeBoardConfig({ lead: "  billing   lead  " }).lead).toBe("billing lead");
		expect(normalizeBoardConfig({ lead: "x".repeat(60) }).lead).toHaveLength(40);
	});

	test("a blank lead keeps the running one", () => {
		const base = { wip: { plan: 2, execute: 2 }, lead: "team-lead" };
		expect(normalizeBoardConfig({ lead: "   " }, base).lead).toBe("team-lead");
		expect(normalizeBoardConfig({ lead: 7 }, base).lead).toBe("team-lead");
	});
});

describe("readBoardConfig", () => {
	test("reads board.wip and board.lead from the project's bytefly.json", () => {
		const cwd = projectWith({ board: { wip: { plan: 2, execute: 4 }, lead: "team-lead" } });
		expect(readBoardConfig(cwd, { agentDir: temps.track(tempDir("pi-board-agent-")) })).toEqual({
			wip: { plan: 2, execute: 4 },
			lead: "team-lead",
		});
	});

	test("the project's section is normalized over the global one", () => {
		const agentDir = agentWith({ board: { wip: { plan: 1, execute: 2 }, lead: "team-lead" } });
		const cwd = projectWith({ board: { lead: "billing-lead" } });
		// The project named the lead and said nothing about the numbers, so the global ones hold.
		expect(readBoardConfig(cwd, { agentDir })).toEqual({
			wip: { plan: 1, execute: 2 },
			lead: "billing-lead",
		});
	});

	test("a malformed file is the default board, not a broken one", () => {
		const cwd = projectWith("{ not json");
		expect(readBoardConfig(cwd, { agentDir: temps.track(tempDir("pi-board-agent-")) })).toEqual(DEFAULT_BOARD_CONFIG);
	});
});
