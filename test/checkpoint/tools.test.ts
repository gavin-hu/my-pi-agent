import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import checkpoint from "../../extensions/checkpoint/index.ts";
import { cleanup, makeCtx, makeFakePi, makeRepo } from "./helpers.ts";

const cleanups: string[] = [];
afterAll(() => cleanup(...cleanups));

describe("checkpoint tool", () => {
	let repo: string;
	let fake: ReturnType<typeof makeFakePi>;
	let tool: any;

	beforeAll(async () => {
		repo = await makeRepo("pi-cp-tools-");
		cleanups.push(repo);
		fake = makeFakePi();
		checkpoint(fake.pi);
		tool = fake.tools.get("checkpoint");
	});

	const call = (params: unknown, ctx: any) => tool.execute("id", params, undefined, undefined, ctx);
	const theme: any = { fg: (_c: string, text: string) => text, bold: (text: string) => text };
	const render = (result: any) => tool.renderResult(result, { expanded: false }, theme).render(80).join("\n");

	test("is registered destructive and sequential", () => {
		expect(tool.annotations.destructiveHint).toBe(true);
		expect(tool.annotations.readOnlyHint).toBe(false);
		expect(tool.executionMode).toBe("sequential");
	});

	test("save, list, and diff", async () => {
		const ctx = makeCtx(fake, { cwd: repo });
		writeFileSync(join(repo, "a.txt"), "one\n");
		const saved = await call({ action: "save", label: "first" }, ctx);
		expect(saved.details.action).toBe("save");
		expect(saved.details.checkpoint.label).toBe("first");
		// The chip keeps the count in its first token so the status bar's compact
		// form does not collapse it away, and it does not reuse the worktree icon.
		expect(ctx.statuses.get("checkpoint")).toBe("⟲1");

		writeFileSync(join(repo, "a.txt"), "two\n");
		const listed = await call({ action: "list" }, ctx);
		expect(listed.details.checkpoints).toHaveLength(1);

		const diff = await call({ action: "diff" }, ctx);
		expect(diff.details.action).toBe("diff");
		expect(diff.content[0].text).toContain("a.txt");
	});

	test("restore rewrites the tree after confirmation and saves a safety checkpoint", async () => {
		const ctx = makeCtx(fake, { cwd: repo, hasUI: true, confirm: true });
		rmSync(join(repo, "a.txt"));
		const restored = await call({ action: "restore", id: "last" }, ctx);
		expect(restored.details.action).toBe("restore");
		expect(readFileSync(join(repo, "a.txt"), "utf-8")).toBe("one\n");
		expect(restored.details.restored.safety).toBeDefined();
	});

	test("restore refuses without a UI, before mutating", async () => {
		const ctx = makeCtx(fake, { cwd: repo });
		const result = await call({ action: "restore", id: "last" }, ctx);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("interactive UI");
	});

	test("a cancelled restore leaves files unchanged", async () => {
		const ctx = makeCtx(fake, { cwd: repo, hasUI: true, confirm: false });
		writeFileSync(join(repo, "a.txt"), "three\n");
		const result = await call({ action: "restore", id: "last" }, ctx);
		expect(result.details.action).toBe("restore");
		expect(result.details.restored).toBeUndefined();
		expect(readFileSync(join(repo, "a.txt"), "utf-8")).toBe("three\n");
	});

	test("clear removes the refs", async () => {
		const ctx = makeCtx(fake, { cwd: repo, hasUI: true, confirm: true });
		const result = await call({ action: "clear" }, ctx);
		expect(result.content[0].text).toMatch(/Cleared/);
		expect((await call({ action: "list" }, ctx)).details.checkpoints).toEqual([]);
	});

	test("an unknown id is an error result, not a throw", async () => {
		const ctx = makeCtx(fake, { cwd: repo });
		const result = await call({ action: "restore", id: "missing" }, ctx);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("missing");
	});

	test("an invalid action is an error result", async () => {
		const ctx = makeCtx(fake, { cwd: repo });
		const result = await call({ action: "nope" }, ctx);
		expect(result.isError).toBe(true);
	});

	test("clear distinguishes cancel, a count, and an empty clear", async () => {
		await call({ action: "save", label: "to-clear" }, makeCtx(fake, { cwd: repo }));

		const cancelled = await call({ action: "clear" }, makeCtx(fake, { cwd: repo, hasUI: true, confirm: false }));
		expect(cancelled.details.cleared).toBeUndefined();
		expect(render(cancelled)).toContain("Clear cancelled");

		const done = await call({ action: "clear" }, makeCtx(fake, { cwd: repo, hasUI: true, confirm: true }));
		expect(done.details.cleared).toBeGreaterThan(0);
		expect(render(done)).toContain("Cleared");

		const empty = await call({ action: "clear" }, makeCtx(fake, { cwd: repo, hasUI: true, confirm: true }));
		expect(empty.details.cleared).toBe(0);
		expect(render(empty)).toContain("No checkpoints to clear");
	});
});
