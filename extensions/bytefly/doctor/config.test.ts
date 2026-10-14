import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { withAgentDir } from "../../../test/helpers/env.ts";
import { DEFAULT_CONFIG, loadConfig, normalizeConfig } from "./config.ts";

/** Wrap a raw doctor object in the bytefly.json document shape. */
const file = (doctor: Record<string, unknown>): Record<string, unknown> => ({ doctor });

describe("normalizeConfig", () => {
	test("returns the base when there is nothing to read", () => {
		expect(normalizeConfig(undefined, DEFAULT_CONFIG)).toEqual(DEFAULT_CONFIG);
	});

	test("returns the base when the doctor section is absent", () => {
		expect(normalizeConfig({ rate: 2 }, DEFAULT_CONFIG)).toEqual(DEFAULT_CONFIG);
	});

	test("takes a boolean proactive flag", () => {
		expect(normalizeConfig(file({ proactive: false }), DEFAULT_CONFIG).proactive).toBe(false);
		expect(normalizeConfig(file({ proactive: "no" }), DEFAULT_CONFIG).proactive).toBe(true);
	});

	test("clamps the probe timeout and rejects nonsense", () => {
		expect(normalizeConfig(file({ timeoutMs: 50 }), DEFAULT_CONFIG).timeoutMs).toBe(100);
		expect(normalizeConfig(file({ timeoutMs: 999_999 }), DEFAULT_CONFIG).timeoutMs).toBe(30_000);
		expect(normalizeConfig(file({ timeoutMs: "soon" }), DEFAULT_CONFIG).timeoutMs).toBe(DEFAULT_CONFIG.timeoutMs);
	});

	test("keeps only usable skip names", () => {
		expect(normalizeConfig(file({ skip: ["wechat", "", 7, "  "] }), DEFAULT_CONFIG).skip).toEqual(["wechat"]);
		expect(normalizeConfig(file({ skip: "wechat" }), DEFAULT_CONFIG).skip).toEqual([]);
	});
});

describe("loadConfig", () => {
	test("reads the global bytefly.json from the agent directory", async () => {
		await withAgentDir(async (dir) => {
			writeFileSync(join(dir, "bytefly.json"), JSON.stringify(file({ proactive: false, timeoutMs: 500 })));
			const config = loadConfig("/nonexistent-cwd");
			expect(config.proactive).toBe(false);
			expect(config.timeoutMs).toBe(500);
		});
	});

	test("ignores a malformed file, like every other config", async () => {
		await withAgentDir(async (dir) => {
			writeFileSync(join(dir, "bytefly.json"), "{ not json");
			expect(loadConfig("/nonexistent-cwd")).toEqual(DEFAULT_CONFIG);
		});
	});
});
