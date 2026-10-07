import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import checkpoint from "../../extensions/checkpoint/index.ts";
import { META_MARKER } from "../../extensions/checkpoint/store.ts";
import { createFakePi, emit, type FakePi } from "../helpers/fakes.ts";
import { cleanup, execP, makeCtx, makeRepo } from "./helpers.ts";

const cleanups: string[] = [];
afterAll(() => cleanup(...cleanups));

const NS = "refs/pi/checkpoints";

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

/** Ref names under the checkpoint namespace. */
async function refs(repo: string): Promise<string[]> {
	const out = await execP("git", ["for-each-ref", "--format=%(refname)", NS], { cwd: repo });
	return out.stdout.split("\n").filter(Boolean);
}

/** Parsed metadata for every stored checkpoint. */
async function metadata(repo: string): Promise<any[]> {
	const out = await execP("git", ["for-each-ref", "--format=%(contents)", NS], { cwd: repo });
	return out.stdout
		.split("\n")
		.filter((line) => line.startsWith(META_MARKER))
		.map((line) => JSON.parse(line.slice(META_MARKER.length)));
}

describe("automatic snapshots", () => {
	test("takes one snapshot per prompt, before the first mutating call", async () => {
		const repo = await makeRepo("pi-cp-ext-");
		cleanups.push(repo);
		const fake = setup();
		const ctx = makeCtx(fake, { cwd: repo });

		await emit(fake.pi, "session_start", { reason: "startup" }, ctx);
		await emit(fake.pi, "before_agent_start", { type: "before_agent_start", prompt: "do the task" }, ctx);

		writeFileSync(join(repo, "w.txt"), "x\n");
		await emit(fake.pi, "tool_call", { toolName: "write", input: {} }, ctx);
		expect((await refs(repo)).length).toBe(1);

		// A later mutating call in the same prompt takes no further snapshot.
		await emit(fake.pi, "tool_call", { toolName: "edit", input: {} }, ctx);
		expect((await refs(repo)).length).toBe(1);
	});

	test("a new prompt snapshots again", async () => {
		const repo = await makeRepo("pi-cp-ext-prompt2-");
		cleanups.push(repo);
		const fake = setup();
		const ctx = makeCtx(fake, { cwd: repo });
		await emit(fake.pi, "session_start", { reason: "startup" }, ctx);

		await emit(fake.pi, "before_agent_start", { type: "before_agent_start", prompt: "first" }, ctx);
		writeFileSync(join(repo, "w.txt"), "x\n");
		await emit(fake.pi, "tool_call", { toolName: "write", input: {} }, ctx);

		await emit(fake.pi, "before_agent_start", { type: "before_agent_start", prompt: "second" }, ctx);
		await emit(fake.pi, "tool_call", { toolName: "edit", input: {} }, ctx);
		expect((await refs(repo)).length).toBe(2);
	});

	test("does not snapshot read-only calls", async () => {
		const repo = await makeRepo("pi-cp-ext-read-");
		cleanups.push(repo);
		const fake = setup();
		const ctx = makeCtx(fake, { cwd: repo });
		await emit(fake.pi, "session_start", { reason: "startup" }, ctx);
		await emit(fake.pi, "before_agent_start", { type: "before_agent_start", prompt: "read only" }, ctx);

		await emit(fake.pi, "tool_call", { toolName: "read", input: {} }, ctx);
		expect((await refs(repo)).length).toBe(0);
	});

	test("labels the snapshot with the prompt summary", async () => {
		const repo = await makeRepo("pi-cp-ext-label-");
		cleanups.push(repo);
		const fake = setup();
		const ctx = makeCtx(fake, { cwd: repo });
		await emit(fake.pi, "session_start", { reason: "startup" }, ctx);
		await emit(
			fake.pi,
			"before_agent_start",
			{ type: "before_agent_start", prompt: "  fix   the list\nmore detail" },
			ctx,
		);

		writeFileSync(join(repo, "w.txt"), "x\n");
		await emit(fake.pi, "tool_call", { toolName: "write", input: {} }, ctx);

		const [meta] = await metadata(repo);
		expect(meta.prompt).toBe("fix the list");
		expect(meta.v).toBe(2);
	});

	test("autoSnapshots false disables automatic snapshots", async () => {
		const repo = await makeRepo("pi-cp-ext-off-");
		cleanups.push(repo);
		mkdirSync(join(repo, ".pi"), { recursive: true });
		writeFileSync(join(repo, ".pi", "checkpoint.json"), JSON.stringify({ autoSnapshots: false }));
		const fake = setup();
		const ctx = makeCtx(fake, { cwd: repo });
		await emit(fake.pi, "session_start", { reason: "startup" }, ctx);
		await emit(fake.pi, "before_agent_start", { type: "before_agent_start", prompt: "task" }, ctx);

		writeFileSync(join(repo, "w.txt"), "x\n");
		await emit(fake.pi, "tool_call", { toolName: "write", input: {} }, ctx);
		expect((await refs(repo)).length).toBe(0);
	});

	test("a snapshot failure warns and never blocks the tool call", async () => {
		const repo = mkdtempSync(join(tmpdir(), "pi-cp-nocommit-"));
		cleanups.push(repo);
		await execP("git", ["init", "-q"], { cwd: repo });
		const fake = setup();
		const ctx = makeCtx(fake, { cwd: repo });
		await emit(fake.pi, "session_start", { reason: "startup" }, ctx);
		await emit(fake.pi, "before_agent_start", { type: "before_agent_start", prompt: "task" }, ctx);

		// Must resolve, not reject, and must notify once.
		await emit(fake.pi, "tool_call", { toolName: "write", input: {} }, ctx);
		expect(ctx.notices.some((notice: { kind?: string }) => notice.kind === "warning")).toBe(true);
	});

	test("registers the /checkpoint command", () => {
		const fake = setup();
		expect(fake.commands.has("checkpoint")).toBe(true);
	});
});

describe("/checkpoint command", () => {
	test("opens the list screen in the TUI", async () => {
		const repo = await makeRepo("pi-cp-cmd-tui-");
		cleanups.push(repo);
		const fake = setup();
		const ctx = makeCtx(fake, { cwd: repo, hasUI: true });
		await emit(fake.pi, "session_start", { reason: "startup" }, ctx);

		await fake.commands.get("checkpoint").handler("", ctx);
		expect(ctx.customCalls).toHaveLength(1);
	});

	test("prints the list without a terminal", async () => {
		const repo = await makeRepo("pi-cp-cmd-print-");
		cleanups.push(repo);
		const fake = setup();
		const ctx = makeCtx(fake, { cwd: repo, hasUI: false });
		await emit(fake.pi, "session_start", { reason: "startup" }, ctx);

		await fake.commands.get("checkpoint").handler("", ctx);
		expect(ctx.notices.at(-1).message).toContain("No checkpoints yet");
	});

	test("offers friendly restore labels over RPC, never the raw id", async () => {
		const repo = await makeRepo("pi-cp-cmd-pick-");
		cleanups.push(repo);
		const fake = setup();
		const ctx = makeCtx(fake, { cwd: repo, hasUI: true, mode: "rpc" });
		await fake.commands.get("checkpoint").handler("save first", ctx);
		await fake.commands.get("checkpoint").handler("save second", ctx);

		await fake.commands.get("checkpoint").handler("restore", ctx);
		expect(ctx.selects).toHaveLength(1);
		expect(ctx.selects[0]).toHaveLength(2);
		for (const label of ctx.selects[0]) expect(label).not.toContain("#");
		expect(ctx.selects[0][0]).toContain("·");
	});

	test("restores the checkpoint chosen from the TUI list", async () => {
		const repo = await makeRepo("pi-cp-cmd-tui-restore-");
		cleanups.push(repo);
		const fake = setup();
		const ctx = makeCtx(fake, { cwd: repo, hasUI: true });
		await fake.commands.get("checkpoint").handler("save baseline", ctx);
		writeFileSync(join(repo, "w.txt"), "changed\n");
		const ref = (await refs(repo))[0];
		const id = ref.split("/").pop() as string;
		const commit = (await execP("git", ["rev-parse", ref], { cwd: repo })).stdout.trim();
		const checkpoint = { ...(await metadata(repo))[0], id, ref, commit };

		ctx.ui.custom = async () => ({ action: "restore", checkpoint });
		await fake.commands.get("checkpoint").handler("", ctx);

		// w.txt was created after the snapshot, so restoring removes it.
		expect(existsSync(join(repo, "w.txt"))).toBe(false);
	});

	test("saves a labeled checkpoint from the menu", async () => {
		const repo = await makeRepo("pi-cp-cmd-menu-save-");
		cleanups.push(repo);
		const fake = setup();
		const ctx = makeCtx(fake, { cwd: repo, hasUI: true, input: "mid-task" });
		let opens = 0;
		ctx.ui.custom = async () => (++opens === 1 ? { action: "save" } : undefined);

		await fake.commands.get("checkpoint").handler("", ctx);
		expect((await refs(repo)).length).toBe(1);
		const [meta] = await metadata(repo);
		expect(meta.label).toBe("mid-task");
		expect(meta.reason).toBe("manual");
	});

	test("diff shows the change preview", async () => {
		const repo = await makeRepo("pi-cp-cmd-diff-");
		cleanups.push(repo);
		const fake = setup();
		const ctx = makeCtx(fake, { cwd: repo, hasUI: false });
		writeFileSync(join(repo, "a.txt"), "one\n");
		await fake.commands.get("checkpoint").handler("save base", ctx);
		writeFileSync(join(repo, "a.txt"), "two\n");

		await fake.commands.get("checkpoint").handler("diff last", ctx);
		expect(ctx.notices.at(-1).message).toContain("a.txt");
	});

	test("clear removes the refs after confirmation", async () => {
		const repo = await makeRepo("pi-cp-cmd-clear-");
		cleanups.push(repo);
		const fake = setup();
		const ctx = makeCtx(fake, { cwd: repo, hasUI: true, confirm: true });
		await fake.commands.get("checkpoint").handler("save base", ctx);
		expect((await refs(repo)).length).toBe(1);

		await fake.commands.get("checkpoint").handler("clear", ctx);
		expect((await refs(repo)).length).toBe(0);
		expect(ctx.notices.at(-1).message).toMatch(/Cleared/);
	});

	test("restore refuses without an interactive UI", async () => {
		const repo = await makeRepo("pi-cp-cmd-headless-");
		cleanups.push(repo);
		const fake = setup();
		const ctx = makeCtx(fake, { cwd: repo, hasUI: false });
		await fake.commands.get("checkpoint").handler("save base", ctx);

		await fake.commands.get("checkpoint").handler("restore last", ctx);
		expect(ctx.notices.at(-1).message).toMatch(/interactive UI/);
	});
});
