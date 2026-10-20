import { afterAll, describe, expect, test } from "bun:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { useEnv, withAgentDir } from "../../test/helpers/env.ts";
import { makeClock } from "../../test/helpers/clock.ts";
import { CheckError, createCheckRuntime } from "./runtime.ts";
import type { CheckConfig } from "./config.ts";
import type { RunOutcome } from "./runner.ts";

const env = useEnv({ PI_WORKTREE_ROOT: undefined });
afterAll(env.restore);

const CONFIG: CheckConfig = { command: "fake-check", timeoutMs: 0, maxLogBytes: 1024 };

/** A minimal context: the runtime only reads cwd. */
function ctx(cwd = "/tmp/project"): ExtensionContext {
	return { cwd } as unknown as ExtensionContext;
}

/** One runner outcome. */
function outcome(overrides: Partial<RunOutcome> = {}): RunOutcome {
	return {
		exitCode: 0,
		signal: null,
		timedOut: false,
		cancelled: false,
		output: "",
		truncated: false,
		durationMs: 1,
		...overrides,
	};
}

describe("createCheckRuntime", () => {
	test("runs the configured command and exposes live lines", async () => {
		const clock = makeClock(1000);
		const runtime = createCheckRuntime({
			config: CONFIG,
			now: clock.now,
			runner: async (options) => {
				options.onOutput?.("first\nsecond\n");
				clock.advance(12);
				return outcome({ output: "first\nsecond\n" });
			},
		});

		const active = runtime.start("test", ctx());
		const result = await active.promise;

		expect(result).toMatchObject({
			target: "test",
			status: "passed",
			commands: ["fake-check"],
			exitCode: 0,
			durationMs: 12,
		});
		expect(active.lines()).toEqual(["$ fake-check", "first", "second", ""]);
	});

	test("parses a failing command and keeps its tail", async () => {
		const runtime = createCheckRuntime({
			config: CONFIG,
			runner: async (options) => {
				const output = "src/a.ts:2:3: error: nope\nmore output\n";
				options.onOutput?.(output);
				return outcome({ exitCode: 1, output });
			},
		});

		const result = await runtime.run("test", ctx());

		expect(result.status).toBe("failed");
		expect(result.failures[0]).toMatchObject({ path: "src/a.ts", line: 2, column: 3, command: "fake-check" });
		expect(result.tail).toContain("src/a.ts:2:3");
	});

	test("expands all into the detected targets in order", async () => {
		await withAgentDir(async () => {
			const { mkdtempSync, writeFileSync } = await import("node:fs");
			const { join } = await import("node:path");
			const { tmpdir } = await import("node:os");
			const dir = mkdtempSync(join(tmpdir(), "pi-check-runtime-"));
			writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { test: "true", lint: "true" } }));
			const seen: string[] = [];
			const runtime = createCheckRuntime({
				runner: async (options) => {
					seen.push(options.command);
					return outcome();
				},
			});

			const result = await runtime.run("all", ctx(dir));

			expect(result.status).toBe("passed");
			expect(seen).toEqual(["npm run test", "npm run lint"]);
			expect(result.commands).toEqual(["npm run test", "npm run lint"]);
			await import("node:fs").then(({ rmSync }) => rmSync(dir, { recursive: true, force: true }));
		});
	});

	test("returns an error result when nothing is detected", async () => {
		await withAgentDir(async () => {
			const runtime = createCheckRuntime({ runner: async () => outcome() });
			const result = await runtime.run("all", ctx());

			expect(result.status).toBe("error");
			expect(result.error).toContain("check.command");
		});
	});

	test("refuses a second run and releases the first on completion", async () => {
		let release: ((value: RunOutcome) => void) | undefined;
		const runtime = createCheckRuntime({
			config: CONFIG,
			runner: () => new Promise<RunOutcome>((resolve) => (release = resolve)),
		});

		const active = runtime.start("test", ctx());
		expect(runtime.isRunning()).toBe(true);
		expect(() => runtime.start("test", ctx())).toThrow(CheckError);

		release?.(outcome());
		await active.promise;
		expect(runtime.isRunning()).toBe(false);
		expect(() => runtime.start("test", ctx())).not.toThrow();
	});

	test("reports timeout and spawn error outcomes", async () => {
		const timedOut = createCheckRuntime({ config: CONFIG, runner: async () => outcome({ timedOut: true }) });
		expect((await timedOut.run("test", ctx())).status).toBe("timeout");

		const spawn = createCheckRuntime({ config: CONFIG, runner: async () => outcome({ error: "ENOENT" }) });
		const failed = await spawn.run("test", ctx());
		expect(failed.status).toBe("error");
		expect(failed.error).toBe("ENOENT");
	});

	test("shutdown cancels the active run", async () => {
		let aborted = false;
		const runtime = createCheckRuntime({
			config: CONFIG,
			runner: (options) =>
				new Promise<RunOutcome>((resolve) => {
					options.signal?.addEventListener(
						"abort",
						() => {
							aborted = true;
							resolve(outcome({ cancelled: true }));
						},
						{ once: true },
					);
				}),
		});

		const active = runtime.start("test", ctx());
		runtime.shutdown();
		const result = await active.promise;

		expect(aborted).toBe(true);
		expect(result.status).toBe("cancelled");
		expect(runtime.isRunning()).toBe(false);
	});
});
