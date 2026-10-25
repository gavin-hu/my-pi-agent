/**
 * The board config contract: the one setting, its clamp, and the two documents it
 * resolves over.
 *
 * A pin is a number a typo can spoil, so every value that does not state one reads
 * as the default `0` — "pick one for the session" — rather than as a port nobody
 * chose.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir, useAgentDir } from "../../test/helpers/env.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { DEFAULT_BOARD_CONFIG, loadBoardConfig, normalizeBoardConfig } from "./config.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** A project document stating one `board` section, under a temp working directory. */
function projectWith(section: unknown): string {
	const cwd = temps.track(tempDir("pi-repo-"));
	mkdirSync(join(cwd, ".pi"), { recursive: true });
	// `undefined` writes `{}`: a document that states no `board` section at all.
	writeFileSync(join(cwd, ".pi", "bytefly.json"), JSON.stringify({ board: section }));
	return cwd;
}

/** A global document stating one `board` section, in the agent directory `useAgentDir` made. */
function globalWith(agentDir: string, section: unknown): void {
	writeFileSync(join(agentDir, "bytefly.json"), JSON.stringify({ board: section }));
}

describe("normalizeBoardConfig", () => {
	test("keeps the default when the section is absent", () => {
		expect(normalizeBoardConfig(undefined)).toEqual(DEFAULT_BOARD_CONFIG);
		// `0` is the setting's whole default: a free port, remembered for the session.
		expect(DEFAULT_BOARD_CONFIG.port).toBe(0);
	});

	test("keeps a port, whether it is a number or a string that states one", () => {
		expect(normalizeBoardConfig({ port: 4780 }).port).toBe(4780);
		expect(normalizeBoardConfig({ port: "4790" }).port).toBe(4790);
	});

	test("clamps a port into the TCP range", () => {
		expect(normalizeBoardConfig({ port: -1 }).port).toBe(0);
		expect(normalizeBoardConfig({ port: 70_000 }).port).toBe(65_535);
	});

	test("reads anything that is not a number as no pin at all", () => {
		for (const raw of ["abc", "", null, true, [], {}]) {
			expect([raw, normalizeBoardConfig({ port: raw }).port]).toEqual([raw, 0]);
		}
	});
});

describe("loadBoardConfig", () => {
	test("pins the port from the global document", () => {
		const { dir, restore } = useAgentDir();
		try {
			globalWith(dir, { port: 4781 });
			expect(loadBoardConfig(temps.track(tempDir("pi-repo-"))).port).toBe(4781);
		} finally {
			restore();
		}
	});

	test("reads the project document over the global one", () => {
		const { dir, restore } = useAgentDir();
		try {
			globalWith(dir, { port: 4781 });
			expect(loadBoardConfig(projectWith({ port: 4782 })).port).toBe(4782);
		} finally {
			restore();
		}
	});

	test("keeps the global pin when the project states none", () => {
		const { dir, restore } = useAgentDir();
		try {
			globalWith(dir, { port: 4781 });
			expect(loadBoardConfig(projectWith(undefined)).port).toBe(4781);
		} finally {
			restore();
		}
	});

	test("lets the project document turn a global pin off", () => {
		const { dir, restore } = useAgentDir();
		try {
			globalWith(dir, { port: 4781 });
			expect(loadBoardConfig(projectWith({ port: 0 })).port).toBe(0);
		} finally {
			restore();
		}
	});

	test("ignores a malformed document instead of failing the page", () => {
		const { dir, restore } = useAgentDir();
		try {
			writeFileSync(join(dir, "bytefly.json"), "{ not json");
			expect(loadBoardConfig(temps.track(tempDir("pi-repo-"))).port).toBe(0);
		} finally {
			restore();
		}
	});
});
