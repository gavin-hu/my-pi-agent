import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { tempDir, withAgentDir } from "../test/helpers/env.ts";
import { makeTempTracker } from "../test/helpers/git.ts";
import {
	asRecord,
	clampInteger,
	clampNumber,
	cleanString,
	loadConfigFile,
	readJson,
	readJsonResult,
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
