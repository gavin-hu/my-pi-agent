/**
 * The `job` section of `bytefly.json`: its defaults, its clamps, and the order
 * the two documents layer in.
 *
 * Split out of `extension.test.ts`, which sat at 398 of the 400 lines
 * `test/suite-sizes.test.ts` allows, so the next case that needed room is a
 * split rather than a raised bar. Nothing here builds a harness, starts a
 * process, or touches a registry: every case reads `config.ts` alone.
 *
 * The per-key clamp cases are the second reason for the file. Every key in this
 * section is `jsonOnly`, so `test/settings-coverage.test.ts`'s bounds probe
 * walks no settings row here and holds none of these bounds; before the split
 * one aggregate case was the whole gate, which named a value rather than the key
 * when a bound moved.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG, loadConfig, normalizeConfig, type JobsConfig } from "./config.ts";
import { SHARED_CONFIG_FILE } from "../../lib/config.ts";
import { tempDir, withAgentDir } from "../../test/helpers/env.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";

const temps = makeTempTracker();
afterEach(() => temps.flush());

describe("job config", () => {
	test("normalizeConfig returns the base for an absent section", async () => {
		expect(normalizeConfig(undefined, DEFAULT_CONFIG)).toBe(DEFAULT_CONFIG);
	});

	test("takes booleans and ignores wrongly typed ones", async () => {
		const config = normalizeConfig(
			{ enabled: false, showStatus: "no", wakeOnFinish: true, detachedByDefault: true },
			DEFAULT_CONFIG,
		);
		expect(config.enabled).toBe(false);
		expect(config.showStatus).toBe(true);
		expect(config.wakeOnFinish).toBe(true);
		expect(config.detachedByDefault).toBe(true);
	});

	test("keeps the default for a non-numeric value", async () => {
		const config = normalizeConfig({ maxJobs: null, repaintMs: "fast" }, DEFAULT_CONFIG);
		expect(config.maxJobs).toBe(DEFAULT_CONFIG.maxJobs);
		expect(config.repaintMs).toBe(DEFAULT_CONFIG.repaintMs);
	});

	test("trims registryDir and treats a blank one as unset", async () => {
		expect(normalizeConfig({ registryDir: " /custom/dir " }, DEFAULT_CONFIG).registryDir).toBe("/custom/dir");
		expect(normalizeConfig({ registryDir: "   " }, DEFAULT_CONFIG).registryDir).toBeUndefined();
	});

	test("loadConfig returns the defaults when no section is configured", async () => {
		await withAgentDir(() => {
			const cwd = temps.track(tempDir("pi-jobs-config-"));
			expect(loadConfig(cwd)).toEqual(DEFAULT_CONFIG);
		});
	});

	test("loadConfig layers the global section, then the project section", async () => {
		await withAgentDir(async (agentDir) => {
			const cwd = temps.track(tempDir("pi-jobs-config-"));
			writeFileSync(
				join(agentDir, SHARED_CONFIG_FILE),
				JSON.stringify({ job: { maxJobs: 5, wakeOnFinish: true } }),
				"utf-8",
			);
			mkdirSync(join(cwd, CONFIG_DIR_NAME), { recursive: true });
			writeFileSync(
				join(cwd, CONFIG_DIR_NAME, SHARED_CONFIG_FILE),
				JSON.stringify({ job: { maxJobs: 7, showStatus: false } }),
				"utf-8",
			);
			const config = loadConfig(cwd);
			expect(config.maxJobs).toBe(7);
			expect(config.wakeOnFinish).toBe(true);
			expect(config.showStatus).toBe(false);
		});
	});
});

/**
 * The bounds `config.ts` clamps each numeric key with, in the order the loader
 * states them. A key added to the section without a row here has an unheld
 * bound, which is the state this table exists to end.
 */
const CLAMPS: ReadonlyArray<readonly [key: keyof JobsConfig, min: number, max: number]> = [
	["maxJobs", 1, 500],
	["maxLogLines", 1, 5_000],
	["maxLogBytes", 0, 1024 * 1024 * 1024],
	["killGraceMs", 0, 60_000],
	["repaintMs", 100, 10_000],
	["sessionTtlMs", 5_000, 600_000],
];

describe("job config bounds", () => {
	for (const [key, min, max] of CLAMPS) {
		test(`${key} clamps at both ends and leaves an inside value alone`, () => {
			const at = (value: number) => normalizeConfig({ [key]: value }, DEFAULT_CONFIG)[key];
			// The key rides in the object so a red run names which bound moved, rather than
			// printing a number with nothing to place it against.
			expect({ key, below: at(min - 1) }).toEqual({ key, below: min });
			expect({ key, above: at(max + 1) }).toEqual({ key, above: max });
			// Both ends are inclusive: a clamp that pinned every value would pass the two
			// cases above and fail here.
			expect({ key, min: at(min), max: at(max) }).toEqual({ key, min, max });
			expect({ key, inside: at(min + 1) }).toEqual({ key, inside: min + 1 });
		});
	}

	test("every clamped key in the section has a row", () => {
		// The shipped defaults are the section, so their keys are its keys; the cast is that fact.
		const keys = Object.keys(DEFAULT_CONFIG) as (keyof JobsConfig)[];
		const clamped = keys.filter((key) => typeof DEFAULT_CONFIG[key] === "number");
		expect(CLAMPS.map(([key]) => key).sort()).toEqual(clamped.sort());
	});
});
