/**
 * The one atomic write: the text primitive, its temp name, and the JSON face over both.
 *
 * A document arrives by rename, and the mode rides on the temp file it publishes.
 */

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { describe, expect, test } from "bun:test";
import { tempDir } from "../test/helpers/env.ts";
import { tempPathFor, writeJsonFile, writeTextAtomic, memberOf } from "./json.ts";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { writeConfigFile } from "./config.ts";
import { DIR_MODE, FILE_MODE } from "./storage.ts";

describe("writeTextAtomic", () => {
	function newPath(): string {
		return join(tempDir("atomic-write-"), "notes.md");
	}

	test("replaces the file's text in one rename", () => {
		const path = newPath();
		writeTextAtomic(path, "- one\n");
		writeTextAtomic(path, "- two\n");

		expect(readFileSync(path, "utf-8")).toBe("- two\n");
		expect(readdirSync(dirname(path))).toEqual(["notes.md"]);
	});

	test("gives every write its own temp name, which is what two sessions need", () => {
		const path = newPath();
		const first = tempPathFor(path);
		const second = tempPathFor(path);

		// One writer truncating the other's temp is the failure: the pid keeps processes apart
		// and the random suffix keeps two writes in one process apart.
		expect(first).not.toBe(second);
		expect(first).toContain(`.${process.pid}.`);
		expect(first.endsWith(".tmp")).toBe(true);
	});

	test("hides the name when the directory is one a person lists", () => {
		const path = join(newPath(), "2026-10-08-1530-a-plan.md");
		const visible = tempPathFor(path);
		const hidden = tempPathFor(path, { hidden: true });

		// A mid-write temp in the plans directory is a dotfile, so a plain `ls` does not show the
		// half-written file beside the plan; the extension is what actually keeps it out of a plan
		// reader, and `lib/plans/paths.test.ts` holds that half.
		expect(basename(hidden).startsWith(".")).toBe(true);
		expect(basename(hidden)).toContain(".md.");
		expect(basename(visible).startsWith(".")).toBe(false);
		expect(dirname(hidden)).toBe(dirname(path));
		expect(dirname(visible)).toBe(dirname(path));
		// The pid stays in both: hidden is about who sees it, not about who may collide.
		expect(hidden).toContain(`.${process.pid}.`);
		expect(hidden.endsWith(".tmp")).toBe(true);
	});

	test.skipIf(process.platform === "win32")("publishes at the mode it was given", () => {
		const path = newPath();
		// A wider file is narrowed: the mode is on the temp, so the rename is what makes it
		// private, and it survives a umask narrowed far enough to strip the create's bits.
		writeTextAtomic(path, "- open\n");
		writeTextAtomic(path, "- closed\n", { mode: 0o600 });

		expect(statSync(path).mode & 0o777).toBe(0o600);
	});

	test.skipIf(process.platform === "win32")(
		"creates a store's parent owner-only, and narrows one already there",
		() => {
			const dir = join(tempDir("atomic-store-"), "board");
			// The install from before the policy: a directory a umask made group- and world-readable.
			mkdirSync(dir, { recursive: true, mode: 0o755 });
			expect(statSync(dir).mode & 0o777).toBe(0o755);

			writeTextAtomic(join(dir, "card.json"), "{}\n", { mode: FILE_MODE, dirMode: DIR_MODE });

			// No sweep and no upgrade step: the mode is re-stated by the write that needed the store.
			expect(statSync(dir).mode & 0o777).toBe(DIR_MODE);
			expect(statSync(join(dir, "card.json")).mode & 0o777).toBe(FILE_MODE);
		},
	);

	test.skipIf(process.platform === "win32")("leaves a parent it was not asked to narrow as the umask made it", () => {
		// A config document's project `.pi` is not a store: the shared writer must not decide that
		// for it, which is why the directory mode is an option and not the default.
		const root = tempDir("atomic-open-");
		const control = join(root, "control");
		mkdirSync(control);
		writeTextAtomic(join(root, ".pi", "bytefly.json"), "{}");

		expect(statSync(join(root, ".pi")).mode & 0o777).toBe(statSync(control).mode & 0o777);
	});

	test.skipIf(process.platform === "win32")("keeps a config document's project directory as wide as it was", () => {
		// The regression guard for the leak this closed: `writeConfigFile` is the shared writer's
		// other caller — `scripts/migrate-config.ts` and the worktree registry go through it — and a
		// project `.pi` is a directory in a repository, not a store, so the private policy must not
		// reach it by default.
		const root = tempDir("config-parent-");
		const control = join(root, "control");
		mkdirSync(control);

		writeConfigFile(join(root, CONFIG_DIR_NAME, "bytefly.json"), { version: 1 });

		expect(statSync(join(root, CONFIG_DIR_NAME)).mode & 0o777).toBe(statSync(control).mode & 0o777);
	});

	test("takes its temp with it when the rename fails", () => {
		const path = newPath();
		mkdirSync(path);

		expect(() => writeTextAtomic(path, "- lost\n")).toThrow();
		expect(readdirSync(dirname(path))).toEqual(["notes.md"]);
	});
});

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

describe("memberOf", () => {
	const ACTIONS = ["claim", "release"] as const;

	test("answers the value when the table holds it", () => {
		expect(memberOf(ACTIONS, "claim")).toBe("claim");
	});

	test("answers undefined outside it, which a caller words as a refusal", () => {
		// The value a model sends is a string like any other: a verb it does not have must be
		// refused, not guessed at, and a number is no verb at all.
		expect(memberOf(ACTIONS, "reclaim")).toBeUndefined();
		expect(memberOf(ACTIONS, 42)).toBeUndefined();
		expect(memberOf(ACTIONS, undefined)).toBeUndefined();
	});

	test("leaves the default a caller wants to the caller", () => {
		// Which value an absent one falls back to is a fact about the tool: the bus reads a missing
		// kind as `message`, and the board has no default action. A default in the lookup would be
		// one tool's rule imposed on the others.
		const withDefault = (raw: unknown): string => memberOf(ACTIONS, raw) ?? "claim";
		const withoutDefault = (raw: unknown) => memberOf(ACTIONS, raw);
		expect(withDefault(undefined)).toBe("claim");
		expect(withoutDefault(undefined)).toBeUndefined();
	});
});
