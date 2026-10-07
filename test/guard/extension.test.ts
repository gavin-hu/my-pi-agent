import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import guard from "../../extensions/guard/index.ts";
import { emit, fakeCtx, makeFakePi, toolCall } from "./helpers.ts";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
let agentDir: string;

beforeEach(() => {
	agentDir = mkdtempSync(join(tmpdir(), "guard-agent-"));
	process.env.PI_CODING_AGENT_DIR = agentDir;
});

afterEach(() => {
	if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
});

describe("guard extension", () => {
	test("registers the /guard command", () => {
		const { pi, commands } = makeFakePi();
		guard(pi);
		expect(commands.has("guard")).toBe(true);
	});

	test("blocks a write to a protected path", async () => {
		const { pi } = makeFakePi();
		guard(pi);
		const { ctx } = fakeCtx();

		const [result] = await emit(pi, "tool_call", toolCall("write", { path: ".env", content: "X=1" }), ctx);

		expect(result?.block).toBe(true);
		expect(String(result?.reason)).toContain("protected pattern");
	});

	test("blocks a dangerous command", async () => {
		const { pi } = makeFakePi();
		guard(pi);
		const { ctx } = fakeCtx();

		const [result] = await emit(pi, "tool_call", toolCall("bash", { command: "rm -rf /" }), ctx);

		expect(result?.block).toBe(true);
	});

	test("allows an ordinary tool call", async () => {
		const { pi } = makeFakePi();
		guard(pi);
		const { ctx } = fakeCtx();

		const [result] = await emit(pi, "tool_call", toolCall("read", { path: "src/index.ts" }), ctx);

		expect(result).toBeUndefined();
	});

	test("confirms a destructive command and remembers it for the session", async () => {
		const { pi } = makeFakePi();
		guard(pi);
		const { ctx } = fakeCtx();
		let confirmCalls = 0;
		ctx.ui.confirm = async () => {
			confirmCalls++;
			return true;
		};

		const event = toolCall("bash", { command: "rm -rf dist" });
		expect((await emit(pi, "tool_call", event, ctx))[0]).toBeUndefined();
		expect((await emit(pi, "tool_call", event, ctx))[0]).toBeUndefined();
		expect(confirmCalls).toBe(1);
	});

	test("blocks when the confirmation is denied", async () => {
		const { pi } = makeFakePi();
		guard(pi);
		const { ctx, notifications } = fakeCtx({ confirm: false });

		const [result] = await emit(pi, "tool_call", toolCall("bash", { command: "rm -rf dist" }), ctx);

		expect(result?.block).toBe(true);
		expect(notifications.some((message) => message.includes("blocked"))).toBe(true);
	});

	test("blocks a confirmation with no UI by default", async () => {
		const { pi } = makeFakePi();
		guard(pi);
		const { ctx } = fakeCtx({ hasUI: false, mode: "print" });

		const [result] = await emit(pi, "tool_call", toolCall("bash", { command: "rm -rf dist" }), ctx);

		expect(result?.block).toBe(true);
		expect(String(result?.reason)).toContain("no UI");
	});

	test("proceeds with no UI when nonInteractive is allow", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "guard-project-"));
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		writeFileSync(join(cwd, ".pi", "guard.json"), JSON.stringify({ nonInteractive: "allow" }));

		const { pi } = makeFakePi();
		guard(pi);
		const { ctx } = fakeCtx({ cwd, hasUI: false, mode: "print" });

		const [result] = await emit(pi, "tool_call", toolCall("bash", { command: "rm -rf dist" }), ctx);

		expect(result).toBeUndefined();
	});

	test("confirms a tool annotated destructive", async () => {
		const { pi } = makeFakePi([{ name: "mcp__db__drop", annotations: { destructiveHint: true } }]);
		guard(pi);
		const { ctx } = fakeCtx({ confirm: false });

		const [result] = await emit(pi, "tool_call", toolCall("mcp__db__drop", { table: "users" }), ctx);

		expect(result?.block).toBe(true);
	});

	test("/guard off bypasses the gate until the next session", async () => {
		const { pi, commands } = makeFakePi();
		guard(pi);
		const { ctx } = fakeCtx();
		const command = commands.get("guard");

		await command.handler("off", ctx);
		const [off] = await emit(pi, "tool_call", toolCall("write", { path: ".env", content: "X=1" }), ctx);
		expect(off).toBeUndefined();

		await emit(pi, "session_start", { reason: "startup" }, ctx);
		const [reset] = await emit(pi, "tool_call", toolCall("write", { path: ".env", content: "X=1" }), ctx);
		expect(reset?.block).toBe(true);
	});

	test("/guard reports status", async () => {
		const { pi, commands } = makeFakePi();
		guard(pi);
		const { ctx, notifications } = fakeCtx();

		await commands.get("guard").handler("", ctx);

		expect(notifications.join("\n")).toContain("Guard:");
	});
});
