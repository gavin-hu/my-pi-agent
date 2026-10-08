import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import rewind from "../../extensions/rewind/index.ts";
import { createFakePi, emit, type FakePi } from "../helpers/fakes.ts";
import { cleanup, execP, makeCtx, makeRepo } from "./helpers.ts";

const cleanups: string[] = [];
afterAll(() => cleanup(...cleanups));

const TOOLS = [
	{ name: "write", annotations: { readOnlyHint: false, destructiveHint: true } },
];

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

function setup(): FakePi {
	delete process.env.PI_WORKTREE_ROOT;
	const fake = createFakePi({
		allTools: TOOLS,
		exec: (command, args, options) => execP(command, args, options),
	});
	rewind(fake.pi);
	return fake;
}

/** Take one automatic snapshot for the branch's prompt, then dirty the tree. */
async function prime(fake: FakePi, ctx: any): Promise<void> {
	await emit(fake.pi, "session_start", { reason: "startup" }, ctx);
	await emit(fake.pi, "before_agent_start", { type: "before_agent_start", prompt: "do the task" }, ctx);
	await emit(fake.pi, "tool_call", { toolName: "write", input: {} }, ctx);
	writeFileSync(join(ctx.cwd, "after.txt"), "after\n");
}

/** Answer the point picker with the newest point and the scope picker with `scope`. */
function answer(scope: string): (title: string, labels: string[]) => Promise<string> {
	return async (title, labels) => (title.startsWith("Rewind to which prompt") ? labels[0] : scope);
}

describe("/rewind command", () => {
	test("conversation-only moves the session and leaves files alone", async () => {
		const repo = await makeRepo("pi-rw-cmd-talk-");
		cleanups.push(repo);
		const fake = setup();
		const ctx = makeCtx(fake, { cwd: repo, hasUI: true, mode: "rpc", branch: branchWithUser("e1"), sessionId: "s1" });
		await prime(fake, ctx);

		ctx.ui.select = answer("Conversation only");
		await fake.commands.get("rewind").handler("", ctx);

		expect(ctx.navigations).toEqual(["e1"]);
		expect(existsSync(join(repo, "after.txt"))).toBe(true);
	});

	test("code-only restores files and does not navigate", async () => {
		const repo = await makeRepo("pi-rw-cmd-code-");
		cleanups.push(repo);
		const fake = setup();
		const ctx = makeCtx(fake, { cwd: repo, hasUI: true, mode: "rpc", branch: branchWithUser("e1"), sessionId: "s1" });
		await prime(fake, ctx);

		ctx.ui.select = answer("Code only");
		await fake.commands.get("rewind").handler("", ctx);

		expect(ctx.navigations).toEqual([]);
		expect(existsSync(join(repo, "after.txt"))).toBe(false);
	});

	test("both restores files and then navigates", async () => {
		const repo = await makeRepo("pi-rw-cmd-both-");
		cleanups.push(repo);
		const fake = setup();
		const ctx = makeCtx(fake, { cwd: repo, hasUI: true, mode: "rpc", branch: branchWithUser("e1"), sessionId: "s1" });
		await prime(fake, ctx);

		ctx.ui.select = answer("Code and conversation");
		await fake.commands.get("rewind").handler("", ctx);

		expect(ctx.navigations).toEqual(["e1"]);
		expect(existsSync(join(repo, "after.txt"))).toBe(false);
	});

	test("works outside a git repository for conversation only", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-rw-cmd-nogit-"));
		cleanups.push(dir);
		const fake = setup();
		const ctx = makeCtx(fake, { cwd: dir, hasUI: true, mode: "rpc", branch: branchWithUser("e1"), sessionId: "s1" });

		ctx.ui.select = answer("Conversation only");
		await fake.commands.get("rewind").handler("", ctx);

		expect(ctx.navigations).toEqual(["e1"]);
	});

	test("lists prompts headlessly without a picker", async () => {
		const repo = await makeRepo("pi-rw-cmd-headless-");
		cleanups.push(repo);
		const fake = setup();
		const ctx = makeCtx(fake, { cwd: repo, hasUI: false, branch: branchWithUser("e1"), sessionId: "s1" });

		await fake.commands.get("rewind").handler("", ctx);
		expect(ctx.notices.at(-1).message).toContain("1 prompt (newest first)");
	});

	test("reports an empty timeline", async () => {
		const repo = await makeRepo("pi-rw-cmd-empty-");
		cleanups.push(repo);
		const fake = setup();
		const ctx = makeCtx(fake, { cwd: repo, hasUI: true, mode: "rpc", branch: [], sessionId: "s1" });

		await fake.commands.get("rewind").handler("", ctx);
		expect(ctx.notices.at(-1).message).toContain("No prompts to rewind to yet.");
	});

	test("restores the prompt to the editor when the target is already the leaf", async () => {
		const repo = await makeRepo("pi-rw-cmd-leaf-");
		cleanups.push(repo);
		const fake = setup();
		const ctx = makeCtx(fake, {
			cwd: repo,
			hasUI: true,
			mode: "rpc",
			branch: branchWithUser("e1"),
			sessionId: "s1",
			leafId: "e1",
		});
		await prime(fake, ctx);

		ctx.ui.select = answer("Conversation only");
		await fake.commands.get("rewind").handler("", ctx);

		// navigateTree is a no-op at the leaf, so the prompt is set manually.
		expect(ctx.navigations).toEqual(["e1"]);
		expect(ctx.editorSets).toEqual(["do the task"]);
	});
});
