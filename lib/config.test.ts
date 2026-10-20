import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { tempDir, withAgentDir } from "../test/helpers/env.ts";
import { makeTempTracker } from "../test/helpers/git.ts";
import {
	asBoolean,
	asRecord,
	clampInteger,
	clampNumber,
	cleanString,
	configSection,
	configValueAt,
	loadConfigFile,
	loadConfigSection,
	readJson,
	readJsonResult,
	SHARED_CONFIG_FILE,
	stringList,
	unsetConfigValueAt,
	writeConfigFile,
	writeConfigSection,
	writeConfigValue,
	writeConfigValueAt,
	writeConfigValuesAt,
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

describe("asBoolean", () => {
	test("keeps a boolean and falls back for anything else", () => {
		expect(asBoolean(true, false)).toBe(true);
		expect(asBoolean(false, true)).toBe(false);
		expect(asBoolean("true", true)).toBe(true);
		expect(asBoolean(0, false)).toBe(false);
		expect(asBoolean(undefined, true)).toBe(true);
	});
});

describe("stringList", () => {
	test("keeps trimmed non-empty strings and drops the rest", () => {
		expect(stringList([" a ", "", "  ", 3, "b"], [])).toEqual(["a", "b"]);
	});

	test("returns the fallback when the value is not an array", () => {
		const fallback = ["kept"];
		expect(stringList(undefined, fallback)).toBe(fallback);
		expect(stringList("x", fallback)).toBe(fallback);
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
			$schema: "https://example.test/meta.json",
			version: 1,
			notify: { enabled: false, title: "Pi" },
			memory: { inject: true },
		});

		writeConfigValue(path, "notify", "enabled", true);

		expect(readJson(path)).toEqual({
			$schema: "https://example.test/meta.json",
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

describe("writeConfigValueAt", () => {
	test("creates the intermediate objects it needs", () => {
		const dir = temps.track(tempDir("pi-config-path-"));
		const path = join(dir, SHARED_CONFIG_FILE);

		writeConfigValueAt(path, "price", ["currency", "decimals"], 3);

		expect(readJson(path)).toEqual({ price: { currency: { decimals: 3 } } });
	});

	test("sets one leaf while preserving siblings, metadata, and unknown sections", () => {
		const dir = temps.track(tempDir("pi-config-path-"));
		const path = join(dir, SHARED_CONFIG_FILE);
		writeConfigFile(path, {
			$schema: "https://example.test/meta.json",
			version: 1,
			price: { currency: { symbol: "¥", decimals: 2 }, fallbackToRecordedCost: true },
			notify: { enabled: true },
		});

		writeConfigValueAt(path, "price", ["currency", "decimals"], 3);

		expect(readJson(path)).toEqual({
			$schema: "https://example.test/meta.json",
			version: 1,
			price: { currency: { symbol: "¥", decimals: 3 }, fallbackToRecordedCost: true },
			notify: { enabled: true },
		});
	});

	test("replaces a non-object in the way instead of refusing", () => {
		const dir = temps.track(tempDir("pi-config-path-"));
		const path = join(dir, SHARED_CONFIG_FILE);
		writeConfigFile(path, { price: { currency: "yuan" } });

		writeConfigValueAt(path, "price", ["currency", "decimals"], 3);

		expect(readJson(path)).toEqual({ price: { currency: { decimals: 3 } } });
	});

	test("refuses an empty path, and a malformed document unread", () => {
		const dir = temps.track(tempDir("pi-config-path-"));
		const path = join(dir, SHARED_CONFIG_FILE);
		const before = "{ not json";
		writeFileSync(path, before);

		expect(() => writeConfigValueAt(path, "price", [], 3)).toThrow(/empty key path/);
		expect(() => writeConfigValueAt(path, "price", ["currency"], 3)).toThrow(/Cannot update/);
		expect(readFileSync(path, "utf-8")).toBe(before);
	});
});

describe("writeConfigValuesAt", () => {
	test("sets several leaves in one document pass, keeping every sibling", () => {
		const dir = temps.track(tempDir("pi-config-multi-"));
		const path = join(dir, SHARED_CONFIG_FILE);
		writeConfigFile(path, {
			$schema: "https://example.test/meta.json",
			price: { currency: { symbol: "¥", decimals: 2 }, fallbackToRecordedCost: true },
			notify: { enabled: true },
		});

		writeConfigValuesAt(path, [
			{ section: "price", path: ["currency", "code"], value: "USD" },
			{ section: "price", path: ["currency", "decimals"], value: 3 },
		]);

		expect(readJson(path)).toEqual({
			$schema: "https://example.test/meta.json",
			price: { currency: { symbol: "¥", decimals: 3, code: "USD" }, fallbackToRecordedCost: true },
			notify: { enabled: true },
		});
	});

	test("refuses the whole change when the document cannot be parsed", () => {
		const dir = temps.track(tempDir("pi-config-multi-"));
		const path = join(dir, SHARED_CONFIG_FILE);
		const before = "{ not json";
		writeFileSync(path, before);

		expect(() =>
			writeConfigValuesAt(path, [
				{ section: "price", path: ["currency", "code"], value: "USD" },
				{ section: "price", path: ["currency", "decimals"], value: 3 },
			]),
		).toThrow(/Cannot update/);
		expect(readFileSync(path, "utf-8")).toBe(before);
	});

	test("refuses an empty path before writing anything", () => {
		const dir = temps.track(tempDir("pi-config-multi-"));
		const path = join(dir, SHARED_CONFIG_FILE);

		expect(() =>
			writeConfigValuesAt(path, [
				{ section: "price", path: ["currency", "code"], value: "USD" },
				{ section: "price", path: [], value: 3 },
			]),
		).toThrow(/empty key path/);
		expect(existsSync(path)).toBe(false);
	});
});

describe("configValueAt", () => {
	test("reads a top-level key and a nested path", () => {
		const document = { price: { currency: { decimals: 3 } }, chrome: { rail: "│" } };

		expect(configValueAt(document, ["chrome", "rail"])).toBe("│");
		expect(configValueAt(document, ["price", "currency", "decimals"])).toBe(3);
	});

	test("is undefined when a step is absent or not an object", () => {
		const document = { price: { currency: "yuan" } };

		expect(configValueAt(document, ["price", "currency", "decimals"])).toBeUndefined();
		expect(configValueAt(document, ["notify", "enabled"])).toBeUndefined();
		expect(configValueAt(undefined, ["price"])).toBeUndefined();
	});
});

describe("unsetConfigValueAt", () => {
	test("removes one key and preserves its siblings and other sections", () => {
		const dir = temps.track(tempDir("pi-config-unset-"));
		const path = join(dir, SHARED_CONFIG_FILE);
		writeConfigFile(path, { notify: { enabled: true, title: "Pi" }, memory: { inject: true } });

		unsetConfigValueAt(path, "notify", ["enabled"]);

		expect(readJson(path)).toEqual({ notify: { title: "Pi" }, memory: { inject: true } });
	});

	test("removes a nested leaf and keeps its parent object", () => {
		const dir = temps.track(tempDir("pi-config-unset-"));
		const path = join(dir, SHARED_CONFIG_FILE);
		writeConfigFile(path, { price: { currency: { code: "USD", decimals: 3 }, budget: 5 } });

		unsetConfigValueAt(path, "price", ["currency", "decimals"]);

		expect(readJson(path)).toEqual({ price: { currency: { code: "USD" }, budget: 5 } });
	});

	test("drops parents left empty, the section included, and keeps metadata", () => {
		const dir = temps.track(tempDir("pi-config-unset-"));
		const path = join(dir, SHARED_CONFIG_FILE);
		writeConfigFile(path, { version: 1, price: { currency: { decimals: 3 } }, memory: { inject: true } });

		unsetConfigValueAt(path, "price", ["currency", "decimals"]);

		expect(readJson(path)).toEqual({ version: 1, memory: { inject: true } });
	});

	test("is a no-op for an absent file, section, leaf, or non-object parent", () => {
		const dir = temps.track(tempDir("pi-config-unset-"));
		const absent = join(dir, "absent.json");
		unsetConfigValueAt(absent, "notify", ["enabled"]);
		expect(existsSync(absent)).toBe(false);

		const path = join(dir, SHARED_CONFIG_FILE);
		const before = `${JSON.stringify({ notify: { title: "Pi" }, price: { currency: "yuan" } }, null, 2)}\n`;
		writeFileSync(path, before);
		unsetConfigValueAt(path, "notify", ["enabled"]);
		unsetConfigValueAt(path, "missing", ["enabled"]);
		unsetConfigValueAt(path, "price", ["currency", "decimals"]);
		expect(readFileSync(path, "utf-8")).toBe(before);
	});

	test("refuses a malformed document without rewriting it", () => {
		const dir = temps.track(tempDir("pi-config-unset-"));
		const path = join(dir, SHARED_CONFIG_FILE);
		const before = "{ not json";
		writeFileSync(path, before);

		expect(() => unsetConfigValueAt(path, "notify", ["enabled"])).toThrow(/Cannot update/);
		expect(readFileSync(path, "utf-8")).toBe(before);
	});

	test("refuses an empty path", () => {
		const dir = temps.track(tempDir("pi-config-unset-"));
		const path = join(dir, SHARED_CONFIG_FILE);
		writeConfigFile(path, { notify: { enabled: true } });

		expect(() => unsetConfigValueAt(path, "notify", [])).toThrow(/empty key path/);
	});
});
