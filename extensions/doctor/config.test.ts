import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { withAgentDir } from "../../test/helpers/env.ts";
import { DEFAULT_CONFIG, loadConfig, normalizeConfig } from "./config.ts";

describe("normalizeConfig", () => {
	test("returns the base when there is nothing to read", () => {
		expect(normalizeConfig(undefined, DEFAULT_CONFIG)).toEqual(DEFAULT_CONFIG);
	});

	test("takes a boolean proactive flag", () => {
		expect(normalizeConfig({ proactive: false }, DEFAULT_CONFIG).proactive).toBe(false);
		expect(normalizeConfig({ proactive: "no" }, DEFAULT_CONFIG).proactive).toBe(true);
	});

	test("clamps the probe timeout and rejects nonsense", () => {
		expect(normalizeConfig({ timeoutMs: 50 }, DEFAULT_CONFIG).timeoutMs).toBe(100);
		expect(normalizeConfig({ timeoutMs: 999_999 }, DEFAULT_CONFIG).timeoutMs).toBe(30_000);
		expect(normalizeConfig({ timeoutMs: "soon" }, DEFAULT_CONFIG).timeoutMs).toBe(DEFAULT_CONFIG.timeoutMs);
	});

	test("keeps only usable skip names", () => {
		expect(normalizeConfig({ skip: ["wechat", "", 7, "  "] }, DEFAULT_CONFIG).skip).toEqual(["wechat"]);
		expect(normalizeConfig({ skip: "wechat" }, DEFAULT_CONFIG).skip).toEqual([]);
	});
});

describe("loadConfig", () => {
	test("reads the global file from the agent directory", async () => {
		await withAgentDir(async (dir) => {
			writeFileSync(join(dir, "doctor.json"), JSON.stringify({ proactive: false, timeoutMs: 500 }));
			const config = loadConfig("/nonexistent-cwd");
			expect(config.proactive).toBe(false);
			expect(config.timeoutMs).toBe(500);
		});
	});

	test("ignores a malformed file, like every other config", async () => {
		await withAgentDir(async (dir) => {
			writeFileSync(join(dir, "doctor.json"), "{ not json");
			expect(loadConfig("/nonexistent-cwd")).toEqual(DEFAULT_CONFIG);
		});
	});
});
