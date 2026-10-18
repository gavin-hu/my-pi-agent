import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	applyAdd,
	applyClear,
	applyForget,
	applyMerge,
	applyUpdate,
	duplicateKey,
	MAX_MEMORY_BYTES,
	memoryFileStamp,
	mutateMemoryFile,
	parseEntries,
	projectMemoryPath,
	readMemoryFile,
	sameStamp,
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
		expect(duplicate.existing).toBe("one");
	});

	test("is a no-op for a near-duplicate and reports the stored note", () => {
		const content = "- Use tabs\n";
		for (const variant of ["use tabs", "Use tabs.", "USE TABS!!"]) {
			const result = applyAdd(content, variant);
			expect(result.changed).toBe(false);
			expect(result.content).toBe(content);
			expect(result.existing).toBe("Use tabs");
		}
	});

	test("appends a note that merely shares a prefix or stem", () => {
		const content = "- Use tabs\n";
		expect(applyAdd(content, "Use tabs before committing").changed).toBe(true);
		expect(applyAdd(content, "Tab width is four").changed).toBe(true);
	});
});

describe("duplicateKey", () => {
	test("folds case, whitespace, and trailing punctuation only", () => {
		expect(duplicateKey("Use  Tabs.")).toBe(duplicateKey("use tabs"));
		expect(duplicateKey("one, two")).not.toBe(duplicateKey("one two"));
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

describe("applyUpdate", () => {
	test("replaces an exact note in place, keeping the marker and prose", () => {
		const result = applyUpdate("intro\n  * old note\n- other\n", "old note", "new note");
		expect(result.changed).toBe(true);
		expect(result.content).toBe("intro\n  * new note\n- other\n");
	});

	test("replaces every exact match", () => {
		const result = applyUpdate("- old\n- keep\n- old\n", "old", "new");
		expect(result.content).toBe("- new\n- keep\n- new\n");
	});

	test("reports no change when nothing matches or the note is unchanged", () => {
		const content = "- one\n";
		expect(applyUpdate(content, "missing", "two")).toEqual({ content, changed: false });
		expect(applyUpdate(content, "one", "one")).toEqual({ content, changed: false });
	});
});

describe("applyMerge", () => {
	const stored = ["<!-- header -->", "", "- one", "- two", "- three", ""].join("\n");

	test("replaces the first note in place and drops the second", () => {
		const result = applyMerge(stored, "one", "two", "one and two");
		expect(result.changed).toBe(true);
		expect(parseEntries(result.content)).toEqual(["one and two", "three"]);
		// The merged note keeps the first note's position, so the order a reader
		// learned is the order they still see.
		expect(result.content).toContain("- one and two\n- three");
	});

	test("leaves the header, prose, and every other note untouched", () => {
		const result = applyMerge(stored, "two", "three", "two and three");
		expect(result.content.startsWith("<!-- header -->\n\n- one\n")).toBe(true);
		expect(parseEntries(result.content)).toEqual(["one", "two and three"]);
	});

	test("changes nothing when either note is absent", () => {
		const result = applyMerge(stored, "one", "missing", "merged");
		expect(result).toEqual({ content: stored, changed: false });
		expect(applyMerge(stored, "missing", "one", "merged").changed).toBe(false);
	});

	test("changes nothing when both names are the same note", () => {
		expect(applyMerge(stored, "one", "one", "merged")).toEqual({ content: stored, changed: false });
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

describe("memoryFileStamp", () => {
	test("is undefined for a missing file", () => {
		expect(memoryFileStamp(join(dir, "memory.md"))).toBeUndefined();
	});

	test("reflects the file size and changes when the content changes", () => {
		const path = join(dir, "memory.md");
		writeFileSync(path, "- one\n");
		const first = memoryFileStamp(path);
		expect(first).toBeDefined();
		expect(first?.size).toBe(Buffer.byteLength("- one\n"));

		writeFileSync(path, "- one\n- two\n");
		expect(sameStamp(memoryFileStamp(path), first)).toBe(false);
	});

	test("sameStamp compares missing and present stamps", () => {
		expect(sameStamp(undefined, undefined)).toBe(true);
		expect(sameStamp({ mtimeMs: 1, size: 1 }, undefined)).toBe(false);
		expect(sameStamp({ mtimeMs: 1, size: 1 }, { mtimeMs: 1, size: 1 })).toBe(true);
		expect(sameStamp({ mtimeMs: 1, size: 1 }, { mtimeMs: 1, size: 2 })).toBe(false);
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
