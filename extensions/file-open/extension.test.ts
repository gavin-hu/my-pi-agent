import { beforeEach, describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import fileOpen from "./index.ts";
import { buildCommand, normalizeTarget, openTarget, resolveTarget, type LauncherChild } from "./open.ts";
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

/** A child double whose `error` and `exit` events the test emits synchronously. */
function fakeChild() {
	const emitter = new EventEmitter();
	const spawn = (): LauncherChild => emitter;
	return { emitter, spawn };
}

beforeEach(() => {
	// The preload restores PI_WORKTREE_ROOT after each test.
	useEnv({ PI_WORKTREE_ROOT: undefined });
});

describe("target resolution", () => {
	test("unwraps an @ mention, surrounding quotes, and whitespace", () => {
		expect(normalizeTarget("  @src/app.ts  ")).toBe("src/app.ts");
		expect(normalizeTarget('@"my file.txt"')).toBe("my file.txt");
		expect(normalizeTarget("'dir name'")).toBe("dir name");
	});

	test("strips control characters before they reach the handler", () => {
		expect(normalizeTarget("a\u001b[31mb")).toBe("a [31mb");
	});

	test("defaults an empty target to the working directory", () => {
		expect(resolveTarget(import.meta.dir, "   ")).toBe(import.meta.dir);
	});

	test("resolves relative targets and keeps absolute ones", () => {
		expect(resolveTarget(import.meta.dir, "open.ts")).toBe(join(import.meta.dir, "open.ts"));
		const absolute = join(import.meta.dir, "schema.ts");
		expect(resolveTarget("/tmp", absolute)).toBe(absolute);
	});

	test("raises a readable error for a missing target", () => {
		expect(() => resolveTarget(import.meta.dir, "nope-missing")).toThrow(/does not exist/);
	});
});

describe("native command", () => {
	test("builds the open and reveal command for every platform", () => {
		const cases: Array<[Parameters<typeof buildCommand>[0], string, NodeJS.Platform, ReturnType<typeof buildCommand>]> =
			[
				["open", "/tmp/x", "darwin", { command: "open", args: ["/tmp/x"], exitMeansFailure: true }],
				["reveal", "/tmp/x", "darwin", { command: "open", args: ["-R", "/tmp/x"], exitMeansFailure: true }],
				["open", "C:\\x", "win32", { command: "explorer", args: ["C:\\x"], exitMeansFailure: false }],
				["reveal", "C:\\x", "win32", { command: "explorer", args: ["/select,C:\\x"], exitMeansFailure: false }],
				["open", "/tmp/dir/x", "linux", { command: "xdg-open", args: ["/tmp/dir/x"], exitMeansFailure: true }],
				["reveal", "/tmp/dir/x", "linux", { command: "xdg-open", args: ["/tmp/dir"], exitMeansFailure: true }],
			];
		for (const [mode, target, platform, expected] of cases) {
			expect(buildCommand(mode, target, platform)).toEqual(expected);
		}
	});
});

describe("openTarget", () => {
	test("runs the platform command through the injected launcher", () => {
		const calls: Array<[string, string[]]> = [];
		openTarget("open", "/tmp/x", {
			platform: "linux",
			spawn: (command, args) => {
				calls.push([command, args]);
				return undefined;
			},
		});
		expect(calls).toEqual([["xdg-open", ["/tmp/x"]]]);
	});

	test("reports a non-zero exit, a signal, and the first failure only", () => {
		const cases: Array<[string, NodeJS.Platform, (child: EventEmitter) => void, string]> = [
			["non-zero exit", "darwin", (child) => child.emit("exit", 1, null), "the OS handler exited with status 1"],
			["signal", "linux", (child) => child.emit("exit", null, "SIGTERM"), "the OS handler was stopped by SIGTERM"],
		];
		for (const [name, platform, emit, message] of cases) {
			const { emitter, spawn } = fakeChild();
			const errors: Error[] = [];
			openTarget("open", "/tmp/x", { platform, spawn, onError: (error) => errors.push(error) });
			emit(emitter);
			expect(
				errors.map((error) => error.message),
				name,
			).toEqual([message]);
		}
	});

	test("ignores a successful exit and explorer's non-zero status", () => {
		for (const platform of ["darwin", "win32"] as const) {
			const { emitter, spawn } = fakeChild();
			const errors: Error[] = [];
			openTarget("open", platform === "win32" ? "C:\\x" : "/tmp/x", {
				platform,
				spawn,
				onError: (error) => errors.push(error),
			});
			emitter.emit("exit", platform === "win32" ? 1 : 0, null);
			expect(errors, platform).toEqual([]);
		}
	});

	test("reports exactly one failure for one launch", () => {
		const { emitter, spawn } = fakeChild();
		const errors: Error[] = [];
		openTarget("open", "/tmp/x", { platform: "darwin", spawn, onError: (error) => errors.push(error) });
		emitter.emit("error", new Error("no handler"));
		emitter.emit("exit", 1, null);
		expect(errors.map((error) => error.message)).toEqual(["no handler"]);
	});

	test("reports a launcher that throws instead of throwing", () => {
		const errors: Error[] = [];
		openTarget("reveal", "/tmp/x", {
			platform: "darwin",
			spawn: () => {
				throw new Error("no handler");
			},
			onError: (error) => errors.push(error),
		});
		expect(errors.map((error) => error.message)).toEqual(["no handler"]);
	});
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
});

describe("open_path", () => {
	test("opens the resolved target and returns structured details", async () => {
		const { pi, tools } = createFakePi();
		const { calls, open } = recordingLauncher();
		fileOpen(pi, { open });
		const { ctx } = fakeCtx({ cwd: CWD });

		const result = await tools.get(TOOL_NAME).execute("t1", { path: "." }, undefined, undefined, ctx);

		expect(calls).toEqual([{ mode: "open", target: CWD }]);
		expect(result.details).toEqual({ target: CWD, reveal: false });
		expect(result.structuredContent).toEqual({ target: CWD, reveal: false });
	});

	test("reveals the resolved target when asked", async () => {
		const { pi, tools } = createFakePi();
		const { calls, open } = recordingLauncher();
		fileOpen(pi, { open });
		const { ctx } = fakeCtx({ cwd: CWD });

		await tools.get(TOOL_NAME).execute("t1", { path: "open.ts", reveal: true }, undefined, undefined, ctx);

		expect(calls).toEqual([{ mode: "reveal", target: join(CWD, "open.ts") }]);
	});

	test("rejects a missing path", async () => {
		const { pi, tools } = createFakePi();
		fileOpen(pi, { open: () => {} });
		const { ctx } = fakeCtx({ cwd: CWD });

		await expect(
			tools.get(TOOL_NAME).execute("t1", { path: "nope-missing" }, undefined, undefined, ctx),
		).rejects.toThrow(/does not exist/);
	});

	test("reports a launcher failure instead of failing the call", async () => {
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
});

describe("/open", () => {
	test("opens the working directory", async () => {
		const { pi, commands } = createFakePi();
		const { calls, open } = recordingLauncher();
		fileOpen(pi, { open });
		const { ctx, notices } = fakeCtx({ cwd: CWD });

		await commands.get("open").handler("", ctx);

		expect(calls).toEqual([{ mode: "open", target: CWD }]);
		expect(notices.at(-1)).toEqual({ message: `Opening ${CWD}`, kind: "info" });
	});

	test("reveals with the -r flag", async () => {
		const { pi, commands } = createFakePi();
		const { calls, open } = recordingLauncher();
		fileOpen(pi, { open });
		const { ctx, notices } = fakeCtx({ cwd: CWD });

		await commands.get("open").handler("-r open.ts", ctx);

		expect(calls).toEqual([{ mode: "reveal", target: join(CWD, "open.ts") }]);
		expect(notices.at(-1)?.message).toContain("Revealing");
	});

	test("reports a missing path", async () => {
		const { pi, commands } = createFakePi();
		fileOpen(pi, { open: () => {} });
		const { ctx, notices } = fakeCtx({ cwd: CWD });

		await commands.get("open").handler("nope-missing", ctx);

		expect(notices.at(-1)?.kind).toBe("error");
		expect(notices.at(-1)?.message).toContain("does not exist");
	});
});
