import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLogTail } from "../../extensions/jobs/logs.ts";

describe("readLogTail", () => {
	test("a missing path yields an empty tail", () => {
		expect(readLogTail(join(tmpdir(), "pi-jobs-missing-xyz.log"), 10)).toEqual({ lines: [], truncated: false });
	});

	test("tails the requested lines and sanitizes escapes", () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-jobs-logs-"));
		try {
			const path = join(dir, "j1.log");
			writeFileSync(path, "\u001b[31mred\u001b[0m\nsecond\nthird\n");
			const tail = readLogTail(path, 2);
			expect(tail.lines).toEqual(["second", "third"]);
			expect(tail.truncated).toBe(false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
