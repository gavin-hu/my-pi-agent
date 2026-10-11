import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../test/helpers/env.ts";
import { makeTempTracker } from "../test/helpers/git.ts";
import { readJson, readJsonResult } from "./config.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** Write `contents` to a temp file and return its path. */
function write(name: string, contents: string): string {
	const dir = temps.track(tempDir("pi-config-"));
	const path = join(dir, name);
	writeFileSync(path, contents);
	return path;
}

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
