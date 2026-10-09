import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	applyAdd,
	applyClear,
	applyForget,
	MAX_MEMORY_BYTES,
	mutateMemoryFile,
	parseEntries,
	projectMemoryPath,
	readMemoryFile,
} from "./store.ts";

let dir = "";

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "pi-memory-store-"));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

/** Whether this host can create symlinks (unprivileged Windows cannot). */
function probeSymlinks(): boolean {
	const probe = mkdtempSync(join(tmpdir(), "pi-memory-link-"));
	try {
		symlinkSync(join(probe, "target"), join(probe, "link"));
		return true;
	} catch {
		return false;
	} finally {
		rmSync(probe, { recursive: true, force: true });
	}
}

const SYMLINKS = probeSymlinks();

describe("parseEntries", () => {
	test("reads bullet notes and ignores every other line", () => {
		const content = ["# Notes", "some prose", "- first", "  * second", "", "not a note"].join("\n");
		expect(parseEntries(content)).toEqual(["first", "second"]);
	});

	test("sanitizes control characters and drops blank notes", () => {
		expect(parseEntries("- a\u001b[31mred\n- \u0007")).toEqual(["a [31mred"]);
	});
});

describe("applyAdd", () => {
	test("creates a header on the first write, then appends", () => {
		const first = applyAdd("", "one");
		expect(first.changed).toBe(true);
		expect(first.content.startsWith("<!--")).toBe(true);
		expect(first.content).toContain("- one");

		const second = applyAdd(first.content, "two");
		expect(second.content).toContain("- one");
		expect(second.content).toContain("- two");
	});

	test("preserves prose and is a no-op for a duplicate note", () => {
		const content = "# Notes\nkeep me\n\n- one\n";
		const added = applyAdd(content, "two");
		expect(added.content).toContain("keep me");

		const duplicate = applyAdd(added.content, "one");
		expect(duplicate.changed).toBe(false);
		expect(duplicate.content).toBe(added.content);
	});
});

describe("applyForget", () => {
	test("removes every exact match and keeps prose", () => {
		const result = applyForget("intro\n- one\n- two\n- one\n", "one");
		expect(result.changed).toBe(true);
		expect(result.content).toContain("intro");
		expect(result.content).toContain("- two");
		expect(result.content).not.toContain("- one");
	});

	test("reports no change when nothing matches", () => {
		const content = "- one\n";
		expect(applyForget(content, "missing")).toEqual({ content, changed: false });
	});
});

describe("applyClear", () => {
	test("removes notes but keeps the header", () => {
		const result = applyClear("<!-- keep -->\n\n- one\n- two\n");
		expect(result.changed).toBe(true);
		expect(result.content).toContain("<!-- keep -->");
		expect(result.content).not.toContain("- one");
	});

	test("reports no change for a store with no notes", () => {
		const content = "<!-- keep -->\n";
		expect(applyClear(content)).toEqual({ content, changed: false });
	});
});

describe("readMemoryFile", () => {
	test("returns empty for a missing file", () => {
		expect(readMemoryFile(join(dir, "memory.md"))).toBe("");
	});

	test("refuses a file larger than the cap", () => {
		const path = join(dir, "memory.md");
		writeFileSync(path, Buffer.alloc(MAX_MEMORY_BYTES + 1, "a"));
		expect(() => readMemoryFile(path)).toThrow(/larger than/);
	});

	test.skipIf(!SYMLINKS)("refuses a symlinked path", () => {
		const target = join(dir, "real.md");
		writeFileSync(target, "- one\n");
		const link = join(dir, "memory.md");
		symlinkSync(target, link);
		expect(() => readMemoryFile(link)).toThrow(/symlinked/);
	});
});

describe("mutateMemoryFile", () => {
	test("writes the store and returns the parsed notes", async () => {
		const path = join(dir, "nested", "memory.md");
		const result = await mutateMemoryFile(path, (content) => applyAdd(content, "one"));
		expect(result).toEqual({ entries: ["one"], changed: true });
		expect(readFileSync(path, "utf-8")).toContain("- one");
	});
});

describe("projectMemoryPath", () => {
	test("anchors at the repository root when given one", () => {
		expect(projectMemoryPath("/work/tree", "/work/repo")).toBe(join("/work/repo", ".pi", "memory.md"));
		expect(projectMemoryPath("/work/tree")).toBe(join("/work/tree", ".pi", "memory.md"));
	});
});
