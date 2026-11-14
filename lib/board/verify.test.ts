/**
 * The acceptance command's one run: its bound, its tail, and the record a sign keeps.
 *
 * Nothing here spawns a real command. `defaultVerifyRun` is driven with `lib/spawn.ts`'s seams —
 * a fake child that prints and closes, one that never closes, one whose spawn throws — so the
 * three answers a sign can meet (green, red, killed) are proved without a process, and
 * `verifiedCommand` is driven with a recording run so the record itself is the assertion.
 */

import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { win32 } from "node:path";
import { createChildSupervisor } from "../child.ts";
import type { SpawnFn, SpawnedProcess } from "../spawn.ts";
import {
	defaultVerifyRun,
	MAX_VERIFY_OUTPUT,
	outputLine,
	treeOf,
	VERIFY_TIMEOUT_MS,
	verifiedCommand,
} from "./verify.ts";

/** A child that prints `chunks`, then closes with `code` — or never closes, when `code` is absent. */
function child(
	options: { chunks?: string[]; code?: number | null; signal?: NodeJS.Signals | null } = {},
): SpawnedProcess {
	const emitter = new EventEmitter() as EventEmitter & SpawnedProcess;
	const stdout = new EventEmitter();
	const stderr = new EventEmitter();
	const close = (signal: NodeJS.Signals | null = null) => emitter.emit("close", null, signal);
	Object.assign(emitter, {
		// No pid, so the supervisor signals the child handle itself: the fake has no process tree.
		stdout,
		stderr,
		// A real child ends when it is killed; the fake does too, so a bounded run can settle.
		kill: (signal?: NodeJS.Signals) => {
			queueMicrotask(() => close(signal ?? "SIGTERM"));
			return true;
		},
	});
	// The supervisor attaches its listeners in `start`, so the output lands after that call.
	queueMicrotask(() => {
		for (const chunk of options.chunks ?? []) stdout.emit("data", Buffer.from(chunk));
		if (options.code === undefined && options.signal === undefined) return;
		emitter.emit("close", options.code ?? null, options.signal ?? null);
	});
	return emitter;
}

const CWD = "/repo/billing";

describe("the record a spot-check keeps", () => {
	const now = () => 900;

	test("a clean exit is the evidence, with the tree it ran in and the commit there", async () => {
		const run = async () => ({ exit: 0, output: "all green", killed: false });
		expect(await verifiedCommand("bun run check", CWD, run, now, async () => ({ sha: "1d3a8ce3" }))).toEqual({
			verified: { cmd: "bun run check", exit: 0, at: 900, root: CWD, sha: "1d3a8ce3" },
		});
	});

	test("the tree's facts ride the run: the branch, and which of the repository's trees it was", async () => {
		const run = async () => ({ exit: 0, output: "", killed: false });
		const answer = await verifiedCommand("bun run check", CWD, run, now, async () => ({
			sha: "1d3a8ce3",
			branch: "main",
			checkout: true,
		}));
		expect(answer).toEqual({
			verified: { cmd: "bun run check", exit: 0, at: 900, root: CWD, sha: "1d3a8ce3", branch: "main", checkout: true },
		});
	});

	test("the record names the directory its sha was read from, not a second lookup", async () => {
		// The tree is the run's own: a sign that runs in a worktree and records the checkout's
		// commit is the bug this field answers, so it is the same argument that chose both.
		const asked: string[] = [];
		await verifiedCommand(
			"bun run check",
			"/repo/.pi/worktrees/x",
			async () => ({ exit: 0, output: "", killed: false }),
			now,
			async (cwd) => {
				asked.push(cwd);
				return { sha: "6c1e9a02" };
			},
		);
		expect(asked).toEqual(["/repo/.pi/worktrees/x"]);
	});

	test("a repository that cannot name a commit still records the run", async () => {
		const run = async () => ({ exit: 0, output: "", killed: false });
		const answer = await verifiedCommand("bun run check", CWD, run, now, async () => ({}));
		expect(answer).toEqual({ verified: { cmd: "bun run check", exit: 0, at: 900, root: CWD } });
		// A git call that threw is the same answer as one that said nothing.
		const threw = await verifiedCommand("bun run check", CWD, run, now, async () => {
			throw new Error("not a repository");
		});
		expect(threw).toEqual({ verified: { cmd: "bun run check", exit: 0, at: 900, root: CWD } });
	});

	test("a red command is the outcome itself, never a record", async () => {
		const red = { exit: 1, output: "3 tests failed", killed: false };
		expect(await verifiedCommand("bun run check", CWD, async () => red, now)).toEqual({ failure: red });
	});

	test("a killed run is a failure whatever its exit says", async () => {
		const killed = { exit: 0, output: "", killed: true };
		expect(await verifiedCommand("bun run check", CWD, async () => killed, now)).toEqual({ failure: killed });
	});

	test("a run that threw is an outcome with no exit, so it cannot read as a pass", async () => {
		const answer = await verifiedCommand(
			"bun run check",
			CWD,
			async () => {
				throw new Error("the spawn went away");
			},
			now,
		);
		expect(answer).toEqual({ failure: { exit: -1, output: "the spawn went away", killed: false } });
	});
});

describe("defaultVerifyRun", () => {
	/** The supervisor over a fake spawn, so no process is started. */
	function supervisor(spawn: SpawnFn) {
		return createChildSupervisor({ spawn, killTree: () => {} });
	}

	test("merges the two streams and keeps the tail of what it printed", async () => {
		const spawn: SpawnFn = () => child({ chunks: ["x".repeat(MAX_VERIFY_OUTPUT), "the last line\n"], code: 0 });
		const run = defaultVerifyRun(VERIFY_TIMEOUT_MS, supervisor(spawn));
		const outcome = await run("bun run check", CWD);
		expect(outcome.exit).toBe(0);
		expect(outcome.killed).toBe(false);
		expect(outcome.output).toHaveLength(MAX_VERIFY_OUTPUT);
		expect(outcome.output.endsWith("the last line\n")).toBe(true);
	});

	test("hands the shell the working directory the card's board is in", async () => {
		let seen: { command: string; shell?: boolean; cwd?: string } | undefined;
		const spawn: SpawnFn = (command, options) => {
			seen = { command, shell: options.shell, cwd: options.cwd };
			return child({ code: 0 });
		};
		await defaultVerifyRun(VERIFY_TIMEOUT_MS, supervisor(spawn))("bun run check --slow", CWD);
		// A contract line is a command, not an argv: only a shell reads `--slow` as written.
		expect(seen).toEqual({ command: "bun run check --slow", shell: true, cwd: CWD });
	});

	test("a command that outlives the bound is killed and says so", async () => {
		const spawn: SpawnFn = () => child({ chunks: ["still running"] });
		const run = defaultVerifyRun(10, supervisor(spawn));
		const outcome = await run("bun run check", CWD);
		expect(outcome.killed).toBe(true);
		expect(outcome.exit).toBe(-1);
		expect(outcome.output).toBe("still running");
	});

	test("a spawn that throws is an outcome, not an exception", async () => {
		const spawn: SpawnFn = () => {
			throw new Error("spawn EACCES");
		};
		expect(await defaultVerifyRun(VERIFY_TIMEOUT_MS, supervisor(spawn))("bun run check", CWD)).toEqual({
			exit: -1,
			output: "spawn EACCES",
			killed: false,
		});
	});
});

describe("outputLine", () => {
	test("collapses a command's output into the one line a refusal carries", () => {
		expect(outputLine({ exit: 1, output: "3 tests failed\n\n  see above", killed: false })).toBe(
			"3 tests failed see above",
		);
		expect(outputLine({ exit: 1, output: "   ", killed: false })).toBeUndefined();
	});

	test("drops the control characters a command's output can carry", () => {
		const line = outputLine({ exit: 1, output: "bell\u0007 and \u001b[31mcolour", killed: false }) ?? "";
		expect(line).not.toMatch(/[\u0000-\u001f\u007f]/);
		expect(line).toContain("bell");
	});
});

describe("treeOf", () => {
	/** A `pi` whose git answers are the map: the joined args, then what git says. */
	const piAnswering = (answers: Record<string, { stdout: string; code: number }>) => ({
		exec: async (_command: string, args: string[]) => ({
			...(answers[args.join(" ")] ?? { stdout: "", code: 128 }),
			stderr: "",
			killed: false,
			truncated: false,
		}),
	});

	test("names the checkout, its branch, and the commit when git answers", async () => {
		const pi = piAnswering({
			"rev-parse HEAD": { stdout: "1d3a8ce3\n", code: 0 },
			"rev-parse --abbrev-ref HEAD": { stdout: "main\n", code: 0 },
			"rev-parse --path-format=absolute --git-common-dir": { stdout: `${CWD}/.git\n`, code: 0 },
		});
		expect(await treeOf(pi)(CWD)).toEqual({ sha: "1d3a8ce3", branch: "main", checkout: true });
	});

	test("a forward-slash git path and a backslashed cwd name one tree", async () => {
		// Git for Windows prints `--git-common-dir` with forward slashes while a cwd arrives native, so
		// `dirname` keeps one separator and `resolve` answers the other: the checkout was never named
		// there at all. No Windows machine runs this, so the case hands in `win32`'s own two functions.
		const pi = piAnswering({
			"rev-parse HEAD": { stdout: "1d3a8ce3\n", code: 0 },
			"rev-parse --abbrev-ref HEAD": { stdout: "main\n", code: 0 },
			"rev-parse --path-format=absolute --git-common-dir": { stdout: "D:/a/x/.git\n", code: 0 },
		});
		expect(await treeOf(pi, win32)("D:\\a\\x")).toEqual({ sha: "1d3a8ce3", branch: "main", checkout: true });
	});

	test("a worktree is the same git directory under another root, so it is no checkout", async () => {
		// The whole derivation: every tree of one repository shares the git directory, and only the
		// checkout sits where that directory's parent is the root itself.
		const worktree = `${CWD}/.pi/worktrees/x`;
		const pi = piAnswering({
			"rev-parse HEAD": { stdout: "6c1e9a02\n", code: 0 },
			"rev-parse --abbrev-ref HEAD": { stdout: "worktree-x\n", code: 0 },
			"rev-parse --path-format=absolute --git-common-dir": { stdout: `${CWD}/.git\n`, code: 0 },
		});
		expect(await treeOf(pi)(worktree)).toEqual({ sha: "6c1e9a02", branch: "worktree-x" });
	});

	test("a detached HEAD is a commit with no branch, and a repository git cannot name is neither", async () => {
		const detached = piAnswering({
			"rev-parse HEAD": { stdout: "1d3a8ce3\n", code: 0 },
			"rev-parse --abbrev-ref HEAD": { stdout: "HEAD\n", code: 0 },
		});
		expect(await treeOf(detached)(CWD)).toEqual({ sha: "1d3a8ce3" });
		// Nothing answers: the record keeps the run and claims no tree, rather than guessing one.
		expect(await treeOf(piAnswering({}))(CWD)).toEqual({});
	});
});
