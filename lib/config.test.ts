import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { tempDir, withAgentDir } from "../test/helpers/env.ts";
import { makeTempTracker } from "../test/helpers/git.ts";
import {
	asRecord,
	clampInteger,
	clampNumber,
	cleanString,
	configSection,
	loadConfigFile,
	loadConfigSection,
	readJson,
	readJsonResult,
	SHARED_CONFIG_FILE,
	unsetConfigValue,
	writeConfigFile,
	writeConfigSection,
	writeConfigValue,
} from "./config.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** Write `contents` to a temp file and return its path. */
function write(name: string, contents: string): string {
	const dir = temps.track(tempDir("pi-config-"));
	const path = join(dir, name);
	writeFileSync(path, contents);
	return path;
}

describe("clampInteger", () => {
	test("rounds into range and falls back when the value is not a number", () => {
		expect(clampInteger(1500.4, 1000, 100, 2000)).toBe(1500);
		expect(clampInteger(5, 1000, 100, 2000)).toBe(100);
		expect(clampInteger("2500", 1000, 100, 2000)).toBe(2000);
		expect(clampInteger("abc", 1000, 100, 2000)).toBe(1000);
		expect(clampInteger(undefined, 1000, 100, 2000)).toBe(1000);
	});

	test("treats null, a blank string, a boolean, and an array as unset", () => {
		expect(clampInteger(null, 1000, 100, 2000)).toBe(1000);
		expect(clampInteger("   ", 1000, 100, 2000)).toBe(1000);
		expect(clampInteger(true, 1000, 100, 2000)).toBe(1000);
		expect(clampInteger([], 1000, 100, 2000)).toBe(1000);
	});
});

describe("clampNumber", () => {
	test("clamps into range without rounding", () => {
		expect(clampNumber(12.5, 0, 0, 100)).toBe(12.5);
		expect(clampNumber(0.006, 0, 0, 100)).toBe(0.006);
		expect(clampNumber(150.25, 0, 0, 100)).toBe(100);
		expect(clampNumber(-1, 0, 0, 100)).toBe(0);
		expect(clampNumber("2.5", 0, 0, 100)).toBe(2.5);
	});

	test("falls back when the value is not a number", () => {
		expect(clampNumber("abc", 7, 0, 100)).toBe(7);
		expect(clampNumber(undefined, 7, 0, 100)).toBe(7);
		expect(clampNumber(null, 7, 0, 100)).toBe(7);
		expect(clampNumber(true, 7, 0, 100)).toBe(7);
	});
});

describe("cleanString", () => {
	test("trims a non-empty string, and falls back otherwise", () => {
		expect(cleanString("  hi  ", "fb")).toBe("hi");
		expect(cleanString("   ", "fb")).toBe("fb");
		expect(cleanString(7, "fb")).toBe("fb");
		expect(cleanString(undefined, "fb")).toBe("fb");
	});
});

describe("asRecord", () => {
	test("returns a plain object as-is", () => {
		expect(asRecord({ a: 1 })).toEqual({ a: 1 });
		expect(asRecord({})).toEqual({});
	});

	test("returns undefined for an array, null, or a primitive", () => {
		expect(asRecord([1, 2])).toBeUndefined();
		expect(asRecord(null)).toBeUndefined();
		expect(asRecord("x")).toBeUndefined();
		expect(asRecord(undefined)).toBeUndefined();
	});
});

describe("readJsonResult", () => {
	test("reports a missing file as absent, not as an error", () => {
		expect(readJsonResult(join(tempDir("pi-config-"), "nope.json"))).toEqual({ state: "absent" });
	});

	test("returns the parsed object", () => {
		expect(readJsonResult(write("ok.json", '{"mode":"auto"}'))).toEqual({
			state: "ok",
			value: { mode: "auto" },
		});
	});

	test("names the parse error instead of swallowing it", () => {
		const result = readJsonResult(write("bad.json", "{ not json"));
		expect(result.state).toBe("error");
		if (result.state === "error") expect(result.error.length).toBeGreaterThan(0);
	});

	test("rejects a non-object document", () => {
		expect(readJsonResult(write("array.json", "[1,2,3]"))).toEqual({
			state: "error",
			error: "expected a JSON object at the top level",
		});
	});

	test("reports an unreadable path as an error", () => {
		const dir = temps.track(tempDir("pi-config-"));
		mkdirSync(join(dir, "sub"));
		expect(readJsonResult(join(dir, "sub")).state).toBe("error");
	});
});

describe("readJson", () => {
	test("stays lenient: the value or undefined, never a throw", () => {
		expect(readJson(write("ok.json", '{"mode":"always"}'))).toEqual({ mode: "always" });
		expect(readJson(write("bad.json", "{ not json"))).toBeUndefined();
		expect(readJson(write("array.json", "[]"))).toBeUndefined();
		expect(readJson(join(tempDir("pi-config-"), "nope.json"))).toBeUndefined();
	});
});

describe("loadConfigFile", () => {
	test("layers the base, then the global file, then the project file", async () => {
		await withAgentDir(async (agentDir) => {
			const cwd = temps.track(tempDir("pi-config-cwd-"));
			writeFileSync(join(agentDir, "thing.json"), '{"size":2000,"mode":"global"}');
			mkdirSync(join(cwd, CONFIG_DIR_NAME), { recursive: true });
			writeFileSync(join(cwd, CONFIG_DIR_NAME, "thing.json"), '{"mode":"project"}');

			const merged = loadConfigFile(cwd, "thing.json", { size: 1000, mode: "base" }, (raw, base) => ({
				size: clampInteger(raw?.size, base.size, 100, 10_000),
				mode: cleanString(raw?.mode, base.mode),
			}));

			expect(merged).toEqual({ size: 2000, mode: "project" });
		});
	});

	test("ignores a malformed file and keeps the value already in hand", async () => {
		await withAgentDir(async (agentDir) => {
			const cwd = temps.track(tempDir("pi-config-cwd-"));
			writeFileSync(join(agentDir, "broken.json"), "{ not json");
			mkdirSync(join(cwd, CONFIG_DIR_NAME), { recursive: true });
			writeFileSync(join(cwd, CONFIG_DIR_NAME, "broken.json"), "{ still not json");

			const merged = loadConfigFile(cwd, "broken.json", { size: 1000 }, (raw, base) => ({
				size: clampInteger(raw?.size, base.size, 100, 10_000),
			}));

			expect(merged).toEqual({ size: 1000 });
		});
	});
});

describe("configSection", () => {
	test("returns a section object and rejects a non-object", () => {
		expect(configSection({ job: { a: 1 } }, "job")).toEqual({ a: 1 });
		expect(configSection({ job: [1] }, "job")).toBeUndefined();
		expect(configSection(undefined, "job")).toBeUndefined();
		expect(configSection({}, "job")).toBeUndefined();
	});
});

describe("loadConfigSection", () => {
	const normalize = (raw: Record<string, unknown> | undefined, base: { size: number; mode: string }) => ({
		size: clampInteger(raw?.size, base.size, 100, 10_000),
		mode: cleanString(raw?.mode, base.mode),
	});
	const base = { size: 1000, mode: "base" };

	test("layers the global section, then the project section", async () => {
		await withAgentDir(async (agentDir) => {
			const cwd = temps.track(tempDir("pi-config-section-"));
			writeFileSync(join(agentDir, SHARED_CONFIG_FILE), '{"thing":{"size":2000,"mode":"global"}}');
			mkdirSync(join(cwd, CONFIG_DIR_NAME), { recursive: true });
			writeFileSync(join(cwd, CONFIG_DIR_NAME, SHARED_CONFIG_FILE), '{"thing":{"mode":"project"}}');
			expect(loadConfigSection(cwd, "thing", base, normalize)).toEqual({ size: 2000, mode: "project" });
		});
	});

	test("reads a section from an explicit agent directory", () => {
		const agentDir = temps.track(tempDir("pi-config-agent-"));
		const cwd = temps.track(tempDir("pi-config-cwd-"));
		writeFileSync(join(agentDir, SHARED_CONFIG_FILE), '{"thing":{"size":3000}}');
		expect(loadConfigSection(cwd, "thing", base, normalize, { agentDir })).toEqual({ size: 3000, mode: "base" });
	});
});

describe("writeConfigSection", () => {
	test("writes a new document with two-space JSON and a trailing newline", () => {
		const dir = temps.track(tempDir("pi-config-write-"));
		const path = join(dir, "nested", SHARED_CONFIG_FILE);
		writeConfigSection(path, "job", { maxJobs: 5 });
		expect(readJson(path)).toEqual({ job: { maxJobs: 5 } });
		const text = readFileSync(path, "utf-8");
		expect(text.endsWith("\n")).toBe(true);
		expect(text).toContain('"job": {');
	});

	test("merges a section and preserves siblings and metadata", () => {
		const dir = temps.track(tempDir("pi-config-write-"));
		const path = join(dir, SHARED_CONFIG_FILE);
		writeConfigFile(path, { version: 1, job: { a: 1 }, memory: { inject: true } });
		writeConfigSection(path, "job", { b: 2 });
		expect(readJson(path)).toEqual({ version: 1, job: { b: 2 }, memory: { inject: true } });
	});
});

describe("writeConfigValue", () => {
	test("creates a missing file and section, leaving no temp file behind", () => {
		const dir = temps.track(tempDir("pi-config-value-"));
		const path = join(dir, "nested", SHARED_CONFIG_FILE);

		writeConfigValue(path, "notify", "enabled", true);

		expect(readJson(path)).toEqual({ notify: { enabled: true } });
		expect(readFileSync(path, "utf-8").endsWith("\n")).toBe(true);
		expect(readdirSync(join(dir, "nested"))).toEqual([SHARED_CONFIG_FILE]);
	});

	test("sets one key while preserving siblings, metadata, and unknown sections", () => {
		const dir = temps.track(tempDir("pi-config-value-"));
		const path = join(dir, SHARED_CONFIG_FILE);
		writeConfigFile(path, {
			$schema: "https://example.test/bytefly.schema.json",
			version: 1,
			notify: { enabled: false, title: "Pi" },
			memory: { inject: true },
		});

		writeConfigValue(path, "notify", "enabled", true);

		expect(readJson(path)).toEqual({
			$schema: "https://example.test/bytefly.schema.json",
			version: 1,
			notify: { enabled: true, title: "Pi" },
			memory: { inject: true },
		});
	});

	test("refuses a malformed document without rewriting it", () => {
		const dir = temps.track(tempDir("pi-config-value-"));
		const path = join(dir, SHARED_CONFIG_FILE);
		const before = "{ not json";
		writeFileSync(path, before);

		expect(() => writeConfigValue(path, "notify", "enabled", true)).toThrow(/Cannot update/);
		expect(readFileSync(path, "utf-8")).toBe(before);
	});
});

describe("unsetConfigValue", () => {
	test("removes one key and preserves its siblings and other sections", () => {
		const dir = temps.track(tempDir("pi-config-unset-"));
		const path = join(dir, SHARED_CONFIG_FILE);
		writeConfigFile(path, { notify: { enabled: true, title: "Pi" }, memory: { inject: true } });

		unsetConfigValue(path, "notify", "enabled");

		expect(readJson(path)).toEqual({ notify: { title: "Pi" }, memory: { inject: true } });
	});

	test("drops a section that becomes empty and keeps metadata", () => {
		const dir = temps.track(tempDir("pi-config-unset-"));
		const path = join(dir, SHARED_CONFIG_FILE);
		writeConfigFile(path, { version: 1, notify: { enabled: true }, memory: { inject: true } });

		unsetConfigValue(path, "notify", "enabled");

		expect(readJson(path)).toEqual({ version: 1, memory: { inject: true } });
	});

	test("is a no-op for an absent file, section, or key", () => {
		const dir = temps.track(tempDir("pi-config-unset-"));
		const absent = join(dir, "absent.json");
		unsetConfigValue(absent, "notify", "enabled");
		expect(existsSync(absent)).toBe(false);

		const path = join(dir, SHARED_CONFIG_FILE);
		const before = JSON.stringify({ notify: { title: "Pi" } }, null, 2) + "\n";
		writeFileSync(path, before);
		unsetConfigValue(path, "notify", "enabled");
		unsetConfigValue(path, "missing", "enabled");
		expect(readFileSync(path, "utf-8")).toBe(before);
	});

	test("refuses a malformed document without rewriting it", () => {
		const dir = temps.track(tempDir("pi-config-unset-"));
		const path = join(dir, SHARED_CONFIG_FILE);
		const before = "{ not json";
		writeFileSync(path, before);

		expect(() => unsetConfigValue(path, "notify", "enabled")).toThrow(/Cannot update/);
		expect(readFileSync(path, "utf-8")).toBe(before);
	});
});
