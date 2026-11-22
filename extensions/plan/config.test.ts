import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { tempDir, withAgentDir } from "../../test/helpers/env.ts";
import { DEFAULT_PLAN_CONFIG, loadPlanConfig, normalizePlanConfig } from "./config.ts";

/** Write one `bytefly.json` document. */
function writeDocument(dir: string, document: unknown): void {
	mkdirSync(join(dir, CONFIG_DIR_NAME), { recursive: true });
	writeFileSync(join(dir, CONFIG_DIR_NAME, "bytefly.json"), JSON.stringify(document));
}

describe("normalizePlanConfig", () => {
	test("falls back to the defaults for an absent object", () => {
		expect(normalizePlanConfig(undefined, DEFAULT_PLAN_CONFIG)).toEqual(DEFAULT_PLAN_CONFIG);
	});

	test("keeps at least one plan and refuses more than five thousand", () => {
		expect(normalizePlanConfig({ keep: 0 }, DEFAULT_PLAN_CONFIG).keep).toBe(1);
		expect(normalizePlanConfig({ keep: -20 }, DEFAULT_PLAN_CONFIG).keep).toBe(1);
		expect(normalizePlanConfig({ keep: 250 }, DEFAULT_PLAN_CONFIG).keep).toBe(250);
		expect(normalizePlanConfig({ keep: 99_999 }, DEFAULT_PLAN_CONFIG).keep).toBe(5_000);
	});

	test("clamps maxAgeDays into range, with 0 meaning the count alone decides", () => {
		expect(normalizePlanConfig({ maxAgeDays: -5 }, DEFAULT_PLAN_CONFIG).maxAgeDays).toBe(0);
		expect(normalizePlanConfig({ maxAgeDays: 30 }, DEFAULT_PLAN_CONFIG).maxAgeDays).toBe(30);
		expect(normalizePlanConfig({ maxAgeDays: 99_999 }, DEFAULT_PLAN_CONFIG).maxAgeDays).toBe(3_650);
	});

	test("keeps an inherited bound when the project value is malformed", () => {
		const inherited = { ...DEFAULT_PLAN_CONFIG, keep: 42, maxAgeDays: 30 };
		expect(normalizePlanConfig({ keep: "many", maxAgeDays: null }, inherited)).toEqual(inherited);
	});

	test("takes enabled only from a boolean, so a string cannot switch pruning off", () => {
		expect(normalizePlanConfig({ enabled: false }, DEFAULT_PLAN_CONFIG).enabled).toBe(false);
		expect(normalizePlanConfig({ enabled: "no" }, DEFAULT_PLAN_CONFIG).enabled).toBe(true);
		expect(normalizePlanConfig({ enabled: false }, { ...DEFAULT_PLAN_CONFIG, enabled: false }).enabled).toBe(false);
	});
});

describe("loadPlanConfig", () => {
	test("merges the project file over the defaults", async () => {
		await withAgentDir(async (agentDir) => {
			const cwd = tempDir("plan-config-cwd-");
			writeDocument(cwd, { plan: { keep: 7 } });
			const config = loadPlanConfig(cwd);
			expect(config.keep).toBe(7);
			expect(config.maxAgeDays).toBe(DEFAULT_PLAN_CONFIG.maxAgeDays);
			// The agent dir the write above did not touch is the global layer: absent file, defaults.
			expect(agentDir).not.toBe(cwd);
		});
	});

	test("lets the project document win and inherits the keys it leaves out", async () => {
		await withAgentDir(async (agentDir) => {
			mkdirSync(agentDir, { recursive: true });
			writeFileSync(join(agentDir, "bytefly.json"), JSON.stringify({ plan: { keep: 42, maxAgeDays: 30 } }));
			const cwd = tempDir("plan-config-cwd-");
			writeDocument(cwd, { plan: { keep: 7 } });
			const config = loadPlanConfig(cwd);
			expect(config.keep).toBe(7);
			expect(config.maxAgeDays).toBe(30);
			expect(config.enabled).toBe(true);
		});
	});

	test("reads the global document when the project states no plan section", async () => {
		await withAgentDir(async (agentDir) => {
			mkdirSync(agentDir, { recursive: true });
			writeFileSync(join(agentDir, "bytefly.json"), JSON.stringify({ plan: { enabled: false, keep: 900 } }));
			const cwd = tempDir("plan-config-cwd-");
			writeDocument(cwd, { watch: { enabled: false } });
			const config = loadPlanConfig(cwd);
			expect(config.enabled).toBe(false);
			expect(config.keep).toBe(900);
		});
	});
});
