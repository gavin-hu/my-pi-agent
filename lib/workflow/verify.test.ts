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
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createChildSupervisor } from "../child.ts";
import type { SpawnedProcess, SpawnFn } from "../spawn.ts";
import type { Card } from "./card.ts";
import type { Verification } from "./contract.ts";
import {
	defaultVerifyRun,
	MAX_VERIFY_OUTPUT,
	missingSizeGates,
	outputLine,
	SIZE_GATE_FILES,
	SIZE_GATES,
	VERIFY_TIMEOUT_MS,
	verifiedCommand,
	verifySpotCheck,
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
		await defaultVerifyRun(VERIFY_TIMEOUT_MS, supervisor(spawn))("bun test --changed=main", CWD);
		// A contract line is a command, not an argv: only a shell reads `--changed=main` as written.
		expect(seen).toEqual({ command: "bun test --changed=main", shell: true, cwd: CWD });
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

describe("the size gates before the card's line", () => {
	const now = () => 900;
	const VERIFY = "bun run check";

	/**
	 * The card a spot-check reads: `contract.verify` is the only field it uses, so the rest of the
	 * record is stubbed and the cast names that guarantee rather than implying a whole card.
	 */
	const spotCard = (verify: string | undefined): Card =>
		({ id: "853", contract: { goal: "G", acceptance: "A", scopeOut: "S", verify } }) as unknown as Card;

	/** A run that answers by command, recording each call in order. */
	function byCommand(answers: (command: string) => { exit: number; output: string; killed: boolean }) {
		const calls: string[] = [];
		const run = async (command: string) => {
			calls.push(command);
			return answers(command);
		};
		return { calls, run };
	}

	const green = { exit: 0, output: "", killed: false };

	/** The seam the cases below hold open: these repositories keep both files, so the gate runs. */
	const gatesPresent = () => [];

	test("runs the gates first, then the card's line, and records the card's line", async () => {
		const { calls, run } = byCommand(() => green);
		const answer = await verifySpotCheck(spotCard(VERIFY), CWD, run, now, undefined, gatesPresent);
		// The order is the rule: a second process starts only after the first has settled (#804).
		expect(calls).toEqual([SIZE_GATES, VERIFY]);
		expect(answer).toEqual({ verified: { cmd: VERIFY, exit: 0, at: 900, root: CWD, sizeGates: { ran: true } } });
	});

	test("refuses on a red gate, naming the gate and its tail, before the card's line runs", async () => {
		const { calls, run } = byCommand((command) =>
			command === SIZE_GATES ? { exit: 1, output: "suites over the bar\n  big.test.ts: 449", killed: false } : green,
		);
		const answer = await verifySpotCheck(spotCard(VERIFY), CWD, run, now, undefined, gatesPresent);
		expect(calls).toEqual([SIZE_GATES]);
		expect("error" in (answer ?? {})).toBe(true);
		const refused = (answer as { error: string }).error;
		expect(refused).toContain("the repository's size gates are red");
		expect(refused).toContain(SIZE_GATES);
		expect(refused).toContain("exited 1");
		expect(refused).toContain("big.test.ts: 449");
		// The sentence names the gate, never the card's command: the failure is the tree's.
		expect(refused).not.toContain(VERIFY);
	});

	test("a gate that outlives the bound is a refusal, not a pass", async () => {
		const { run } = byCommand(() => ({ exit: -1, output: "", killed: true }));
		const answer = await verifySpotCheck(spotCard(VERIFY), CWD, run, now, undefined, gatesPresent);
		expect((answer as { error: string }).error).toContain("did not finish within 10 minutes");
	});

	test("a gate whose seam throws is a refusal, not a green", async () => {
		const run = async () => {
			throw new Error("spawn /bin/sh ENOENT");
		};
		const answer = await verifySpotCheck(spotCard(VERIFY), CWD, run, now, undefined, gatesPresent);
		expect((answer as { error: string }).error).toContain("spawn /bin/sh ENOENT");
	});

	test("skips the gate a repository does not keep, and records the skip on the sign", async () => {
		const { calls, run } = byCommand(() => green);
		const absent = () => [...SIZE_GATE_FILES];
		const answer = await verifySpotCheck(spotCard(VERIFY), CWD, run, now, undefined, absent);
		// No gate process at all, and the card's own line still runs: a skip is not a refusal.
		expect(calls).toEqual([VERIFY]);
		expect(answer).toEqual({
			verified: {
				cmd: VERIFY,
				exit: 0,
				at: 900,
				root: CWD,
				sizeGates: { skipped: "no test/module-sizes.test.ts or test/suite-sizes.test.ts in this repo" },
			},
		});
	});

	test("names only the gate file that is missing", async () => {
		const { run } = byCommand(() => green);
		const answer = await verifySpotCheck(spotCard(VERIFY), CWD, run, now, undefined, () => [
			"test/suite-sizes.test.ts",
		]);
		const verified = (answer as { verified: Verification }).verified;
		expect(verified.sizeGates).toEqual({ skipped: "no test/suite-sizes.test.ts in this repo" });
	});

	test("reads the files themselves: a directory without them skips, this repository does not", () => {
		const empty = mkdtempSync(join(tmpdir(), "pi-size-gates-"));
		try {
			expect(missingSizeGates(empty)).toEqual([...SIZE_GATE_FILES]);
		} finally {
			rmSync(empty, { recursive: true, force: true });
		}
		// The repository that owns the gates answers the same question with nothing missing.
		expect(missingSizeGates(process.cwd())).toEqual([]);
	});

	test("runs nothing for a card whose contract names no command", async () => {
		const { calls, run } = byCommand(() => green);
		expect(await verifySpotCheck(undefined, CWD, run, now)).toBeUndefined();
		expect(await verifySpotCheck(spotCard(undefined), CWD, run, now)).toBeUndefined();
		expect(calls).toEqual([]);
	});
});

describe("a tree with no work of its own", () => {
	const now = () => 900;
	const VERIFY = "bun run check";
	const green = { exit: 0, output: "", killed: false };
	const card = {
		id: "941",
		contract: { goal: "G", acceptance: "A", scopeOut: "S", verify: VERIFY },
	} as unknown as Card;
	const tree = (carries: boolean) => async () => ({ sha: "1d3a8ce3", branch: "main", carries, base: "main" });

	test("refuses before anything runs, and names each door out of it", async () => {
		const attempted: string[] = [];
		const refused = await verifySpotCheck(
			card,
			CWD,
			async (command) => {
				attempted.push(command);
				return green;
			},
			now,
			tree(false),
			() => [],
		);
		// Neither the gate nor the card's line starts: a sign that will be refused costs no process.
		expect(attempted).toEqual([]);
		const sentence = (refused as { error: string }).error;
		for (const part of [CWD, "no commit past main", "`root`", "`done`", "`override`"]) {
			expect(sentence, part).toContain(part);
		}
	});

	test("signs a tree that carries work, and one whose reader cannot place it", async () => {
		for (const answer of [tree(true), async () => ({ carries: undefined as boolean | undefined })]) {
			const attempted: string[] = [];
			const signed = await verifySpotCheck(
				card,
				CWD,
				async (command) => {
					attempted.push(command);
					return green;
				},
				now,
				answer,
				() => [],
			);
			// Both shapes run what they always ran; only a tree git placed on the base is refused.
			expect(attempted).toEqual([SIZE_GATES, VERIFY]);
			expect("verified" in (signed ?? {})).toBe(true);
		}
	});
});
