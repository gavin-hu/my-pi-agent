import { beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import fileOpen from "./index.ts";
import type { OpenTargetOptions } from "./open.ts";
import { TOOL_NAME } from "./schema.ts";
import { ENV_DISABLED_EXTENSIONS } from "../../lib/env.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { useEnv, withEnv } from "../../test/helpers/env.ts";
import { createFakePi } from "../../test/helpers/fakes.ts";

const CWD = import.meta.dir;

/** A launcher double that records the mode and target it was handed. */
function recordingLauncher() {
	const calls: Array<{ mode: string; target: string }> = [];
	const open = (mode: "open" | "reveal", target: string, _options?: OpenTargetOptions): void => {
		calls.push({ mode, target });
	};
	return { calls, open };
}

beforeEach(() => {
	// The preload restores PI_WORKTREE_ROOT after each test.
	useEnv({ PI_WORKTREE_ROOT: undefined });
});

describe("file-open extension", () => {
	test("registers nothing when disabled through PI_DISABLED_EXTENSIONS", async () => {
		await withEnv({ [ENV_DISABLED_EXTENSIONS]: "file-open" }, () => {
			const { pi, tools, commands } = createFakePi();
			fileOpen(pi);
			expect(tools.size).toBe(0);
			expect(commands.size).toBe(0);
		});
	});

	test("registers open_path as a codemode tool and the /open command", () => {
		const { pi, tools, commands } = createFakePi();
		fileOpen(pi);

		const tool = tools.get(TOOL_NAME);
		expect(tool).toBeDefined();
		expect(tool.exposure).toBe("codemode");
		expect(tool.outputSchema).toBeDefined();
		expect(tool.annotations).toEqual({ readOnlyHint: false, destructiveHint: false, openWorldHint: true });
		expect(tool.promptSnippet?.trim().length).toBeGreaterThan(0);
		expect(commands.has("open")).toBe(true);
	});

	test("completes the /open -r flag", () => {
		const { pi, commands } = createFakePi();
		fileOpen(pi);
		const complete = (prefix: string): string[] =>
			(commands.get("open").getArgumentCompletions(prefix) ?? []).map((item: { label: string }) => item.label);
		expect(complete("-")).toEqual(["reveal in file manager"]);
		expect(complete("src")).toEqual([]);
	});

	test("open_path opens the resolved target and returns structured details", async () => {
		const { pi, tools } = createFakePi();
		const { calls, open } = recordingLauncher();
		fileOpen(pi, { open });
		const { ctx } = fakeCtx({ cwd: CWD });

		const result = await tools.get(TOOL_NAME).execute("t1", { path: "." }, undefined, undefined, ctx);

		expect(calls).toEqual([{ mode: "open", target: CWD }]);
		expect(result.details).toEqual({ target: CWD, reveal: false });
		expect(result.structuredContent).toEqual({ target: CWD, reveal: false });
	});

	test("open_path reveals the resolved target when asked", async () => {
		const { pi, tools } = createFakePi();
		const { calls, open } = recordingLauncher();
		fileOpen(pi, { open });
		const { ctx } = fakeCtx({ cwd: CWD });

		await tools.get(TOOL_NAME).execute("t1", { path: "open.ts", reveal: true }, undefined, undefined, ctx);

		expect(calls).toEqual([{ mode: "reveal", target: join(CWD, "open.ts") }]);
	});

	test("open_path rejects a missing path", async () => {
		const { pi, tools } = createFakePi();
		fileOpen(pi, { open: () => {} });
		const { ctx } = fakeCtx({ cwd: CWD });

		await expect(
			tools.get(TOOL_NAME).execute("t1", { path: "nope-missing" }, undefined, undefined, ctx),
		).rejects.toThrow(/does not exist/);
	});

	test("a launcher failure is reported instead of failing the call", async () => {
		const { pi, tools } = createFakePi();
		const open = (_mode: "open" | "reveal", _target: string, options: OpenTargetOptions = {}): void => {
			options.onError?.(new Error("no handler"));
		};
		fileOpen(pi, { open });
		const { ctx, notices } = fakeCtx({ cwd: CWD });

		const result = await tools.get(TOOL_NAME).execute("t1", { path: "." }, undefined, undefined, ctx);

		expect(result.details.target).toBe(CWD);
		expect(notices.at(-1)?.message).toContain("Could not open");
	});

	test("the /open command opens the working directory", async () => {
		const { pi, commands } = createFakePi();
		const { calls, open } = recordingLauncher();
		fileOpen(pi, { open });
		const { ctx, notices } = fakeCtx({ cwd: CWD });

		await commands.get("open").handler("", ctx);

		expect(calls).toEqual([{ mode: "open", target: CWD }]);
		expect(notices.at(-1)).toEqual({ message: `Opened ${CWD}`, kind: "info" });
	});

	test("the /open command reveals with the -r flag", async () => {
		const { pi, commands } = createFakePi();
		const { calls, open } = recordingLauncher();
		fileOpen(pi, { open });
		const { ctx, notices } = fakeCtx({ cwd: CWD });

		await commands.get("open").handler("-r open.ts", ctx);

		expect(calls).toEqual([{ mode: "reveal", target: join(CWD, "open.ts") }]);
		expect(notices.at(-1)?.message).toContain("Revealed");
	});

	test("the /open command reports a missing path", async () => {
		const { pi, commands } = createFakePi();
		fileOpen(pi, { open: () => {} });
		const { ctx, notices } = fakeCtx({ cwd: CWD });

		await commands.get("open").handler("nope-missing", ctx);

		expect(notices.at(-1)?.kind).toBe("error");
		expect(notices.at(-1)?.message).toContain("does not exist");
	});
});
