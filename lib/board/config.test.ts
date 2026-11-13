/**
 * The `team` and `board` sections: who signs, who is on the team, and the two numbers a lane is
 * held to.
 *
 * One reader per section, so the cases here are about each key falling back on its own and about
 * the project's file winning over the global one — the two ways a merged setting surprises the
 * person who set it — plus the two answers a project can state that are empty: no lead, and no
 * team.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../../test/helpers/env.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import {
	addTeammate,
	boardConfig,
	DEFAULT_BOARD_CONFIG,
	DEFAULT_TEAM_CONFIG,
	normalizeTeamConfig,
	normalizeWipConfig,
	readBoardConfig,
	readTeamConfig,
} from "./config.ts";
import { DEFAULT_WIP, MAX_WIP } from "./limits.ts";

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

describe("the default board", () => {
	test("names no lead and no team, because a project states its own", () => {
		expect(DEFAULT_TEAM_CONFIG).toEqual({ lead: "", teammates: [] });
		expect(DEFAULT_BOARD_CONFIG).toEqual({ lead: "", teammates: [], wip: { plan: 3, execute: 5 } });
	});

	test("a caller overrides one key and keeps the rest", () => {
		expect(boardConfig({ lead: "billing-lead" })).toEqual({
			lead: "billing-lead",
			teammates: [],
			wip: { plan: 3, execute: 5 },
		});
	});
});

describe("normalizeTeamConfig", () => {
	test("an absent section is no lead and no team", () => {
		expect(normalizeTeamConfig(undefined)).toEqual(DEFAULT_TEAM_CONFIG);
	});

	test("each key falls back on its own", () => {
		expect(normalizeTeamConfig({ lead: "billing-lead" })).toEqual({ lead: "billing-lead", teammates: [] });
		expect(normalizeTeamConfig({ teammates: ["tom", "api-core"] })).toEqual({
			lead: "",
			teammates: ["tom", "api-core"],
		});
	});

	test("a lead is a label", () => {
		// A name is flattened and capped by the same rule every label obeys.
		expect(normalizeTeamConfig({ lead: "  billing   lead  " }).lead).toBe("billing lead");
		expect(normalizeTeamConfig({ lead: "x".repeat(60) }).lead).toHaveLength(40);
	});

	test("a blank lead keeps the running one, and the running one may be none", () => {
		expect(normalizeTeamConfig({ lead: "   " }, { lead: "team-lead", teammates: [] }).lead).toBe("team-lead");
		expect(normalizeTeamConfig({ lead: 7 }, { lead: "team-lead", teammates: [] }).lead).toBe("team-lead");
		expect(normalizeTeamConfig({ lead: "" }).lead).toBe("");
	});

	test("an empty list is a team of nobody, and stays empty", () => {
		expect(normalizeTeamConfig({ teammates: [] }, { lead: "", teammates: ["tom"] }).teammates).toEqual([]);
	});

	test("a stated team keeps any label, in order, without a duplicate", () => {
		expect(normalizeTeamConfig({ teammates: ["Billing-Core", "tom", "billing-core"] }).teammates).toEqual([
			"billing-core",
			"tom",
		]);
	});
});

describe("normalizeWipConfig", () => {
	test("each limit falls back on its own and is clamped", () => {
		expect(normalizeWipConfig(undefined)).toEqual(DEFAULT_WIP);
		expect(normalizeWipConfig({ wip: { plan: 2 } })).toEqual({ plan: 2, execute: 5 });
		expect(normalizeWipConfig({ wip: { plan: 0, execute: 99 } })).toEqual({ plan: 1, execute: MAX_WIP });
	});
});

describe("readBoardConfig", () => {
	test("reads board.wip and the team from the project's bytefly.json", () => {
		const cwd = projectWith({
			board: { wip: { plan: 2, execute: 4 } },
			team: { lead: "team-lead", teammates: ["team-lead", "tom"] },
		});
		expect(readBoardConfig(cwd, { agentDir: temps.track(tempDir("pi-board-agent-")) })).toEqual({
			wip: { plan: 2, execute: 4 },
			lead: "team-lead",
			teammates: ["team-lead", "tom"],
		});
	});

	test("each section is normalized over the global one key by key", () => {
		const agentDir = agentWith({
			board: { wip: { plan: 1, execute: 2 } },
			team: { lead: "team-lead", teammates: ["team-lead"] },
		});
		const cwd = projectWith({ team: { lead: "billing-lead" } });
		// The project named the lead and said nothing about the numbers or the list, so the global
		// answers hold for both.
		expect(readBoardConfig(cwd, { agentDir })).toEqual({
			wip: { plan: 1, execute: 2 },
			lead: "billing-lead",
			teammates: ["team-lead"],
		});
	});

	test("a project that empties its team says so, and the global list does not come back", () => {
		const agentDir = agentWith({ team: { teammates: ["team-lead", "tom"] } });
		const cwd = projectWith({ team: { teammates: [] } });
		expect(readBoardConfig(cwd, { agentDir }).teammates).toEqual([]);
	});

	test("a malformed file is the default board, not a broken one", () => {
		const cwd = projectWith("{ not json");
		expect(readBoardConfig(cwd, { agentDir: temps.track(tempDir("pi-board-agent-")) })).toEqual(DEFAULT_BOARD_CONFIG);
	});
});

describe("readTeamConfig", () => {
	test("reads the team alone, which is what the footer needs", () => {
		const cwd = projectWith({ board: { wip: { plan: 9 } }, team: { teammates: ["tom"] } });
		expect(readTeamConfig(cwd, { agentDir: temps.track(tempDir("pi-board-agent-")) })).toEqual({
			lead: "",
			teammates: ["tom"],
		});
	});
});

/** The project document a directory holds, parsed, or `undefined` when it holds none. */
function projectDocument(cwd: string): unknown {
	try {
		return JSON.parse(readFileSync(join(cwd, ".pi", "bytefly.json"), "utf-8"));
	} catch {
		return undefined;
	}
}

describe("addTeammate", () => {
	test("writes the whole team to the project's file, keeping every sibling key", () => {
		const cwd = projectWith({ team: { lead: "jack", teammates: ["jack"] }, price: { budget: 5 } });
		const agentDir = temps.track(tempDir("pi-board-agent-"));
		expect(addTeammate(cwd, "lily", { agentDir })).toEqual({ ok: true, team: ["jack", "lily"], changed: true });
		expect(projectDocument(cwd)).toEqual({
			team: { lead: "jack", teammates: ["jack", "lily"] },
			price: { budget: 5 },
		});
	});

	test("takes any name, because the project's list is the whole vocabulary", () => {
		const cwd = projectWith({});
		const added = addTeammate(cwd, "  Billing  Core ", { agentDir: temps.track(tempDir("pi-board-agent-")) });
		expect(added).toEqual({ ok: true, team: ["billing core"], changed: true });
		expect(projectDocument(cwd)).toEqual({ team: { teammates: ["billing core"] } });
	});

	test("a name the team already holds is no edit at all", () => {
		const cwd = projectWith({ team: { teammates: ["gavin", "jack"] } });
		expect(addTeammate(cwd, "Jack", { agentDir: temps.track(tempDir("pi-board-agent-")) })).toEqual({
			ok: true,
			team: ["gavin", "jack"],
			changed: false,
		});
		expect(projectDocument(cwd)).toEqual({ team: { teammates: ["gavin", "jack"] } });
	});

	test("puts the new name after the team the global file states", () => {
		const cwd = projectWith({});
		const agentDir = agentWith({ team: { teammates: ["gavin", "jack"] } });
		expect(addTeammate(cwd, "lily", { agentDir })).toEqual({
			ok: true,
			team: ["gavin", "jack", "lily"],
			changed: true,
		});
		// The project layer replaces the global one key by key, so the write states the team it
		// was given rather than only the name it added.
		expect(projectDocument(cwd)).toEqual({ team: { teammates: ["gavin", "jack", "lily"] } });
	});

	test("a second name keeps the first, because the team is read where it is written", () => {
		const cwd = projectWith({});
		const agentDir = temps.track(tempDir("pi-board-agent-"));
		addTeammate(cwd, "lily", { agentDir });
		addTeammate(cwd, "bob", { agentDir });
		expect(projectDocument(cwd)).toEqual({ team: { teammates: ["lily", "bob"] } });
	});

	test("a blank label puts nobody on the team", () => {
		const cwd = projectWith({});
		expect(addTeammate(cwd, "   ", { agentDir: temps.track(tempDir("pi-board-agent-")) })).toEqual({
			ok: true,
			team: [],
			changed: false,
		});
		expect(projectDocument(cwd)).toEqual({});
	});

	test("a document it cannot parse is a reason, not a rewrite", () => {
		const cwd = projectWith("{ not json");
		const added = addTeammate(cwd, "lily", { agentDir: temps.track(tempDir("pi-board-agent-")) });
		expect(added).toMatchObject({ ok: false, why: "write-failed" });
		if (added.ok) throw new Error("the write should have been refused");
		expect(added.reason).toContain(join(".pi", "bytefly.json"));
		expect(readFileSync(join(cwd, ".pi", "bytefly.json"), "utf-8")).toBe("{ not json");
	});
});
