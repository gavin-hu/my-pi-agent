import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withAgentDir } from "../../../test/helpers/env.ts";
import { DEFAULT_NOTIFY_CONFIG, loadNotifyConfig, normalizeNotifyConfig } from "./config.ts";

let cwd = "";

beforeEach(() => {
	cwd = mkdtempSync(join(tmpdir(), "pi-bytefly-notify-"));
});

afterEach(() => {
	rmSync(cwd, { recursive: true, force: true });
});

/** Write a config file into `dir`, creating it if needed. */
function writeConfig(dir: string, value: unknown): void {
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "bytefly.json"), JSON.stringify(value));
}

describe("normalizeNotifyConfig", () => {
	test("returns the base for a missing object", () => {
		expect(normalizeNotifyConfig(undefined, DEFAULT_NOTIFY_CONFIG)).toEqual(DEFAULT_NOTIFY_CONFIG);
	});

	test("is off by default and keeps the base with no notify section", () => {
		expect(DEFAULT_NOTIFY_CONFIG.enabled).toBe(false);
		expect(normalizeNotifyConfig({ currency: { symbol: "$" } }, DEFAULT_NOTIFY_CONFIG)).toEqual(DEFAULT_NOTIFY_CONFIG);
	});

	test("reads each flag and falls back on a wrong type", () => {
		const config = normalizeNotifyConfig(
			{ notify: { enabled: true, turnFinished: false, needsInput: "yes", jobFinished: true } },
			DEFAULT_NOTIFY_CONFIG,
		);
		expect(config.enabled).toBe(true);
		expect(config.turnFinished).toBe(false);
		expect(config.needsInput).toBe(true);
		expect(config.jobFinished).toBe(true);
	});

	test("accepts a known method and rejects an unknown one", () => {
		expect(normalizeNotifyConfig({ notify: { method: "notify-send" } }, DEFAULT_NOTIFY_CONFIG).method).toBe(
			"notify-send",
		);
		expect(normalizeNotifyConfig({ notify: { method: "carrier-pigeon" } }, DEFAULT_NOTIFY_CONFIG).method).toBe("auto");
	});

	test("trims the title and clamps it to forty characters", () => {
		expect(normalizeNotifyConfig({ notify: { title: "  Deploy  " } }, DEFAULT_NOTIFY_CONFIG).title).toBe("Deploy");
		expect(normalizeNotifyConfig({ notify: { title: "x".repeat(80) } }, DEFAULT_NOTIFY_CONFIG).title).toHaveLength(40);
		expect(normalizeNotifyConfig({ notify: { title: "   " } }, DEFAULT_NOTIFY_CONFIG).title).toBe("Pi");
	});
});

describe("loadNotifyConfig", () => {
	test("is off with no file at all", () => {
		return withAgentDir(() => {
			expect(loadNotifyConfig(cwd)).toEqual(DEFAULT_NOTIFY_CONFIG);
		});
	});

	test("layers the global file, then the project file over it", () => {
		writeConfig(join(cwd, ".pi"), { notify: { enabled: true, method: "osc99" } });
		return withAgentDir((agentDir) => {
			writeConfig(agentDir, { notify: { enabled: false, method: "toast", title: "Build" } });
			const config = loadNotifyConfig(cwd);
			expect(config.enabled).toBe(true);
			expect(config.method).toBe("osc99");
			expect(config.title).toBe("Build");
		});
	});

	test("ignores a malformed file", () => {
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		writeFileSync(join(cwd, ".pi", "bytefly.json"), "{ not json");
		return withAgentDir(() => {
			expect(loadNotifyConfig(cwd)).toEqual(DEFAULT_NOTIFY_CONFIG);
		});
	});
});
