/**
 * End-to-end seed test: load the real todo and plan-mode extensions through the
 * Pi SDK, enter plan mode, approve a plan, and confirm the steps land in the
 * todo list through the actual `ctx.executeTool` path (not a fake).
 *
 * Only the UI is faked: the tool registry, the nested-call plumbing, and both
 * extensions' state are real.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgentSession, DefaultResourceLoader, SessionManager } from "@earendil-works/pi-coding-agent";

const repo = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const cwd = mkdtempSync(join(tmpdir(), "pi-plan-seed-repo-"));
const agentDir = mkdtempSync(join(tmpdir(), "pi-plan-seed-agent-"));

afterAll(() => {
	rmSync(cwd, { recursive: true, force: true });
	rmSync(agentDir, { recursive: true, force: true });
});

const PLAN = ["Plan:", "1. Read the parser", "2. Add a tokenizer", "3. Update tests"].join("\n");

const SEEDED = [
	{ content: "Read the parser", status: "pending" },
	{ content: "Add a tokenizer", status: "pending" },
	{ content: "Update tests", status: "pending" },
];

async function boot() {
	const loader = new DefaultResourceLoader({
		cwd,
		agentDir,
		additionalExtensionPaths: [
			join(repo, "extensions", "todo", "index.ts"),
			join(repo, "extensions", "plan-mode", "index.ts"),
		],
	});
	await loader.reload();
	const errors = loader.getExtensions().errors;
	if (errors.length > 0) throw new Error(`extension load errors: ${JSON.stringify(errors)}`);

	const { session } = await createAgentSession({
		resourceLoader: loader,
		sessionManager: SessionManager.inMemory(cwd),
	});

	// Pi attributes a nested `ctx.executeTool()` call to the assistant message
	// that issued its parent call. In a real run that is the model's message;
	// here we drive tools directly, so seed one.
	(session as unknown as { agent: { state: { messages: unknown[] } } }).agent.state.messages.push({
		role: "assistant",
		content: [{ type: "text", text: "Here is the plan." }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "stub",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	});

	const runner = session.extensionRunner;

	// Real tool context (real executeTool), with only the UI/hasUI overridden.
	const base = runner.createToolContext("seed-e2e", undefined);
	const ui = {
		theme: { fg: (_color: string, text: string) => text },
		notify() {},
		setStatus() {},
		confirm: async () => true,
		select: async () => "Approve and execute",
		editor: async () => undefined,
	};
	const ctx = new Proxy(base, {
		get(target, prop, receiver) {
			if (prop === "hasUI") return true;
			if (prop === "mode") return "tui";
			if (prop === "ui") return ui;
			return Reflect.get(target, prop, receiver);
		},
	});

	const call = (name: string, params: unknown): Promise<any> =>
		runner.getToolDefinition(name)!.execute("seed-e2e", params as never, undefined, undefined, ctx);

	return { session, call };
}

describe("plan-mode → todo seeding (real runtime)", () => {
	test("approving a plan records its steps in the todo list", async () => {
		const { session, call } = await boot();
		try {
			const entered = await call("enter_plan_mode", {});
			expect(entered.details.entered).toBe(true);
			expect(session.getActiveToolNames()).not.toContain("write");
			expect(session.getActiveToolNames()).toContain("exit_plan_mode");

			const exited = await call("exit_plan_mode", { plan: PLAN });
			expect(exited.details.approved).toBe(true);
			expect(exited.details.seeded).toBe(3);
			expect(session.getActiveToolNames()).toContain("write");
			expect(session.getActiveToolNames()).not.toContain("exit_plan_mode");

			// Read the seeded list back through the real todo tool: an invalid
			// write returns the current list in its error details.
			const readback = await call("todo", { todos: [{ content: " ", status: "pending" }] });
			expect(readback.isError).toBe(true);
			expect(readback.details.todos).toEqual(SEEDED);
		} finally {
			session.dispose();
		}
	});
});
