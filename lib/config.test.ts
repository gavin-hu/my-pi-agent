/**
 * `writeJsonFile`: the one atomic JSON write, beside its read twin in `config.ts`.
 *
 * The document arrives by rename, and the mode rides on the temp file it publishes.
 */

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, test } from "bun:test";
import { tempDir } from "../test/helpers/env.ts";
import { writeJsonFile } from "./config.ts";

describe("writeJsonFile", () => {
	function newPath(): string {
		return join(tempDir("json-file-"), "document.json");
	}

	test("writes the document indented and newline-terminated", () => {
		const path = newPath();
		writeJsonFile(path, { a: 1 });
		expect(readFileSync(path, "utf-8")).toBe('{\n  "a": 1\n}\n');
	});

	test("creates the parent directory", () => {
		const dir = tempDir("json-file-nested-");
		const path = join(dir, "a", "b", "document.json");
		writeJsonFile(path, { ok: true });
		expect(readdirSync(join(dir, "a", "b"))).toEqual(["document.json"]);
	});

	test("leaves no temp file behind when it replaces a document", () => {
		const path = newPath();
		writeJsonFile(path, { a: 1 });
		writeJsonFile(path, { a: 2 });
		expect(readdirSync(dirname(path))).toEqual(["document.json"]);
		expect(JSON.parse(readFileSync(path, "utf-8"))).toEqual({ a: 2 });
	});

	test("replaces a corrupt file", () => {
		const path = newPath();
		writeFileSync(path, "{ broken", "utf-8");
		writeJsonFile(path, { a: 1 });
		expect(JSON.parse(readFileSync(path, "utf-8"))).toEqual({ a: 1 });
	});

	test.skipIf(process.platform === "win32")("applies the mode to the file the rename publishes", () => {
		const path = newPath();
		writeJsonFile(path, { secret: true }, { mode: 0o600 });
		expect(statSync(path).mode & 0o777).toBe(0o600);
	});

	test.skipIf(process.platform === "win32")("a mode write narrows a file that was written without one", () => {
		const path = newPath();
		writeJsonFile(path, { secret: false });
		writeJsonFile(path, { secret: true }, { mode: 0o600 });
		// The mode is on the temp, so the rename is what makes the file private: no
		// window where the new document is readable at the old mode. Windows reports one
		// mode for every file, so the assertion is a POSIX one.
		expect(statSync(path).mode & 0o777).toBe(0o600);
	});

	test("keeps the previous document when the new one cannot be serialized", () => {
		const path = newPath();
		writeJsonFile(path, { a: 1 });
		// A value whose serializer refuses stands in for a write that never reaches the
		// rename: nothing is published, and nothing is left behind.
		const unserializable = { a: 2, added: 1n };
		expect(() => writeJsonFile(path, unserializable)).toThrow();
		expect(JSON.parse(readFileSync(path, "utf-8"))).toEqual({ a: 1 });
		expect(readdirSync(dirname(path))).toEqual(["document.json"]);
	});

	test("refuses a value JSON has no form for", () => {
		const path = newPath();
		// `JSON.stringify(undefined)` is `undefined`, so an unchecked write puts the five
		// letters in the file and the next read loads an empty document.
		expect(() => writeJsonFile(path, undefined)).toThrow(TypeError);
		expect(readdirSync(dirname(path))).toEqual([]);
	});

	test("takes its temp with it when the rename fails", () => {
		const path = newPath();
		// A directory at the target is a rename every platform refuses, with the temp already
		// written: the failure must not leave the next write a name to reuse.
		mkdirSync(path);
		expect(() => writeJsonFile(path, { a: 1 })).toThrow();
		expect(readdirSync(dirname(path))).toEqual(["document.json"]);
	});
});
