import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import checkpoint from "../../extensions/checkpoint/index.ts";
import { createFakePi, emit, type FakePi } from "../helpers/fakes.ts";
import { cleanup, execP, makeCtx, makeRepo } from "./helpers.ts";

const cleanups: string[] = [];
afterAll(() => cleanup(...cleanups));

const TOOLS = [
	{ name: "read", annotations: { readOnlyHint: true } },
	{ name: "grep", annotations: { readOnlyHint: true } },
	{ name: "write", annotations: { readOnlyHint: false, destructiveHint: true } },
	{ name: "edit", annotations: { readOnlyHint: false, destructiveHint: true } },
	{ name: "bash" },
];

function setup(allTools = TOOLS): FakePi {
	delete process.env.PI_WORKTREE_ROOT;
	const fake = createFakePi({
		allTools,
		exec: (command, args, options) => execP(command, args, options),
	});
	checkpoint(fake.pi);
	return fake;
}

/** Count checkpoints via the registered tool. */
async function count(fake: FakePi, ctx: any): Promise<number> {
	const result = await fake.tools.get("checkpoint").execute("id", { action: "list" }, undefined, undefined, ctx);
	return (result.details.checkpoints ?? []).length;
}

describe("automatic snapshots", () => {
	test("snapshots before the first mutating call of a turn, once", async () => {
		const repo = await makeRepo("pi-cp-ext-");
		cleanups.push(repo);
		const fake = setup();
		const ctx = makeCtx(fake, { cwd: repo });

		await emit(fake.pi, "session_start", { reason: "startup" }, ctx);
		await emit(fake.pi, "turn_start", { type: "turn_start", turnIndex: 1 }, ctx);

		writeFileSync(join(repo, "w.txt"), "x\n");
		await emit(fake.pi, "tool_call", { toolName: "write", input: {} }, ctx);
		expect(await count(fake, ctx)).toBe(1);

		// A second mutating call in the same turn does not add another.
		await emit(fake.pi, "tool_call", { toolName: "edit", input: {} }, ctx);
		expect(await count(fake, ctx)).toBe(1);

		// A new turn snapshots again.
		await emit(fake.pi, "turn_start", { type: "turn_start", turnIndex: 2 }, ctx);
		await emit(fake.pi, "tool_call", { toolName: "write", input: {} }, ctx);
		expect(await count(fake, ctx)).toBe(2);
	});

	test("does not snapshot read-only calls", async () => {
		const repo = await makeRepo("pi-cp-ext-read-");
		cleanups.push(repo);
		const fake = setup();
		const ctx = makeCtx(fake, { cwd: repo });
		await emit(fake.pi, "session_start", { reason: "startup" }, ctx);
		await emit(fake.pi, "turn_start", { type: "turn_start", turnIndex: 1 }, ctx);

		await emit(fake.pi, "tool_call", { toolName: "read", input: {} }, ctx);
		expect(await count(fake, ctx)).toBe(0);
	});

	test("mode off disables automatic snapshots", async () => {
		const repo = await makeRepo("pi-cp-ext-off-");
		cleanups.push(repo);
		mkdirSync(join(repo, ".pi"), { recursive: true });
		writeFileSync(join(repo, ".pi", "checkpoint.json"), JSON.stringify({ mode: "off" }));
		const fake = setup();
		const ctx = makeCtx(fake, { cwd: repo });
		await emit(fake.pi, "session_start", { reason: "startup" }, ctx);
		await emit(fake.pi, "turn_start", { type: "turn_start", turnIndex: 1 }, ctx);

		writeFileSync(join(repo, "w.txt"), "x\n");
		await emit(fake.pi, "tool_call", { toolName: "write", input: {} }, ctx);
		expect(await count(fake, ctx)).toBe(0);
	});

	test("a snapshot failure warns and never blocks the tool call", async () => {
		const repo = mkdtempSync(join(tmpdir(), "pi-cp-nocommit-"));
		cleanups.push(repo);
		await execP("git", ["init", "-q"], { cwd: repo });
		const fake = setup();
		const ctx = makeCtx(fake, { cwd: repo });
		await emit(fake.pi, "session_start", { reason: "startup" }, ctx);
		await emit(fake.pi, "turn_start", { type: "turn_start", turnIndex: 1 }, ctx);

		// Must resolve, not reject, and must notify once.
		await emit(fake.pi, "tool_call", { toolName: "write", input: {} }, ctx);
		expect(ctx.notices.some((notice: { kind?: string }) => notice.kind === "warning")).toBe(true);
	});

	test("registers the /checkpoint command", () => {
		const fake = setup();
		expect(fake.commands.has("checkpoint")).toBe(true);
	});
});
