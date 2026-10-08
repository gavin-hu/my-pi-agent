import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import rewind from "../../extensions/rewind/index.ts";
import { META_MARKER } from "../../extensions/rewind/store.ts";
import { createFakePi, emit, type FakePi } from "../helpers/fakes.ts";
import { cleanup, execP, makeCtx, makeRepo } from "./helpers.ts";

const cleanups: string[] = [];
afterAll(() => cleanup(...cleanups));

const NS = "refs/pi/rewind";

const TOOLS = [
	{ name: "read", annotations: { readOnlyHint: true } },
	{ name: "grep", annotations: { readOnlyHint: true } },
	{ name: "write", annotations: { readOnlyHint: false, destructiveHint: true } },
	{ name: "edit", annotations: { readOnlyHint: false, destructiveHint: true } },
	{ name: "bash" },
];

/** A branch with one user message, as the session manager would report it. */
function branchWithUser(id = "e1", text = "do the task") {
	return [
		{
			type: "message",
			id,
			parentId: null,
			timestamp: new Date(1000).toISOString(),
			message: { role: "user", content: text, timestamp: 1000 },
		},
	];
}

function setup(allTools = TOOLS): FakePi {
	delete process.env.PI_WORKTREE_ROOT;
	const fake = createFakePi({
		allTools,
		exec: (command, args, options) => execP(command, args, options),
	});
	rewind(fake.pi);
	return fake;
}

/** Ref names under the rewind namespace. */
async function refs(repo: string): Promise<string[]> {
	const out = await execP("git", ["for-each-ref", "--format=%(refname)", NS], { cwd: repo });
	return out.stdout.split("\n").filter(Boolean);
}

/** Parsed metadata for every stored snapshot. */
async function metadata(repo: string): Promise<any[]> {
	const out = await execP("git", ["for-each-ref", "--format=%(contents)", NS], { cwd: repo });
	return out.stdout
		.split("\n")
		.filter((line) => line.startsWith(META_MARKER))
		.map((line) => JSON.parse(line.slice(META_MARKER.length)));
}

describe("automatic snapshots", () => {
	test("takes one snapshot per prompt, before the first mutating call", async () => {
		const repo = await makeRepo("pi-rw-ext-");
		cleanups.push(repo);
		const fake = setup();
		const ctx = makeCtx(fake, { cwd: repo, branch: branchWithUser() });

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
		const repo = await makeRepo("pi-rw-ext-prompt2-");
		cleanups.push(repo);
		const fake = setup();
		const ctx = makeCtx(fake, { cwd: repo, branch: branchWithUser() });
		await emit(fake.pi, "session_start", { reason: "startup" }, ctx);

		await emit(fake.pi, "before_agent_start", { type: "before_agent_start", prompt: "first" }, ctx);
		writeFileSync(join(repo, "w.txt"), "x\n");
		await emit(fake.pi, "tool_call", { toolName: "write", input: {} }, ctx);

		await emit(fake.pi, "before_agent_start", { type: "before_agent_start", prompt: "second" }, ctx);
		await emit(fake.pi, "tool_call", { toolName: "edit", input: {} }, ctx);
		expect((await refs(repo)).length).toBe(2);
	});

	test("does not snapshot read-only calls", async () => {
		const repo = await makeRepo("pi-rw-ext-read-");
		cleanups.push(repo);
		const fake = setup();
		const ctx = makeCtx(fake, { cwd: repo, branch: branchWithUser() });
		await emit(fake.pi, "session_start", { reason: "startup" }, ctx);
		await emit(fake.pi, "before_agent_start", { type: "before_agent_start", prompt: "read only" }, ctx);

		await emit(fake.pi, "tool_call", { toolName: "read", input: {} }, ctx);
		expect((await refs(repo)).length).toBe(0);
	});

	test("records the prompt summary and conversation anchor at schema v3", async () => {
		const repo = await makeRepo("pi-rw-ext-label-");
		cleanups.push(repo);
		const fake = setup();
		const ctx = makeCtx(fake, { cwd: repo, branch: branchWithUser("entry-9"), sessionId: "session-9" });
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
		expect(meta.v).toBe(3);
		expect(meta.sessionId).toBe("session-9");
		expect(meta.entryId).toBe("entry-9");
	});

	test("autoSnapshots false disables automatic snapshots", async () => {
		const repo = await makeRepo("pi-rw-ext-off-");
		cleanups.push(repo);
		mkdirSync(join(repo, ".pi"), { recursive: true });
		writeFileSync(join(repo, ".pi", "rewind.json"), JSON.stringify({ autoSnapshots: false }));
		const fake = setup();
		const ctx = makeCtx(fake, { cwd: repo, branch: branchWithUser() });
		await emit(fake.pi, "session_start", { reason: "startup" }, ctx);
		await emit(fake.pi, "before_agent_start", { type: "before_agent_start", prompt: "task" }, ctx);

		writeFileSync(join(repo, "w.txt"), "x\n");
		await emit(fake.pi, "tool_call", { toolName: "write", input: {} }, ctx);
		expect((await refs(repo)).length).toBe(0);
	});

	test("a snapshot failure warns and never blocks the tool call", async () => {
		const repo = mkdtempSync(join(tmpdir(), "pi-rw-nocommit-"));
		cleanups.push(repo);
		await execP("git", ["init", "-q"], { cwd: repo });
		const fake = setup();
		const ctx = makeCtx(fake, { cwd: repo, branch: branchWithUser() });
		await emit(fake.pi, "session_start", { reason: "startup" }, ctx);
		await emit(fake.pi, "before_agent_start", { type: "before_agent_start", prompt: "task" }, ctx);

		// Must resolve, not reject, and must notify once.
		await emit(fake.pi, "tool_call", { toolName: "write", input: {} }, ctx);
		expect(ctx.notices.some((notice: { kind?: string }) => notice.kind === "warning")).toBe(true);
	});

	test("registers the /rewind command and no others", () => {
		const fake = setup();
		expect(fake.commands.has("rewind")).toBe(true);
		expect(fake.commands.has("checkpoint")).toBe(false);
	});
});
