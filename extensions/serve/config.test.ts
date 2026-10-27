/**
 * The serve config contract: the session's one port, its clamp, and the two
 * documents it resolves over.
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
import { DEFAULT_SERVE_CONFIG, loadServeConfig, normalizeServeConfig } from "./config.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** A project document stating one `serve` section, under a temp working directory. */
function projectWith(section: unknown): string {
	const cwd = temps.track(tempDir("pi-repo-"));
	mkdirSync(join(cwd, ".pi"), { recursive: true });
	// `undefined` writes `{}`: a document that states no `serve` section at all.
	writeFileSync(join(cwd, ".pi", "bytefly.json"), JSON.stringify({ serve: section }));
	return cwd;
}

/** A global document stating one `serve` section, in the agent directory `useAgentDir` made. */
function globalWith(agentDir: string, section: unknown): void {
	writeFileSync(join(agentDir, "bytefly.json"), JSON.stringify({ serve: section }));
}

describe("normalizeServeConfig", () => {
	test("keeps the default when the section is absent", () => {
		expect(normalizeServeConfig(undefined)).toEqual(DEFAULT_SERVE_CONFIG);
		// `0` is the setting's whole default: a free port, remembered for the session.
		expect(DEFAULT_SERVE_CONFIG.port).toBe(0);
	});

	test("keeps a port, whether it is a number or a string that states one", () => {
		expect(normalizeServeConfig({ port: 4780 }).port).toBe(4780);
		expect(normalizeServeConfig({ port: "4790" }).port).toBe(4790);
	});

	test("clamps a port into the TCP range", () => {
		expect(normalizeServeConfig({ port: -1 }).port).toBe(0);
		expect(normalizeServeConfig({ port: 70_000 }).port).toBe(65_535);
	});

	test("reads anything that is not a number as no pin at all", () => {
		for (const raw of ["abc", "", null, true, [], {}]) {
			expect([raw, normalizeServeConfig({ port: raw }).port]).toEqual([raw, 0]);
		}
	});
});

describe("loadServeConfig", () => {
	test("pins the port from the global document", () => {
		const { dir, restore } = useAgentDir();
		try {
			globalWith(dir, { port: 4781 });
			expect(loadServeConfig(temps.track(tempDir("pi-repo-"))).port).toBe(4781);
		} finally {
			restore();
		}
	});

	test("reads the project document over the global one", () => {
		const { dir, restore } = useAgentDir();
		try {
			globalWith(dir, { port: 4781 });
			expect(loadServeConfig(projectWith({ port: 4782 })).port).toBe(4782);
		} finally {
			restore();
		}
	});

	test("keeps the global pin when the project states none", () => {
		const { dir, restore } = useAgentDir();
		try {
			globalWith(dir, { port: 4781 });
			expect(loadServeConfig(projectWith(undefined)).port).toBe(4781);
		} finally {
			restore();
		}
	});

	test("lets the project document turn a global pin off", () => {
		const { dir, restore } = useAgentDir();
		try {
			globalWith(dir, { port: 4781 });
			expect(loadServeConfig(projectWith({ port: 0 })).port).toBe(0);
		} finally {
			restore();
		}
	});

	test("ignores a malformed document instead of failing the page", () => {
		const { dir, restore } = useAgentDir();
		try {
			writeFileSync(join(dir, "bytefly.json"), "{ not json");
			expect(loadServeConfig(temps.track(tempDir("pi-repo-"))).port).toBe(0);
		} finally {
			restore();
		}
	});
});
