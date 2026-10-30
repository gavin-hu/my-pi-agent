/**
 * The check capability's pure contract: detection, command planning, the one-shot
 * process runner, the run runtime, and the guarded source excerpt.
 *
 * Everything here runs over injected seams or a real temp directory; no screen,
 * tool, or session is involved.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeClock } from "../../test/helpers/clock.ts";
import { bareCtx } from "../../test/helpers/context.ts";
import { scratchDir, useEnv } from "../../test/helpers/env.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { JobChild as FakeChild, settle } from "../../test/helpers/process.ts";
import type { CheckConfig } from "./config.ts";
import { DETECTORS, detectCommands, packageManager, planCommands } from "./detect.ts";
import { BoundedLog, checkEnv, createRunner, type RunOutcome } from "./runner.ts";
import { CheckError, createCheckRuntime } from "./runtime.ts";
import { MAX_SOURCE_BYTES, readSourceExcerpt } from "./source.ts";
import type { CheckResult, DetectedCommands, Failure } from "./types.ts";

const env = useEnv({ PI_WORKTREE_ROOT: undefined });
const temps = makeTempTracker();

afterAll(() => {
	env.restore();
	temps.flush();
});

/** One project file. */
function file(dir: string, name: string, content = ""): void {
	writeFileSync(join(dir, name), content);
}

interface Family {
	name: string;
	files: Record<string, string>;
	expected: DetectedCommands;
}

const FAMILIES: readonly Family[] = [
	{
		name: "package.json and its lockfile",
		files: {
			"bun.lock": "",
			"package.json": JSON.stringify({
				scripts: { test: "bun test", lint: "biome check", typecheck: "tsc", check: "bun run check" },
			}),
		},
		expected: {
			test: { command: "bun run test", label: "bun run test" },
			lint: { command: "bun run lint", label: "bun run lint" },
			typecheck: { command: "bun run typecheck", label: "bun run typecheck" },
			all: { command: "bun run check", label: "bun run check" },
		},
	},
	{
		name: "Cargo.toml",
		files: { "Cargo.toml": '[package]\nname = "x"\n' },
		expected: {
			test: { command: "cargo test", label: "cargo test" },
			lint: { command: "cargo clippy -- -D warnings", label: "cargo clippy -- -D warnings" },
			typecheck: { command: "cargo check", label: "cargo check" },
		},
	},
	{
		name: "go.mod",
		files: { "go.mod": "module example.com/x\n" },
		expected: {
			test: { command: "go test ./...", label: "go test ./..." },
			lint: { command: "go vet ./...", label: "go vet ./..." },
			typecheck: { command: "go build ./...", label: "go build ./..." },
		},
	},
	{
		name: "a pytest configuration",
		files: { "pyproject.toml": "[tool.pytest.ini_options]\n[tool.ruff]\n[tool.mypy]\n" },
		expected: {
			test: { command: "pytest", label: "pytest" },
			lint: { command: "ruff check .", label: "ruff check ." },
			typecheck: { command: "mypy .", label: "mypy ." },
		},
	},
	{
		name: "a justfile",
		files: { justfile: "test:\n  cargo test\nlint:\n  cargo clippy\n" },
		expected: {
			test: { command: "just test", label: "just test" },
			lint: { command: "just lint", label: "just lint" },
		},
	},
	{
		name: "a Makefile",
		files: { Makefile: ".PHONY: test\ncheck:\n\ttrue\ntest:\n\ttrue\n" },
		expected: {
			test: { command: "make test", label: "make test" },
			all: { command: "make check", label: "make check" },
		},
	},
];

describe("detectCommands", () => {
	for (const family of FAMILIES) {
		test(`reads ${family.name}`, () => {
			const dir = scratchDir(temps, "pi-check-detect-");
			for (const [name, content] of Object.entries(family.files)) file(dir, name, content);

			expect(detectCommands(dir)).toEqual(family.expected);
		});
	}

	test("stops at the first family that declares a command", () => {
		const dir = scratchDir(temps, "pi-check-priority-");
		file(dir, "Makefile", "test:\n\ttrue\n");
		file(dir, "package.json", JSON.stringify({ scripts: { test: "node --test" } }));
		file(dir, "package-lock.json", "{}");

		expect(detectCommands(dir)?.test?.command).toBe("npm run test");
	});

	test("returns undefined without a manifest", () => {
		expect(detectCommands(scratchDir(temps, "pi-check-empty-"))).toBeUndefined();
	});

	test("keeps the detector registry generic and ordered", () => {
		expect(DETECTORS.map((detector) => detector.name)).toEqual([
			"package.json",
			"Cargo.toml",
			"go.mod",
			"python",
			"justfile",
			"Makefile",
		]);
	});
});

describe("packageManager", () => {
	const MANAGERS: ReadonlyArray<{ lockfile: string; manager: ReturnType<typeof packageManager> }> = [
		{ lockfile: "bun.lock", manager: "bun" },
		{ lockfile: "bun.lockb", manager: "bun" },
		{ lockfile: "pnpm-lock.yaml", manager: "pnpm" },
		{ lockfile: "yarn.lock", manager: "yarn" },
	];

	for (const { lockfile, manager } of MANAGERS) {
		test(`reads ${lockfile} as ${manager}`, () => {
			const dir = scratchDir(temps, "pi-check-pm-");
			file(dir, lockfile);

			expect(packageManager(dir)).toBe(manager);
		});
	}

	test("defaults to npm without a recognized lockfile", () => {
		const dir = scratchDir(temps, "pi-check-npm-");
		file(dir, "package.json", JSON.stringify({ scripts: { test: "node --test" } }));

		expect(detectCommands(dir)?.test?.command).toBe("npm run test");
		expect(packageManager(dir)).toBe("npm");
	});
});

describe("planCommands", () => {
	test("uses an override for every target", () => {
		const dir = scratchDir(temps, "pi-check-plan-override-");

		expect(planCommands(dir, "test", "  make verify  ")).toEqual({
			ok: true,
			commands: [{ command: "make verify", label: "make verify" }],
		});
	});

	test("prefers a declared all-command over expanding the targets", () => {
		const dir = scratchDir(temps, "pi-check-plan-all-");
		file(
			dir,
			"package.json",
			JSON.stringify({ scripts: { test: "node --test", lint: "eslint .", check: "npm run test" } }),
		);

		expect(planCommands(dir, "all")).toEqual({
			ok: true,
			commands: [{ command: "npm run check", label: "npm run check" }],
		});
	});

	test("expands all into the detected targets in order", () => {
		const dir = scratchDir(temps, "pi-check-plan-expand-");
		file(dir, "package.json", JSON.stringify({ scripts: { test: "node --test", lint: "eslint ." } }));

		expect(planCommands(dir, "all")).toEqual({
			ok: true,
			commands: [
				{ command: "npm run test", label: "npm run test" },
				{ command: "npm run lint", label: "npm run lint" },
			],
		});
	});

	test("reports a missing target or a missing manifest", () => {
		const dir = scratchDir(temps, "pi-check-missing-");
		file(dir, "package.json", JSON.stringify({ scripts: { test: "node --test" } }));

		expect(planCommands(dir, "lint")).toMatchObject({ ok: false });
		expect(planCommands(scratchDir(temps, "pi-check-nowhere-"), "all")).toMatchObject({ ok: false });
	});
});

describe("BoundedLog", () => {
	test("keeps the tail and marks truncation", () => {
		const log = new BoundedLog(10);
		log.append("0123456789");
		expect(log.wasTruncated).toBe(false);

		log.append("abcdef");
		expect(log.text()).toBe("6789abcdef");
		expect(log.wasTruncated).toBe(true);
	});
});

/** The pid every fake check child reports. */
const CHECK_PID = 4242;

/** A runner with one fake child and a clock. */
function harness() {
	const children: FakeChild[] = [];
	const killed: Array<{ pid: number; signal: string; force: boolean }> = [];
	const clock = makeClock(1000);
	const runner = createRunner({
		spawn: () => {
			const child = new FakeChild();
			child.pid = CHECK_PID;
			children.push(child);
			return child;
		},
		killTree: (pid, signal, force = false) => killed.push({ pid, signal, force }),
		now: clock.now,
		killGraceMs: 5,
	});
	return { runner, children, killed, clock };
}

const base = { cwd: "/tmp", command: "npm run test", timeoutMs: 0, maxLogBytes: 1024 };

describe("createRunner", () => {
	test("streams stdout and stderr and reports the exit code", async () => {
		const { runner, children, clock } = harness();
		const chunks: string[] = [];
		const promise = runner({ ...base, onOutput: (chunk) => chunks.push(chunk) });
		const child = children[0]!;
		child.write("out ");
		child.emitStderr("err");
		clock.advance(12);
		child.close(0);

		const outcome = await promise;
		expect(chunks).toEqual(["out ", "err"]);
		expect(outcome).toMatchObject({
			exitCode: 0,
			signal: null,
			timedOut: false,
			cancelled: false,
			output: "out err",
			truncated: false,
			durationMs: 12,
		});
	});

	test("keeps only the bounded tail", async () => {
		const { runner, children } = harness();
		const promise = runner({ ...base, maxLogBytes: 8 });
		children[0]!.write("0123456789abcdef");
		children[0]!.close(1);

		const outcome = await promise;
		expect(outcome.output).toBe("89abcdef");
		expect(outcome.truncated).toBe(true);
		expect(outcome.exitCode).toBe(1);
	});

	test("kills the tree on timeout and escalates to SIGKILL", async () => {
		const { runner, children, killed } = harness();
		const promise = runner({ ...base, timeoutMs: 5 });
		await settle(10);
		expect(killed[0]).toEqual({ pid: CHECK_PID, signal: "SIGTERM", force: false });

		await settle(10);
		expect(killed.at(-1)).toEqual({ pid: CHECK_PID, signal: "SIGKILL", force: true });
		children[0]!.close(null, "SIGTERM");

		const outcome = await promise;
		expect(outcome.timedOut).toBe(true);
		expect(outcome.exitCode).toBeNull();
		expect(outcome.signal).toBe("SIGTERM");
	});

	test("kills the tree when the caller aborts", async () => {
		const { runner, children, killed } = harness();
		const controller = new AbortController();
		const promise = runner({ ...base, signal: controller.signal });
		controller.abort();
		expect(killed[0]).toEqual({ pid: CHECK_PID, signal: "SIGTERM", force: false });
		children[0]!.close(null, "SIGTERM");

		const outcome = await promise;
		expect(outcome.cancelled).toBe(true);
		expect(outcome.timedOut).toBe(false);
	});

	test("settles a spawn error with its message", async () => {
		const { runner, children } = harness();
		const promise = runner({ ...base });
		children[0]!.fail("ENOENT");
		children[0]!.close(null);

		const outcome = await promise;
		expect(outcome.error).toBe("ENOENT");
		expect(outcome.exitCode).toBeNull();
	});

	test("does not start when the signal is already aborted", async () => {
		const { runner, children } = harness();
		const controller = new AbortController();
		controller.abort();

		const outcome = await runner({ ...base, signal: controller.signal });
		expect(outcome.cancelled).toBe(true);
		expect(children).toHaveLength(0);
	});
});

describe("checkEnv", () => {
	test("adds the non-interactive defaults without dropping the base env", () => {
		const env = checkEnv({ HOME: "/home/u", CI: "wrong" });

		expect(env.HOME).toBe("/home/u");
		expect(env.CI).toBe("1");
		expect(env.NO_COLOR).toBe("1");
		expect(env.FORCE_COLOR).toBe("0");
		expect(env.TERM).toBe("dumb");
		expect(env.GIT_PAGER).toBe("cat");
		expect(env.PAGER).toBe("cat");
	});
});

const CONFIG: CheckConfig = { command: "fake-check", timeoutMs: 0, maxLogBytes: 1024 };

/** A minimal context: the runtime only reads cwd. */
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

		const active = runtime.start("test", bareCtx("/tmp/project"));
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

		const result = await runtime.run("test", bareCtx("/tmp/project"));

		expect(result.status).toBe("failed");
		expect(result.failures[0]).toMatchObject({ path: "src/a.ts", line: 2, column: 3, command: "fake-check" });
		expect(result.tail).toContain("src/a.ts:2:3");
	});

	test("expands all into the detected targets in order", async () => {
		const dir = scratchDir(temps, "pi-check-runtime-");
		file(dir, "package.json", JSON.stringify({ scripts: { test: "true", lint: "true" } }));
		const seen: string[] = [];
		const runtime = createCheckRuntime({
			config: { command: "", timeoutMs: 0, maxLogBytes: 1024 },
			runner: async (options) => {
				seen.push(options.command);
				return outcome();
			},
		});

		const result = await runtime.run("all", bareCtx(dir));

		expect(result.status).toBe("passed");
		expect(seen).toEqual(["npm run test", "npm run lint"]);
		expect(result.commands).toEqual(["npm run test", "npm run lint"]);
	});

	test("returns an error result when nothing is detected", async () => {
		const runtime = createCheckRuntime({
			config: { command: "", timeoutMs: 0, maxLogBytes: 1024 },
			runner: async () => outcome(),
		});
		const result = await runtime.run("all", bareCtx(scratchDir(temps, "pi-check-nothing-")));

		expect(result.status).toBe("error");
		expect(result.error).toContain("check.command");
	});

	test("refuses a second run and releases the first on completion", async () => {
		let release: ((value: RunOutcome) => void) | undefined;
		const runtime = createCheckRuntime({
			config: CONFIG,
			runner: () => new Promise<RunOutcome>((resolve) => (release = resolve)),
		});

		const active = runtime.start("test", bareCtx("/tmp/project"));
		expect(runtime.isRunning()).toBe(true);
		expect(() => runtime.start("test", bareCtx("/tmp/project"))).toThrow(CheckError);

		release?.(outcome());
		await active.promise;
		expect(runtime.isRunning()).toBe(false);
		expect(() => runtime.start("test", bareCtx("/tmp/project"))).not.toThrow();
	});

	const OUTCOME_STATUS: ReadonlyArray<{
		name: string;
		partial: Partial<RunOutcome>;
		status: CheckResult["status"];
	}> = [
		{ name: "a timeout", partial: { timedOut: true }, status: "timeout" },
		{ name: "a spawn error", partial: { error: "ENOENT" }, status: "error" },
	];

	for (const { name, partial, status } of OUTCOME_STATUS) {
		test(`reports ${name} as ${status}`, async () => {
			const runtime = createCheckRuntime({ config: CONFIG, runner: async () => outcome(partial) });
			const result = await runtime.run("test", bareCtx("/tmp/project"));

			expect(result.status).toBe(status);
			if (partial.error) expect(result.error).toBe(partial.error);
		});
	}

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

		const active = runtime.start("test", bareCtx("/tmp/project"));
		runtime.shutdown();
		const result = await active.promise;

		expect(aborted).toBe(true);
		expect(result.status).toBe("cancelled");
		expect(runtime.isRunning()).toBe(false);
	});
});

/** A temp project with a source file. */
function sourceProject(lines = 20): { root: string; path: string } {
	const root = scratchDir(temps, "pi-check-source-");
	mkdirSync(join(root, "src"), { recursive: true });
	const path = join(root, "src", "a.ts");
	writeFileSync(path, Array.from({ length: lines }, (_, index) => `line ${index + 1}`).join("\n"));
	return { root, path };
}

/** A failure at `path:line`. */
function failure(path: string | undefined, line?: number): Failure {
	return { path, line, message: "nope", command: "check" };
}

describe("readSourceExcerpt", () => {
	test("reads five lines either side and marks the target line", () => {
		const { root } = sourceProject();
		const result = readSourceExcerpt(root, failure("src/a.ts", 10));

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.excerpt).toMatchObject({ startLine: 5, endLine: 15, targetLine: 10 });
		expect(result.excerpt.lines[0]).toBe("line 5");
		expect(result.excerpt.lines.at(-1)).toBe("line 15");
		expect(result.excerpt.lines).toHaveLength(11);
	});

	test("clamps at the first and last line", () => {
		const { root } = sourceProject();
		const first = readSourceExcerpt(root, failure("src/a.ts", 1));
		const last = readSourceExcerpt(root, failure("src/a.ts", 20));

		expect(first.ok && first.excerpt).toMatchObject({ startLine: 1, endLine: 6, targetLine: 1 });
		expect(last.ok && last.excerpt).toMatchObject({ startLine: 15, endLine: 20, targetLine: 20 });
	});

	test("accepts an absolute path inside the project", () => {
		const { root, path } = sourceProject();
		expect(readSourceExcerpt(root, failure(path, 2)).ok).toBe(true);
	});

	const REFUSALS: ReadonlyArray<{
		name: string;
		path: string;
		line: number;
		reason: string;
		prepare?: (root: string) => void;
	}> = [
		{ name: "a path outside the project", path: "../outside.ts", line: 1, reason: "outside the project" },
		{ name: "a missing file", path: "src/missing.ts", line: 1, reason: "file is missing" },
		{ name: "a directory", path: "src", line: 1, reason: "not a regular file" },
		{
			name: "a binary file",
			path: "src/bin.ts",
			line: 1,
			reason: "binary file",
			prepare: (root) => writeFileSync(join(root, "src", "bin.ts"), "a\u0000b"),
		},
		{
			name: "an oversized file",
			path: "src/big.ts",
			line: 1,
			reason: "file is too large",
			prepare: (root) => writeFileSync(join(root, "src", "big.ts"), "x".repeat(MAX_SOURCE_BYTES + 1)),
		},
		{ name: "a line past the end", path: "src/a.ts", line: 99, reason: "line 99 is outside the file (20 lines)" },
	];

	for (const refusal of REFUSALS) {
		test(`refuses ${refusal.name}`, () => {
			const { root } = sourceProject();
			refusal.prepare?.(root);

			expect(readSourceExcerpt(root, failure(refusal.path, refusal.line))).toEqual({
				ok: false,
				reason: refusal.reason,
			});
		});
	}

	test.skipIf(process.platform === "win32")("refuses a symlink that leaves the project", () => {
		// Creating a symlink needs the real host, so this keeps the platform gate.
		const { root } = sourceProject();
		const outside = scratchDir(temps, "pi-check-source-outside-");
		const target = join(outside, "secret.ts");
		writeFileSync(target, "secret\n");
		symlinkSync(target, join(root, "src", "link.ts"));

		expect(readSourceExcerpt(root, failure("src/link.ts", 1))).toEqual({ ok: false, reason: "outside the project" });
	});

	test("requires a path and a line", () => {
		const { root } = sourceProject();

		expect(readSourceExcerpt(root, failure(undefined, 1))).toEqual({ ok: false, reason: "no file location" });
		expect(readSourceExcerpt(root, failure("src/a.ts"))).toEqual({ ok: false, reason: "no line number" });
	});
});
