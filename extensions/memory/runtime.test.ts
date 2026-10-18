import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createMemoryRuntime, type MemoryRuntime } from "./runtime.ts";
import { memorySuite, type MemorySuite } from "../../test/helpers/fixtures/memory.ts";

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

describe("memory runtime — move", () => {
	test("moves a project note into global memory", async () => {
		await runtime.add("project", "Use bun for scripts");

		const result = await runtime.move("project", "global", "Use bun for scripts");

		expect(result).toEqual({ moved: true });
		expect(runtime.entries()).toEqual({ project: [], global: ["Use bun for scripts"] });
		expect(read("project")).not.toContain("Use bun for scripts");
		expect(read("global")).toContain("Use bun for scripts");
	});

	test("moves a global note into project memory when the project is trusted", async () => {
		await runtime.add("global", "Pi lives in ~/.pi");

		await runtime.move("global", "project", "Pi lives in ~/.pi");

		expect(runtime.entries()).toEqual({ project: ["Pi lives in ~/.pi"], global: [] });
		expect(read("project")).toContain("Pi lives in ~/.pi");
		expect(read("global")).not.toContain("Pi lives in ~/.pi");
	});

	test("refuses a move into an untrusted project and leaves the source alone", async () => {
		await runtime.add("global", "global fact");
		const untrusted = await load(false);

		await expect(untrusted.move("global", "project", "global fact")).rejects.toThrow(/untrusted/);

		expect(read("global")).toContain("global fact");
		expect(read("project")).not.toContain("global fact");
	});

	test("does not duplicate a note the target already holds, and still removes the source", async () => {
		await runtime.add("project", "Use bun");
		await runtime.add("global", "use bun.");

		const result = await runtime.move("project", "global", "Use bun");

		expect(result.moved).toBe(true);
		expect(result.existing).toBe("use bun.");
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
});
