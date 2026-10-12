import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ENV_DISABLED_EXTENSIONS } from "../../lib/env.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { emit, emitFirst, makeFakePi } from "../../test/helpers/fakes.ts";
import { tempDir, withAgentDir, withEnv } from "../../test/helpers/env.ts";
import prompt from "./index.ts";

const model = { id: "test-model" };

/** A model-registry double that returns `text` and records the user messages. */
function registryReturning(text: string | undefined): { calls: string[]; registry: unknown } {
	const calls: string[] = [];
	return {
		calls,
		registry: {
			complete: async (_model: unknown, context: { messages: Array<{ content: Array<{ text: string }> }> }) => {
				calls.push(context.messages[0].content[0].text);
				if (text === undefined) return { stopReason: "aborted", content: [] };
				return { stopReason: "stop", content: [{ type: "text", text }] };
			},
		},
	};
}

const input = (text: string, overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
	type: "input",
	text,
	source: "interactive",
	...overrides,
});

const applyReply = (value: unknown): string => JSON.stringify(value);

/** A context with UI and a model registry, in RPC mode so no loader is needed. */
function refineCtx(
	registry: unknown,
	options: { cwd?: string; select?: string; confirm?: boolean; branch?: unknown[] } = {},
) {
	return fakeCtx({
		mode: "rpc",
		hasUI: true,
		cwd: options.cwd,
		branch: options.branch ?? [],
		select: options.select,
		confirm: options.confirm ?? true,
		extra: { model, modelRegistry: registry },
	});
}

describe("prompt extension", () => {
	test("registers nothing when disabled through PI_DISABLED_EXTENSIONS", async () => {
		await withEnv({ [ENV_DISABLED_EXTENSIONS]: "prompt" }, () => {
			const { pi, commands, handlers } = makeFakePi();
			prompt(pi);
			expect(commands.size).toBe(0);
			expect(handlers.size).toBe(0);
		});
	});

	test("registers the /prompt command and an input handler", () => {
		const { pi, commands, handlers } = makeFakePi();
		prompt(pi);
		expect(commands.has("prompt")).toBe(true);
		expect(handlers.has("input")).toBe(true);
		expect(handlers.has("session_start")).toBe(true);
		expect(handlers.has("session_shutdown")).toBe(true);
	});

	test("passes a prompt through when the clarifier says it is clear", async () => {
		const { pi } = makeFakePi();
		prompt(pi);
		const { calls, registry } = registryReturning(applyReply({ clear: true, goal: "Run the tests", questions: [] }));
		const { ctx } = refineCtx(registry);

		const result = await emitFirst(pi, "input", input("please run the full test suite"), ctx);
		expect(result).toEqual({ action: "continue" });
		expect(calls).toHaveLength(1);
	});

	test("asks, confirms, and transforms when the request is ambiguous", async () => {
		const { pi } = makeFakePi();
		prompt(pi);
		const reply = applyReply({
			clear: false,
			goal: "Add a config parser",
			questions: [
				{
					header: "Scope",
					question: "Which files?",
					options: [{ label: "config.ts" }, { label: "all of them" }],
				},
			],
		});
		const { registry } = registryReturning(reply);
		const { ctx, selects, notices } = refineCtx(registry, { select: "config.ts" });

		const result = await emitFirst(pi, "input", input("please add a parser for the config"), ctx);
		expect(result.action).toBe("transform");
		expect(result.text).toContain("please add a parser for the config");
		expect(result.text).toContain("Clarified goal: Add a config parser");
		expect(result.text).toContain("Answer: config.ts");
		expect(selects[0][0]).toBe("config.ts");
		expect(notices).toHaveLength(0);
	});

	test("keeps the original prompt when the goal is declined", async () => {
		const { pi } = makeFakePi();
		prompt(pi);
		const reply = applyReply({
			clear: false,
			goal: "Add a config parser",
			questions: [{ header: "Scope", question: "Which files?", options: [{ label: "a" }, { label: "b" }] }],
		});
		const { registry } = registryReturning(reply);
		const { ctx } = refineCtx(registry, { select: "a", confirm: false });

		const result = await emitFirst(pi, "input", input("please add a parser for the config"), ctx);
		expect(result).toEqual({ action: "continue" });
	});

	test("keeps the original prompt when a dialog is cancelled", async () => {
		const { pi } = makeFakePi();
		prompt(pi);
		const reply = applyReply({
			clear: false,
			questions: [{ header: "Scope", question: "Which files?", options: [{ label: "a" }, { label: "b" }] }],
		});
		const { registry } = registryReturning(reply);
		const { ctx } = refineCtx(registry, { select: undefined });

		const result = await emitFirst(pi, "input", input("please add a parser for the config"), ctx);
		expect(result).toEqual({ action: "continue" });
	});

	test("skips the model call when there is no dialog UI", async () => {
		const { pi } = makeFakePi();
		prompt(pi);
		const { calls, registry } = registryReturning(undefined);
		const { ctx } = fakeCtx({ mode: "print", hasUI: false, extra: { model, modelRegistry: registry } });

		const result = await emitFirst(pi, "input", input("please add a parser for the config"), ctx);
		expect(result).toEqual({ action: "continue" });
		expect(calls).toHaveLength(0);
	});

	test("skips short prompts, slash commands, and extension input", async () => {
		const { pi } = makeFakePi();
		prompt(pi);
		const { calls, registry } = registryReturning(undefined);
		const { ctx } = refineCtx(registry);

		expect(await emitFirst(pi, "input", input("yes"), ctx)).toEqual({ action: "continue" });
		expect(await emitFirst(pi, "input", input("/compact now please"), ctx)).toEqual({ action: "continue" });
		expect(await emitFirst(pi, "input", input("please add a parser", { source: "extension" }), ctx)).toEqual({
			action: "continue",
		});
		expect(await emitFirst(pi, "input", input("please add a parser", { streamingBehavior: "steer" }), ctx)).toEqual({
			action: "continue",
		});
		expect(calls).toHaveLength(0);
	});

	test("honors a disabled config file loaded at session start", async () => {
		await withAgentDir(async () => {
			const repo = tempDir("prompt-repo-");
			mkdirSync(join(repo, ".pi"), { recursive: true });
			writeFileSync(join(repo, ".pi", "prompt.json"), JSON.stringify({ enabled: false }));

			const { pi } = makeFakePi();
			prompt(pi);
			const { calls, registry } = registryReturning(undefined);
			const { ctx } = refineCtx(registry, { cwd: repo });

			await emit(pi, "session_start", { reason: "startup" }, ctx);
			const result = await emitFirst(pi, "input", input("please add a parser for the config"), ctx);
			expect(result).toEqual({ action: "continue" });
			expect(calls).toHaveLength(0);
		}, "prompt-global-");
	});

	test("honors /prompt refine off for the session", async () => {
		const { pi, commands } = makeFakePi();
		prompt(pi);
		const { calls, registry } = registryReturning(undefined);
		const { ctx } = refineCtx(registry);

		await emit(pi, "session_start", { reason: "startup" }, ctx);
		const command = commands.get("prompt");
		if (!command) throw new Error("missing /prompt command");
		await command.handler("refine off", ctx);

		const result = await emitFirst(pi, "input", input("please add a parser for the config"), ctx);
		expect(result).toEqual({ action: "continue" });
		expect(calls).toHaveLength(0);
	});
});
