/**
 * The `board` section: the two numbers a lane is held to, and the name a signature carries.
 *
 * One reader for one section, so the cases here are about each key falling back on its own and
 * about the project's file winning over the global one — the two ways a merged setting surprises
 * the person who set it.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../../test/helpers/env.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { addTeammate, DEFAULT_BOARD_CONFIG, DEFAULT_LEAD, normalizeBoardConfig, readBoardConfig } from "./config.ts";
import { DEFAULT_TEAMMATES } from "../session-label.ts";

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
		expect(DEFAULT_BOARD_CONFIG).toEqual({
			wip: { plan: 3, execute: 5 },
			lead: DEFAULT_LEAD,
			teammates: DEFAULT_TEAMMATES,
		});
	});

	test("each key falls back on its own", () => {
		expect(normalizeBoardConfig({ lead: "billing-lead" })).toEqual({
			wip: { plan: 3, execute: 5 },
			lead: "billing-lead",
			teammates: DEFAULT_TEAMMATES,
		});
		expect(normalizeBoardConfig({ wip: { plan: 2 } })).toEqual({
			wip: { plan: 2, execute: 5 },
			lead: DEFAULT_LEAD,
			teammates: DEFAULT_TEAMMATES,
		});
	});

	test("a limit is clamped, and a lead is a label", () => {
		expect(normalizeBoardConfig({ wip: { plan: 0, execute: 99 } })).toEqual({
			wip: { plan: 1, execute: MAX_WIP },
			lead: DEFAULT_LEAD,
			teammates: DEFAULT_TEAMMATES,
		});
		// A name is flattened and capped by the same rule every label obeys.
		expect(normalizeBoardConfig({ lead: "  billing   lead  " }).lead).toBe("billing lead");
		expect(normalizeBoardConfig({ lead: "x".repeat(60) }).lead).toHaveLength(40);
	});

	test("a blank lead keeps the running one", () => {
		const base = { wip: { plan: 2, execute: 2 }, lead: "team-lead", teammates: DEFAULT_TEAMMATES };
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
			teammates: DEFAULT_TEAMMATES,
		});
	});

	test("the project's section is normalized over the global one", () => {
		const agentDir = agentWith({ board: { wip: { plan: 1, execute: 2 }, lead: "team-lead" } });
		const cwd = projectWith({ board: { lead: "billing-lead" } });
		// The project named the lead and said nothing about the numbers, so the global ones hold.
		expect(readBoardConfig(cwd, { agentDir })).toEqual({
			wip: { plan: 1, execute: 2 },
			lead: "billing-lead",
			teammates: DEFAULT_TEAMMATES,
		});
	});

	test("a malformed file is the default board, not a broken one", () => {
		const cwd = projectWith("{ not json");
		expect(readBoardConfig(cwd, { agentDir: temps.track(tempDir("pi-board-agent-")) })).toEqual(DEFAULT_BOARD_CONFIG);
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
		const cwd = projectWith({ board: { lead: "jack", wip: { plan: 2, execute: 2 } }, price: { budget: 5 } });
		const agentDir = temps.track(tempDir("pi-board-agent-"));
		const added = addTeammate(cwd, "lily", { agentDir });
		expect(added).toEqual({ ok: true, team: [...DEFAULT_TEAMMATES, "lily"], changed: true });
		expect(projectDocument(cwd)).toEqual({
			board: { lead: "jack", wip: { plan: 2, execute: 2 }, teammates: [...DEFAULT_TEAMMATES, "lily"] },
			price: { budget: 5 },
		});
	});

	test("a name the team already holds is no edit at all", () => {
		const cwd = projectWith({ board: { teammates: ["gavin", "jack"] } });
		const agentDir = temps.track(tempDir("pi-board-agent-"));
		expect(addTeammate(cwd, "Jack", { agentDir })).toEqual({ ok: true, team: ["gavin", "jack"], changed: false });
		expect(projectDocument(cwd)).toEqual({ board: { teammates: ["gavin", "jack"] } });
	});

	test("puts the new name after the team the global file states", () => {
		const cwd = projectWith({});
		const agentDir = agentWith({ board: { teammates: ["gavin", "jack"] } });
		expect(addTeammate(cwd, "lily", { agentDir })).toEqual({
			ok: true,
			team: ["gavin", "jack", "lily"],
			changed: true,
		});
		// The project layer replaces the global one key by key, so the write states the team it
		// was given rather than only the name it added.
		expect(projectDocument(cwd)).toEqual({ board: { teammates: ["gavin", "jack", "lily"] } });
	});

	test("a second name keeps the first, because the team is read where it is written", () => {
		const cwd = projectWith({});
		const agentDir = temps.track(tempDir("pi-board-agent-"));
		addTeammate(cwd, "lily", { agentDir });
		addTeammate(cwd, "bob", { agentDir });
		expect(projectDocument(cwd)).toEqual({ board: { teammates: [...DEFAULT_TEAMMATES, "lily", "bob"] } });
	});

	test("refuses a name outside the vocabulary, because the next read would drop it", () => {
		const cwd = projectWith({});
		const added = addTeammate(cwd, "core-claims", { agentDir: temps.track(tempDir("pi-board-agent-")) });
		expect(added.ok).toBe(false);
		expect(added).toMatchObject({ why: "not-a-teammate" });
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
