/**
 * Who can read a note store: the one property of the file that decides whether a note is
 * the owner's alone. Its own capability suite because `store.test.ts` is at the suite bar.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyAdd, mutateMemoryFile } from "./store.ts";

describe("note store file mode", () => {
	let dir = "";

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "pi-memory-mode-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	test.skipIf(process.platform === "win32")("a written store is the user's eyes only", async () => {
		const path = join(dir, "nested", "memory.md");
		await mutateMemoryFile(path, (content) => applyAdd(content, "one"));
		expect(statSync(path).mode & 0o777).toBe(0o600);
	});

	test.skipIf(process.platform === "win32")("a store left at the umask is tightened, even unchanged", async () => {
		const path = join(dir, "memory.md");
		writeFileSync(path, "- one\n");
		// The umask decides a fresh file's mode, so widening it stands in for the 0644 an
		// older build wrote.
		chmodSync(path, 0o644);
		// The note is already there, so the transform reports no change: the mode is the
		// only thing this write has left to fix.
		const result = await mutateMemoryFile(path, (content) => applyAdd(content, "one"));
		expect(result.changed).toBe(false);
		expect(statSync(path).mode & 0o777).toBe(0o600);
	});
});
