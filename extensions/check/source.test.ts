import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../../test/helpers/env.ts";
import { MAX_SOURCE_BYTES, readSourceExcerpt } from "./source.ts";
import type { Failure } from "./types.ts";

const dirs: string[] = [];
afterAll(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** A temp project with a source file. */
function project(lines = 20): { root: string; path: string } {
	const root = tempDir("pi-check-source-");
	dirs.push(root);
	mkdirSync(join(root, "src"), { recursive: true });
	const path = join(root, "src", "a.ts");
	writeFileSync(path, Array.from({ length: lines }, (_, index) => `line ${index + 1}`).join("\n"));
	return { root, path };
}

/** A failure at `path:line`. */
function failure(path: string | undefined, line?: number): Failure {
	return { path, line, message: "nope", command: "check" };
}

describe("readSourceExcerpt", () => {
	test("reads five lines either side and marks the target line", () => {
		const { root } = project();
		const result = readSourceExcerpt(root, failure("src/a.ts", 10));

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.excerpt).toMatchObject({ startLine: 5, endLine: 15, targetLine: 10 });
		expect(result.excerpt.lines[0]).toBe("line 5");
		expect(result.excerpt.lines.at(-1)).toBe("line 15");
		expect(result.excerpt.lines).toHaveLength(11);
	});

	test("clamps at the first and last line", () => {
		const { root } = project();
		const first = readSourceExcerpt(root, failure("src/a.ts", 1));
		const last = readSourceExcerpt(root, failure("src/a.ts", 20));

		expect(first.ok && first.excerpt).toMatchObject({ startLine: 1, endLine: 6, targetLine: 1 });
		expect(last.ok && last.excerpt).toMatchObject({ startLine: 15, endLine: 20, targetLine: 20 });
	});

	test("accepts an absolute path inside the project", () => {
		const { root, path } = project();
		expect(readSourceExcerpt(root, failure(path, 2)).ok).toBe(true);
	});

	test("refuses a path outside the project, a missing file, and a directory", () => {
		const { root } = project();
		const outside = readSourceExcerpt(root, failure("../outside.ts", 1));
		const missing = readSourceExcerpt(root, failure("src/missing.ts", 1));
		const directory = readSourceExcerpt(root, failure("src", 1));

		expect(outside).toEqual({ ok: false, reason: "outside the project" });
		expect(missing).toEqual({ ok: false, reason: "file is missing" });
		expect(directory).toEqual({ ok: false, reason: "not a regular file" });
	});

	test("refuses a binary or oversized file and an out-of-range line", () => {
		const { root } = project();
		writeFileSync(join(root, "src", "bin.ts"), "a\u0000b");
		writeFileSync(join(root, "src", "big.ts"), "x".repeat(MAX_SOURCE_BYTES + 1));

		expect(readSourceExcerpt(root, failure("src/bin.ts", 1))).toEqual({ ok: false, reason: "binary file" });
		expect(readSourceExcerpt(root, failure("src/big.ts", 1))).toEqual({ ok: false, reason: "file is too large" });
		expect(readSourceExcerpt(root, failure("src/a.ts", 99))).toMatchObject({ ok: false });
	});

	test("refuses a symlink that leaves the project", () => {
		if (process.platform === "win32") return;
		const { root } = project();
		const outside = tempDir("pi-check-source-outside-");
		dirs.push(outside);
		const target = join(outside, "secret.ts");
		writeFileSync(target, "secret\n");
		symlinkSync(target, join(root, "src", "link.ts"));

		expect(readSourceExcerpt(root, failure("src/link.ts", 1))).toEqual({ ok: false, reason: "outside the project" });
	});

	test("requires a path and a line", () => {
		const { root } = project();
		expect(readSourceExcerpt(root, failure(undefined, 1))).toEqual({ ok: false, reason: "no file location" });
		expect(readSourceExcerpt(root, failure("src/a.ts"))).toEqual({ ok: false, reason: "no line number" });
	});
});
