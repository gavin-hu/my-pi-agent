import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { useEnv, withAgentDir } from "../../test/helpers/env.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { createFakePi } from "../../test/helpers/fakes.ts";
import { createCheckRuntime } from "./runtime.ts";
import { registerCheck } from "./index.ts";
import { TOOL_NAME } from "./tools.ts";

const env = useEnv({ PI_WORKTREE_ROOT: undefined });
const directories: string[] = [];
afterAll(() => {
	env.restore();
	for (const dir of directories) rmSync(dir, { recursive: true, force: true });
});

/** A project with a config override and a Node script. */
function project(script: string, config: Record<string, unknown> = {}): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-check-e2e-"));
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
function ctx(cwd: string): ExtensionContext {
	return { cwd } as unknown as ExtensionContext;
}

describe("check runtime with a real process", () => {
	test("passes a zero-exit command", async () => {
		await withAgentDir(async () => {
			const dir = project("process.exit(0);\n");
			const result = await createCheckRuntime().run("all", ctx(dir));

			expect(result).toMatchObject({ status: "passed", exitCode: 0, commands: ["node script.js"] });
		});
	});

	test("parses a generic failure from a real process", async () => {
		await withAgentDir(async () => {
			const dir = project('console.log("src/a.ts:2:3: error: nope"); process.exit(1);\n');
			const result = await createCheckRuntime().run("all", ctx(dir));

			expect(result.status).toBe("failed");
			expect(result.failures[0]).toMatchObject({ path: "src/a.ts", line: 2, column: 3, command: "node script.js" });
		});
	});

	test("falls back to the tail when nothing parses", async () => {
		await withAgentDir(async () => {
			const dir = project('console.log("prose only"); process.exit(2);\n');
			const result = await createCheckRuntime().run("all", ctx(dir));

			expect(result.status).toBe("failed");
			expect(result.failures[0]?.message).toContain("status 2");
			expect(result.tail).toContain("prose only");
		});
	});

	test("times out and cancels a live process", async () => {
		await withAgentDir(async () => {
			const dir = project("for (;;) {}\n", { timeoutMs: 50 });
			const result = await createCheckRuntime().run("all", ctx(dir));
			expect(result.status).toBe("timeout");
			expect(result.durationMs).toBeGreaterThanOrEqual(0);
		});

		await withAgentDir(async () => {
			const dir = project("for (;;) {}\n", { timeoutMs: 5_000 });
			const runtime = createCheckRuntime();
			const active = runtime.start("all", ctx(dir));
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
			const context = { ...fakeCtx({ cwd: dir, mode: "print", hasUI: false }).ctx, cwd: dir };

			const outcome = await tool.execute("t", { target: "all" }, undefined, undefined, context);

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
