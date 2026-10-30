/**
 * The check capability's Pi integration: registration, disablement, lifecycle,
 * and the real-process path through the runtime, the tool, and `/check`.
 *
 * The real scripts are small Node programs, so the process path is exercised
 * without depending on Bun, a test framework, or the project under test.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bareCtx, fakeCtx } from "../../test/helpers/context.ts";
import { createFakePi, emit } from "../../test/helpers/fakes.ts";
import { tempDir, useEnv, withAgentDir, withEnv } from "../../test/helpers/env.ts";
import checkExtension, { registerCheck } from "./index.ts";
import { createCheckRuntime } from "./runtime.ts";
import { TOOL_NAME } from "./tools.ts";

const env = useEnv({ PI_WORKTREE_ROOT: undefined });
const directories: string[] = [];

afterAll(() => {
	env.restore();
	for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

describe("registration", () => {
	test("registers the tool, the command, and one shutdown hook", () => {
		const fake = createFakePi();
		registerCheck(fake.pi);

		expect(fake.tools.has(TOOL_NAME)).toBe(true);
		expect(fake.commands.has("check")).toBe(true);
		expect(fake.handlers.get("session_shutdown")).toHaveLength(1);
		expect(fake.handlers.has("session_start")).toBe(false);
	});

	test("loads by default and obeys PI_DISABLED_EXTENSIONS", async () => {
		await withEnv({ PI_DISABLED_EXTENSIONS: undefined }, () => {
			const enabled = createFakePi();
			checkExtension(enabled.pi);
			expect(enabled.commands.has("check")).toBe(true);
		});

		await withEnv({ PI_DISABLED_EXTENSIONS: "check" }, () => {
			const disabled = createFakePi();
			checkExtension(disabled.pi);
			expect(disabled.commands.has("check")).toBe(false);
			expect(disabled.tools.has(TOOL_NAME)).toBe(false);
		});
	});
});

describe("lifecycle", () => {
	test("session_shutdown cancels the live run", async () => {
		await withAgentDir(async () => {
			const dir = project("for (;;) {}\n", { timeoutMs: 5_000 });
			const fake = createFakePi();
			registerCheck(fake.pi);
			const tool = fake.tools.get(TOOL_NAME);
			const ctx = fakeCtx({ cwd: dir, mode: "print", hasUI: false }).ctx;

			const pending = tool.execute("t", { target: "all" }, undefined, undefined, ctx);
			await emit(fake.pi, "session_shutdown", {}, ctx);
			const outcome = await pending;

			expect(outcome.details.status).toBe("cancelled");
			expect(outcome.isError).toBe(false);
		});
	});
});

/** A project with a config override and a Node script. */
function project(script: string, config: Record<string, unknown> = {}): string {
	const dir = tempDir("pi-check-e2e-");
	directories.push(dir);
	writeFileSync(join(dir, "script.js"), script);
	mkdirSync(join(dir, ".pi"), { recursive: true });
	writeFileSync(
		join(dir, ".pi", "bytefly.json"),
		JSON.stringify({ check: { command: "node script.js", timeoutMs: 2_000, ...config } }),
	);
	return dir;
}

/** A context the runtime only reads cwd from. */
describe("check runtime with a real process", () => {
	test("passes a zero-exit command", async () => {
		await withAgentDir(async () => {
			const dir = project("process.exit(0);\n");
			const result = await createCheckRuntime().run("all", bareCtx(dir));

			expect(result).toMatchObject({ status: "passed", exitCode: 0, commands: ["node script.js"] });
		});
	});

	test("parses a generic failure from a real process", async () => {
		await withAgentDir(async () => {
			const dir = project('console.log("src/a.ts:2:3: error: nope"); process.exit(1);\n');
			const result = await createCheckRuntime().run("all", bareCtx(dir));

			expect(result.status).toBe("failed");
			expect(result.failures[0]).toMatchObject({ path: "src/a.ts", line: 2, column: 3, command: "node script.js" });
		});
	});

	test("falls back to the tail when nothing parses", async () => {
		await withAgentDir(async () => {
			const dir = project('console.log("prose only"); process.exit(2);\n');
			const result = await createCheckRuntime().run("all", bareCtx(dir));

			expect(result.status).toBe("failed");
			expect(result.failures[0]?.message).toContain("status 2");
			expect(result.tail).toContain("prose only");
		});
	});

	test("times out and cancels a live process", async () => {
		await withAgentDir(async () => {
			const dir = project("for (;;) {}\n", { timeoutMs: 50 });
			const result = await createCheckRuntime().run("all", bareCtx(dir));
			expect(result.status).toBe("timeout");
		});

		await withAgentDir(async () => {
			const dir = project("for (;;) {}\n", { timeoutMs: 5_000 });
			const runtime = createCheckRuntime();
			const active = runtime.start("all", bareCtx(dir));
			active.cancel();
			const result = await active.promise;
			expect(result.status).toBe("cancelled");
		});
	});
});

describe("check tool and command with a real process", () => {
	test("run_check returns structured failures without a TUI", async () => {
		await withAgentDir(async () => {
			const dir = project('console.log("src/b.ts:4:1: error: broken"); process.exit(1);\n');
			const fake = createFakePi();
			registerCheck(fake.pi);
			const tool = fake.tools.get(TOOL_NAME);
			const ctx = fakeCtx({ cwd: dir, mode: "print", hasUI: false }).ctx;

			const outcome = await tool.execute("t", { target: "all" }, undefined, undefined, ctx);

			expect(outcome.isError).toBe(false);
			expect(outcome.structuredContent?.failures[0]).toMatchObject({ path: "src/b.ts", line: 4 });
		});
	});

	test("/check runs headlessly and reports the failure", async () => {
		await withAgentDir(async () => {
			const dir = project('console.log("src/c.ts:5:1: error: broken"); process.exit(1);\n');
			const fake = createFakePi();
			registerCheck(fake.pi);
			const command = fake.commands.get("check");
			const ctx = fakeCtx({ cwd: dir, mode: "print", hasUI: false }).ctx;

			await command.handler("all", ctx);

			expect(ctx.notices.at(-1)?.message).toContain("src/c.ts:5");
		});
	});
});
