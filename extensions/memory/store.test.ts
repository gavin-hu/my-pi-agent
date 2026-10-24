import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withAgentDir } from "../../test/helpers/env.ts";
import { memorySuite, type MemorySuite } from "../../test/helpers/fixtures/memory.ts";
import { DEFAULT_MEMORY_CONFIG, loadMemoryConfig, normalizeMemoryConfig } from "./config.ts";
import { duplicatePairs, formatHealth, memoryHealth } from "./doctor.ts";
import { createMemoryRuntime, type MemoryRuntime } from "./runtime.ts";
import { MAX_ENTRY_CHARS, normalizeAction, normalizeEntryText, normalizeScope } from "./schema.ts";
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

describe("store files", () => {
	let dir = "";

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "pi-memory-store-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	test("readMemoryFile returns empty for a missing file", () => {
		expect(readMemoryFile(join(dir, "memory.md"))).toBe("");
	});

	test("readMemoryFile refuses a file larger than the cap", () => {
		const path = join(dir, "memory.md");
		writeFileSync(path, Buffer.alloc(MAX_MEMORY_BYTES + 1, "a"));
		expect(() => readMemoryFile(path)).toThrow(/larger than/);
	});

	test.skipIf(!SYMLINKS)("readMemoryFile refuses a symlinked path", () => {
		const target = join(dir, "real.md");
		writeFileSync(target, "- one\n");
		const link = join(dir, "memory.md");
		symlinkSync(target, link);
		expect(() => readMemoryFile(link)).toThrow(/symlinked/);
	});

	test("memoryFileStamp is undefined for a missing file", () => {
		expect(memoryFileStamp(join(dir, "memory.md"))).toBeUndefined();
	});

	test("memoryFileStamp reflects the file size and changes when the content changes", () => {
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
		expect(sameStamp({ mtimeNs: 1n, size: 1 }, undefined)).toBe(false);
		expect(sameStamp({ mtimeNs: 1n, size: 1 }, { mtimeNs: 1n, size: 1 })).toBe(true);
		expect(sameStamp({ mtimeNs: 1n, size: 1 }, { mtimeNs: 1n, size: 2 })).toBe(false);
	});

	test("sameStamp sees a change inside one millisecond", () => {
		// The whole point of the nanosecond stamp: two writes in the same millisecond
		// are two states, and a same-size edit is only a change here.
		expect(sameStamp({ mtimeNs: 1_000_000n, size: 4 }, { mtimeNs: 1_000_001n, size: 4 })).toBe(false);
		expect(sameStamp({ mtimeNs: 999_999n, size: 4 }, { mtimeNs: 1_000_000n, size: 4 })).toBe(false);
	});

	test("mutateMemoryFile writes the store and returns the parsed notes", async () => {
		const path = join(dir, "nested", "memory.md");
		const result = await mutateMemoryFile(path, (content) => applyAdd(content, "one"));
		expect(result).toEqual({ entries: ["one"], changed: true });
		expect(readFileSync(path, "utf-8")).toContain("- one");
	});

	test("projectMemoryPath anchors at the repository root when given one", () => {
		expect(projectMemoryPath("/work/tree", "/work/repo")).toBe(join("/work/repo", ".pi", "memory.md"));
		expect(projectMemoryPath("/work/tree")).toBe(join("/work/tree", ".pi", "memory.md"));
	});
});

describe("note parsing", () => {
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

describe("memory runtime", () => {
	let suite: MemorySuite;
	let runtime: MemoryRuntime;

	beforeEach(async () => {
		suite = memorySuite();
		await suite.start();
		runtime = createMemoryRuntime(suite.pi);
		await runtime.load(suite.cwd, true);
	});

	afterEach(() => {
		suite.dispose();
	});

	/** A store's text, or "" when the file has never been written. */
	function read(scope: "project" | "global"): string {
		return suite.exists(scope) ? suite.read(scope) : "";
	}

	/** A runtime loaded over the suite's stores at the given trust level. */
	async function load(trusted: boolean): Promise<MemoryRuntime> {
		const other = createMemoryRuntime(suite.pi);
		await other.load(suite.cwd, trusted);
		return other;
	}

	test("loads both stores, anchoring the project at the repository root", async () => {
		suite.write("project", "- repo fact\n");
		suite.write("global", "- global fact\n");

		const loaded = await load(true);

		expect(loaded.paths()).toEqual({ project: suite.projectPath, global: suite.globalPath });
		expect(loaded.entries()).toEqual({ project: ["repo fact"], global: ["global fact"] });
	});

	test("returns copies of the notes so a caller cannot mutate the cache", () => {
		suite.write("project", "- repo fact\n");

		const entries = runtime.entries();
		entries.project.push("mutated");

		expect(runtime.entries().project).toEqual(["repo fact"]);
	});

	test("add writes the note to the store and the session view", async () => {
		const result = await runtime.add("project", "Use bun for scripts");

		expect(result).toEqual({ changed: true });
		expect(read("project")).toContain("- Use bun for scripts");
		expect(runtime.entries().project).toEqual(["Use bun for scripts"]);
	});

	test("add reports the stored note for an exact or near duplicate", async () => {
		suite.write("project", "- Use tabs\n");
		const loaded = await load(true);

		const result = await loaded.add("project", "use  tabs.");

		expect(result).toEqual({ changed: false, existing: "Use tabs" });
		expect(read("project")).toBe("- Use tabs\n");
	});

	test("update replaces an exact note and persists across a reload", async () => {
		await runtime.add("project", "old note");
		expect(await runtime.update("project", "old note", "new note")).toBe(true);

		const reloaded = await load(true);
		expect(reloaded.entries().project).toEqual(["new note"]);
		expect(read("project")).not.toContain("old note");
	});

	test("update is a no-op when the text is unchanged", async () => {
		await runtime.add("project", "same");
		expect(await runtime.update("project", "same", "same")).toBe(false);
		expect(read("project")).toContain("- same");
	});

	test("forget removes an exact note and persists across a reload", async () => {
		await runtime.add("project", "keep");
		await runtime.add("project", "gone");

		expect(await runtime.forget("project", "gone")).toBe(true);

		const reloaded = await load(true);
		expect(reloaded.entries().project).toEqual(["keep"]);
	});

	test("clear removes every note and reports whether anything changed", async () => {
		await runtime.add("global", "one");
		await runtime.add("global", "two");

		expect(await runtime.clear("global")).toBe(true);
		expect(read("global")).not.toContain("- one");
		expect(runtime.entries().global).toEqual([]);
		expect(await runtime.clear("global")).toBe(false);
	});

	test("merge replaces the first note and drops the second in one write", async () => {
		await runtime.add("project", "one");
		await runtime.add("project", "two");

		expect(await runtime.merge("project", "one", "two", "one and two")).toBe(true);

		const reloaded = await load(true);
		expect(reloaded.entries().project).toEqual(["one and two"]);
	});

	test("merge changes nothing when either note is missing", async () => {
		await runtime.add("project", "one");
		expect(await runtime.merge("project", "one", "missing", "merged")).toBe(false);
		expect(runtime.entries().project).toEqual(["one"]);
	});

	test("write replaces one store's raw text for the editor", async () => {
		await runtime.write("global", "# manual\n- written by hand\n");

		expect(runtime.raw("global")).toBe("# manual\n- written by hand\n");
		expect(runtime.entries().global).toEqual(["written by hand"]);
	});

	test("sizes reports each store's bytes and hides an untrusted project", async () => {
		suite.write("project", "- one\n");
		const trusted = await load(true);
		expect(trusted.sizes()).toEqual({ project: Buffer.byteLength("- one\n"), global: undefined });

		const untrusted = await load(false);
		expect(untrusted.sizes().project).toBeUndefined();
	});

	test("an untrusted load drops project notes but keeps the global store", async () => {
		suite.write("project", "- secret\n");
		suite.write("global", "- shared\n");

		const untrusted = await load(false);

		expect(untrusted.entries()).toEqual({ project: [], global: ["shared"] });
		expect(untrusted.trusted()).toBe(false);
	});

	test("refuses every project mutation while untrusted and leaves the store untouched", async () => {
		suite.write("project", "- secret\n");
		const untrusted = await load(false);

		await expect(untrusted.add("project", "x")).rejects.toThrow(/untrusted/);
		await expect(untrusted.update("project", "secret", "x")).rejects.toThrow(/untrusted/);
		await expect(untrusted.forget("project", "secret")).rejects.toThrow(/untrusted/);
		await expect(untrusted.clear("project")).rejects.toThrow(/untrusted/);
		await expect(untrusted.merge("project", "secret", "secret", "x")).rejects.toThrow(/untrusted/);
		await expect(untrusted.write("project", "- replaced\n")).rejects.toThrow(/untrusted/);

		expect(read("project")).toBe("- secret\n");
	});

	test("allows a global mutation while the project is untrusted", async () => {
		const untrusted = await load(false);

		expect(await untrusted.add("global", "shared fact")).toEqual({ changed: true });
		expect(read("global")).toContain("- shared fact");
	});

	test("refuses every mutation before load", async () => {
		const unloaded = createMemoryRuntime(suite.pi);

		expect(unloaded.paths()).toBeUndefined();
		expect(unloaded.entries()).toEqual({ project: [], global: [] });
		await expect(unloaded.add("global", "x")).rejects.toThrow(/not initialized/);
		await expect(unloaded.update("global", "a", "b")).rejects.toThrow(/not initialized/);
		await expect(unloaded.forget("global", "a")).rejects.toThrow(/not initialized/);
		await expect(unloaded.clear("global")).rejects.toThrow(/not initialized/);
		await expect(unloaded.merge("global", "a", "b", "c")).rejects.toThrow(/not initialized/);
		await expect(unloaded.write("global", "- x\n")).rejects.toThrow(/not initialized/);
		expect(() => unloaded.raw("global")).toThrow(/not initialized/);
	});

	test("load warns about an unreadable store and still reads the other", async () => {
		suite.write("project", "a".repeat(MAX_MEMORY_BYTES + 1));
		suite.write("global", "- shared\n");

		const warning = await runtime.load(suite.cwd, true);

		expect(warning).toMatch(/larger than/);
		expect(runtime.entries()).toEqual({ project: [], global: ["shared"] });
	});

	test("refresh re-reads a store changed on disk and reports only that scope", async () => {
		suite.write("project", "- old fact\n");
		await runtime.load(suite.cwd, true);
		suite.write("project", "- fresh fact\n");

		const result = runtime.refresh();

		expect(result.changed).toEqual(["project"]);
		expect(runtime.entries().project).toEqual(["fresh fact"]);
	});

	test("refresh is a no-op for an unchanged store", () => {
		expect(runtime.refresh()).toEqual({ changed: [] });
	});

	test("refresh keeps the last good view and warns when a store becomes unreadable", async () => {
		suite.write("project", "- keep\n");
		await runtime.load(suite.cwd, true);
		suite.write("project", "a".repeat(MAX_MEMORY_BYTES + 1));

		const result = runtime.refresh();

		expect(result.warning).toMatch(/larger than/);
		expect(result.changed).not.toContain("project");
		expect(runtime.entries().project).toEqual(["keep"]);
	});

	test("refresh ignores the project store while untrusted", async () => {
		const untrusted = await load(false);
		suite.write("project", "- late edit\n");

		expect(untrusted.refresh().changed).toEqual([]);
		expect(untrusted.entries().project).toEqual([]);
	});

	test("a self-write is not reported as an external change", async () => {
		await runtime.add("project", "mine");

		expect(runtime.refresh().changed).toEqual([]);
	});

	test("moves a project note into global memory", async () => {
		await runtime.add("project", "Use bun for scripts");

		const result = await runtime.move("project", "global", "Use bun for scripts");

		expect(result).toEqual({ moved: true });
		expect(runtime.entries()).toEqual({ project: [], global: ["Use bun for scripts"] });
		expect(read("project")).not.toContain("- Use bun for scripts");
		expect(read("global")).toContain("- Use bun for scripts");
	});

	test("moves a global note into project memory when the project is trusted", async () => {
		await runtime.add("global", "Pi lives in ~/.pi");

		await runtime.move("global", "project", "Pi lives in ~/.pi");

		expect(runtime.entries()).toEqual({ project: ["Pi lives in ~/.pi"], global: [] });
		expect(read("project")).toContain("- Pi lives in ~/.pi");
		expect(read("global")).not.toContain("- Pi lives in ~/.pi");
	});

	test("refuses a move into an untrusted project and leaves the source alone", async () => {
		await runtime.add("global", "global fact");
		const untrusted = await load(false);

		await expect(untrusted.move("global", "project", "global fact")).rejects.toThrow(/untrusted/);

		expect(read("global")).toContain("- global fact");
		expect(read("project")).not.toContain("- global fact");
	});

	test("does not duplicate a note the target already holds, and still removes the source", async () => {
		await runtime.add("project", "Use bun");
		await runtime.add("global", "use bun.");

		const result = await runtime.move("project", "global", "Use bun");

		expect(result).toEqual({ moved: true, existing: "use bun." });
		expect(runtime.entries().project).toEqual([]);
		expect(runtime.entries().global).toEqual(["use bun."]);
	});

	test("refuses a note the source does not hold, writing nothing to the target", async () => {
		await runtime.add("project", "only this");

		await expect(runtime.move("project", "global", "something else")).rejects.toThrow(/No project memory note/);

		expect(read("global")).not.toContain("something else");
		expect(runtime.entries().project).toEqual(["only this"]);
	});

	test("refuses a move that does not change scope", async () => {
		await runtime.add("project", "here");
		await expect(runtime.move("project", "project", "here")).rejects.toThrow(/already in project memory/);
	});

	test("sees a note another writer removed before the source write", async () => {
		await runtime.add("project", "vanishing");
		// A second runtime removes the note directly; the first one's cached view is
		// stale, and `move` re-reads before deciding.
		const other = createMemoryRuntime(suite.pi);
		await other.load(suite.cwd, true);
		await other.forget("project", "vanishing");

		await expect(runtime.move("project", "global", "vanishing")).rejects.toThrow(/No project memory note/);
		expect(read("global")).not.toContain("vanishing");
	});

	test.skipIf(!SYMLINKS)("leaves the source note when the target write fails", async () => {
		await runtime.add("project", "survives");
		const target = join(suite.base, "global-target.md");
		writeFileSync(target, "- other\n");
		symlinkSync(target, suite.globalPath);

		await expect(runtime.move("project", "global", "survives")).rejects.toThrow(/symlinked/);

		expect(read("project")).toContain("- survives");
	});

	test("setConfig replaces the recall config", () => {
		const config = { inject: false, maxInjectBytes: 1024 };
		runtime.setConfig(config);
		expect(runtime.config()).toEqual(config);
	});

	test("reset drops the session view, paths, trust, and config", async () => {
		await runtime.add("project", "mine");
		runtime.setConfig({ inject: false, maxInjectBytes: 1024 });

		runtime.reset();

		expect(runtime.paths()).toBeUndefined();
		expect(runtime.trusted()).toBe(false);
		expect(runtime.entries()).toEqual({ project: [], global: [] });
		expect(runtime.config()).toEqual(DEFAULT_MEMORY_CONFIG);
		expect(() => runtime.raw("global")).toThrow(/not initialized/);
	});

	test("reloads after reset", async () => {
		await runtime.add("project", "persisted");
		runtime.reset();

		await runtime.load(suite.cwd, true);

		expect(runtime.entries().project).toEqual(["persisted"]);
	});
});

describe("memory config", () => {
	let cwd = "";

	beforeEach(() => {
		cwd = mkdtempSync(join(tmpdir(), "pi-memory-cfg-"));
	});

	afterEach(() => {
		rmSync(cwd, { recursive: true, force: true });
	});

	test("returns the base for a missing object", () => {
		expect(normalizeMemoryConfig(undefined, DEFAULT_MEMORY_CONFIG)).toEqual(DEFAULT_MEMORY_CONFIG);
	});

	test("clamps maxInjectBytes", () => {
		expect(normalizeMemoryConfig({ maxInjectBytes: 10 }, DEFAULT_MEMORY_CONFIG).maxInjectBytes).toBe(512);
		expect(normalizeMemoryConfig({ maxInjectBytes: 10_000_000 }, DEFAULT_MEMORY_CONFIG).maxInjectBytes).toBe(32768);
	});

	test("ignores an invalid inject flag", () => {
		expect(normalizeMemoryConfig({ inject: "no" }, DEFAULT_MEMORY_CONFIG).inject).toBe(true);
		expect(normalizeMemoryConfig({ inject: false }, DEFAULT_MEMORY_CONFIG).inject).toBe(false);
	});

	test("merges the global file then the project file", async () => {
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		writeFileSync(join(cwd, ".pi", "bytefly.json"), JSON.stringify({ memory: { maxInjectBytes: 1024 } }));
		await withAgentDir((agentDir) => {
			writeFileSync(join(agentDir, "bytefly.json"), JSON.stringify({ memory: { inject: false } }));
			const config = loadMemoryConfig(cwd);
			expect(config.inject).toBe(false);
			expect(config.maxInjectBytes).toBe(1024);
		});
	});

	test("ignores malformed files", async () => {
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		writeFileSync(join(cwd, ".pi", "bytefly.json"), "{ not json");
		await withAgentDir(() => {
			expect(loadMemoryConfig(cwd)).toEqual(DEFAULT_MEMORY_CONFIG);
		});
	});
});

describe("memory schema", () => {
	test("normalizeAction accepts the known actions and rejects others", () => {
		expect(normalizeAction("add")).toBe("add");
		expect(normalizeAction("update")).toBe("update");
		expect(normalizeAction(" FORGET ")).toBe("forget");
		expect(() => normalizeAction("delete")).toThrow(/action must be/);
	});

	test("normalizeScope defaults to project", () => {
		expect(normalizeScope(undefined)).toBe("project");
		expect(normalizeScope("global")).toBe("global");
		expect(() => normalizeScope("team")).toThrow(/scope must be/);
	});

	test("normalizeEntryText collapses to one line", () => {
		expect(normalizeEntryText("  a\n\tb\t")).toBe("a b");
	});

	test("normalizeEntryText rejects a blank, non-string, or over-long note", () => {
		expect(() => normalizeEntryText("   ")).toThrow(/text is required/);
		expect(() => normalizeEntryText(123)).toThrow(/text is required/);
		expect(() => normalizeEntryText("x".repeat(MAX_ENTRY_CHARS + 1))).toThrow(/longer than/);
	});

	test("normalizeEntryText names the field it validates", () => {
		expect(() => normalizeEntryText(undefined, "to")).toThrow(/to is required/);
		expect(() => normalizeEntryText("x".repeat(MAX_ENTRY_CHARS + 1), "to")).toThrow(/to is longer than/);
	});
});

describe("memory health", () => {
	const CONFIG = { inject: true, maxInjectBytes: 8192 };

	function health(
		over: {
			project?: string[];
			global?: string[];
			sizes?: { project?: number; global?: number };
			trusted?: boolean;
			config?: typeof CONFIG;
		} = {},
	) {
		return memoryHealth({
			entries: { project: over.project ?? [], global: over.global ?? [] },
			sizes: { project: over.sizes?.project, global: over.sizes?.global },
			trusted: over.trusted ?? true,
			config: over.config ?? CONFIG,
		});
	}

	test("counts notes and file bytes per store", () => {
		const result = health({ project: ["a", "b"], global: ["c"], sizes: { project: 412, global: 80 } });
		expect(result.project).toEqual({ notes: 2, bytes: 412 });
		expect(result.global).toEqual({ notes: 1, bytes: 80 });
	});

	test("reports the injected bytes and that everything fits", () => {
		const result = health({ project: ["a"], sizes: { project: 9 } });
		expect(result.injection?.bytes).toBeGreaterThan(0);
		expect(result.injection?.omitted).toEqual({ project: 0, global: 0 });
	});

	test("names the store that overflowed the cap", () => {
		const notes = Array.from({ length: 40 }, (_, index) => `note ${index} ${"x".repeat(40)}`);
		const result = health({ global: notes, config: { inject: true, maxInjectBytes: 512 } });
		expect(result.injection?.omitted.global).toBeGreaterThan(0);
		expect(result.injection?.omitted.project).toBe(0);
	});

	test("omits the injection figures when recall is off", () => {
		const result = health({ project: ["a"], config: { inject: false, maxInjectBytes: 8192 } });
		expect(result.injection).toBeUndefined();
	});

	test("keeps duplicate detection inside one scope", () => {
		const result = health({ project: ["Use bun"], global: ["use bun."] });
		expect(result.duplicates).toEqual([]);
	});

	test("pairs notes the conservative key already treats as one fact", () => {
		expect(duplicatePairs({ project: ["Use bun", "other", "use bun."], global: [] })).toEqual([
			{ scope: "project", kept: "Use bun", duplicate: "use bun." },
		]);
	});

	test("keeps paraphrases apart", () => {
		// The key never folds word order or internal punctuation.
		expect(duplicatePairs({ project: ["Run unit tests with bun", "Use bun for tests"], global: [] })).toEqual([]);
	});

	test("prints counts, bytes, the budget, and that the store is clean", () => {
		const text = formatHealth(health({ project: ["a", "b"], sizes: { project: 412, global: 80 } }));
		expect(text.split("\n")[0]).toBe("Memory health");
		expect(text).toMatch(/project\s+2 notes · 412 B/);
		expect(text).toMatch(/global\s+0 notes · 80 B/);
		expect(text).toMatch(/injection +\d+ B of 8192 B · all notes fit/);
		expect(text).toContain("duplicates none");
	});

	test("names the omitted notes and the scope they came from", () => {
		const notes = Array.from({ length: 40 }, (_, index) => `note ${index} ${"x".repeat(40)}`);
		const text = formatHealth(health({ global: notes, config: { inject: true, maxInjectBytes: 512 } }));
		expect(text).toMatch(/injection +\d+ B of 512 B · \d+ omitted \(global \d+\)/);
	});

	test("says when recall is off and when the project store is unreadable", () => {
		const off = formatHealth(health({ config: { inject: false, maxInjectBytes: 8192 } }));
		expect(off).toContain("off (memory.inject is false)");
		const untrusted = formatHealth(health({ trusted: false, global: ["a"], sizes: { global: 20 } }));
		expect(untrusted).toMatch(/project\s+unavailable \(untrusted project\)/);
		expect(untrusted).toMatch(/global\s+1 note · 20 B/);
	});

	test("lists each duplicate pair and points at the merge", () => {
		const text = formatHealth(health({ project: ["Use bun", "use bun."], sizes: { project: 40 } }));
		expect(text).toContain("duplicates 1 pair (merge with m in /memory)");
		expect(text).toContain('project  "Use bun" ≈ "use bun."');
	});
});
