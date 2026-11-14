/**
 * The acceptance command a contract names, and the one run a spot-check records.
 *
 * A contract's `verify` line is a promise the board can check: the sign's own call runs it and
 * keeps `{ cmd, exit, at, root, branch, checkout, sha }` on the sign (`lib/board/contract.ts`).
 * Nothing here decides anything — the board never executes a command on its own, and the store
 * never reads this module — so what it owns is the run itself: one shell, a bound, and the tail of
 * what it said, beside the tree it was started in.
 *
 * The bound is the only thing keeping a sign finite. A command that outlives it is killed with
 * its tree (the pieces `job` and `watch` use through `lib/child.ts`), and the answer says
 * `killed`, which no door records as a result.
 *
 * The tail is for the refusal, never for the sign: a record keeps a verdict, and an output
 * buffer in a card file would grow with whatever the command decided to print.
 */

import { dirname, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type ChildSink, type ChildSlot, createChildSupervisor } from "../child.ts";
import { messageOf } from "../errors.ts";
import { sanitizeLine } from "../format.ts";
import { createExecRunner, currentBranch, gitCommonDir, headSha } from "../git/index.ts";
import type { Card } from "./card.ts";
import type { Verification } from "./contract.ts";
import { failedSpotCheck, killedSpotCheck, type Lead, reviewGate } from "./lead.ts";
import type { Actor } from "./rules.ts";

/** How long one run may take before it is killed with its tree. */
export const VERIFY_TIMEOUT_MS = 10 * 60_000;

/** Characters of output kept for a refusal: enough for a failing assertion, not the whole log. */
export const MAX_VERIFY_OUTPUT = 400;

/**
 * What one run answered.
 *
 * `exit` is the command's own code, or `-1` when there was none to have — a spawn that failed,
 * a command killed at the bound. `output` is the clipped tail of stdout and stderr merged, so a
 * refusal can name what broke; it is never recorded on a card.
 */
export interface VerifyOutcome {
	exit: number;
	output: string;
	/** True when the bound stopped it, which is a failure whatever the exit says. */
	killed: boolean;
}

/** One run of `command` in `cwd`. The seam every suite drives instead of a real process. */
export type VerifyRun = (command: string, cwd: string) => Promise<VerifyOutcome>;

/**
 * The tree a run was started in, as git answers for it: the commit, the branch, and which of the
 * repository's trees it is.
 *
 * A sha names a commit and a commit backs every worktree of a branch, so a reader who has only the
 * commit cannot say *where* the evidence was taken. `checkout` is the one word a path does not say
 * at a glance — work is made in a worktree and lands in the checkout — and it is absent when git
 * cannot name the tree rather than guessed, so a record never claims a tree it did not run in.
 */
export interface TreeFacts {
	/** The commit the tree was on. */
	sha?: string;
	/** The branch it had checked out, which a detached HEAD does not have. */
	branch?: string;
	/** `true` when the tree is the repository's checkout rather than one of its worktrees. */
	checkout?: true;
}

/**
 * How a door reads the facts of the tree it is about to run in: one git question per sign, so the
 * gate's tree is git's answer and not the caller's guess.
 */
export type TreeReader = (cwd: string) => Promise<TreeFacts>;

/** The one answer a door records: the evidence, or the run that stopped the spot-check. */
export type VerifyAnswer = { verified: Verification } | { failure: VerifyOutcome };

/**
 * The production run: a shell in `cwd`, its output merged and clipped, killed at the bound.
 *
 * `shell: true` because a contract line is a command a person wrote — `bun run check --slow` —
 * and not an argv the board could split without guessing at quoting. The supervisor is
 * `lib/child.ts`'s, so the SIGTERM → SIGKILL escalation is the one `job` and `watch` already
 * use rather than a second copy of it here.
 */
export function defaultVerifyRun(
	timeoutMs: number = VERIFY_TIMEOUT_MS,
	supervisor = createChildSupervisor(),
): VerifyRun {
	return async (command, cwd) => {
		const slot: ChildSlot = {};
		let tail = "";
		let timedOut = false;
		return new Promise<VerifyOutcome>((resolve) => {
			let timer: ReturnType<typeof setTimeout> | undefined;
			const settle = (outcome: VerifyOutcome): void => {
				if (timer !== undefined) clearTimeout(timer);
				supervisor.clearTimer(slot);
				resolve(outcome);
			};
			const sink: ChildSink = {
				onData(chunk) {
					tail = keepTail(tail + chunk.toString("utf8"));
				},
				onSettled(outcome) {
					if (outcome.kind === "failed") return settle({ exit: -1, output: outcome.message, killed: false });
					// A killed run has no exit code: the signal is what ended it, and the bound is ours.
					const exit = outcome.code ?? -1;
					settle({ exit, output: tail, killed: timedOut });
				},
			};
			const failure = supervisor.start(slot, command, { cwd, shell: true }, sink);
			if (failure !== undefined) return settle({ exit: -1, output: failure, killed: false });
			timer = setTimeout(() => {
				timedOut = true;
				supervisor.terminate(slot);
			}, timeoutMs);
			timer.unref?.();
		});
	};
}

/** The last {@link MAX_VERIFY_OUTPUT} characters, so a chatty command cannot grow the buffer. */
function keepTail(text: string): string {
	return text.length <= MAX_VERIFY_OUTPUT ? text : text.slice(text.length - MAX_VERIFY_OUTPUT);
}

/**
 * Run the contract's command and answer with what a sign records, or the run that stopped it.
 *
 * Only a clean exit is a result: a red command is not a failed *call* — it is the check doing
 * its job — so the answer is the outcome itself and the door words the refusal. A run that
 * throws is an outcome with no exit, because a seam that broke must never read as a pass.
 */
export async function verifiedCommand(
	cmd: string,
	cwd: string,
	run: VerifyRun,
	now: () => number,
	tree?: TreeReader,
): Promise<VerifyAnswer> {
	const outcome = await run(cmd, cwd).catch(
		(error: unknown): VerifyOutcome => ({ exit: -1, output: messageOf(error), killed: false }),
	);
	if (outcome.killed || outcome.exit !== 0) return { failure: outcome };
	const facts = await tree?.(cwd).catch(() => undefined);
	// The tree is the run's own: the directory the command was started in, which is what the facts
	// beside it were read from. A reader can then tell a branch's evidence from the checkout's, and
	// a checkout's from the worktree the work was made in.
	return { verified: { cmd, exit: outcome.exit, at: now(), root: cwd, ...facts } };
}

/**
 * The tree a door runs in, through the git runner the rest of the board already uses.
 *
 * One call, three questions: the commit, the branch, and the git directory the tree shares with the
 * rest of the repository — whose parent is the checkout, which is how a worktree is told from the
 * tree everything lands in without naming a branch anybody's project may spell differently.
 */
/**
 * The two path answers a tree comparison reads, so a case can hand in the platform it must ask about.
 *
 * `node:path` is what production gets. A suite passes `win32` because the install running the
 * suite is not Windows, and a comparison that only fails there has to be answerable from here.
 */
export interface TreePaths {
	/** The parent of a path, in the platform's own spelling. */
	dirname(path: string): string;
	/** An absolute path, with the platform's separators and roots. */
	resolve(path: string): string;
}

/**
 * The tree a reader compares `common` and `cwd` with: this platform, unless a case says otherwise.
 */
const PLATFORM_PATHS: TreePaths = { dirname, resolve };

export function treeOf(pi: Pick<ExtensionAPI, "exec">, paths: TreePaths = PLATFORM_PATHS): TreeReader {
	const runGit = createExecRunner(pi);
	return async (cwd) => {
		const [sha, branch, common] = await Promise.all([
			headSha(runGit, cwd).catch(() => undefined),
			currentBranch(runGit, cwd).catch(() => undefined),
			gitCommonDir(runGit, cwd).catch(() => undefined),
		]);
		// Resolved, because the two sides do not arrive in one spelling: git for Windows prints the
		// common directory with forward slashes while a cwd is native, and a POSIX literal under a
		// Windows cwd disagrees the same way. `dirname` alone compares bytes, and never matched there.
		const checkout = common !== undefined && paths.resolve(paths.dirname(common)) === paths.resolve(cwd);
		return {
			...(sha === undefined ? {} : { sha }),
			...(branch === undefined ? {} : { branch }),
			...(checkout ? { checkout: true as const } : {}),
		};
	};
}

/**
 * The evidence one card's spot-check records, read from the card the store holds.
 *
 * Both doors sign — the tool's `review` and the person's `/board review` — and both have to ask
 * the same question of the same field and word a failure the same way, so the read of the
 * contract, the run, and the sentence are one body here rather than two that drift. A card whose
 * contract names no command is `undefined`: nothing ran, and nothing is owed.
 */
export async function verifySpotCheck(
	card: Card | undefined,
	cwd: string,
	run: VerifyRun,
	now: () => number,
	tree?: TreeReader,
): Promise<{ verified: Verification } | { error: string } | undefined> {
	const cmd = card?.contract?.verify;
	if (card === undefined || cmd === undefined) return undefined;
	const answer = await verifiedCommand(cmd, cwd, run, now, tree);
	if ("verified" in answer) return answer;
	const tail = outputLine(answer.failure);
	const sentence = answer.failure.killed
		? killedSpotCheck(card, cmd, VERIFY_TIMEOUT_MS)
		: failedSpotCheck(card, cmd, answer.failure.exit);
	// The tail is what says why, and it rides the sentence as one clip rather than a second line.
	return { error: tail === undefined ? sentence : `${sentence} — ${tail}` };
}

/** What a spot-check is asked with: the card, the gate it must pass, and the tree to run in. */
export interface SpotCheck {
	card: Card;
	/** The session signing, which the gate is asked about. */
	actor: Actor;
	/** The board's lead, which the gate is asked about. */
	lead: Lead;
	/** The close by instruction, when the caller was given one. */
	override?: string;
	/** The tree the command runs in, which is the one the caller is working in. */
	cwd: string;
	run: VerifyRun;
	now: () => number;
	/** How the tree's own facts are read, so the record names the branch and which tree it was. */
	tree?: TreeReader;
}

/**
 * The evidence a sign records, or nothing when no command should run.
 *
 * The gate is asked *before* the process, because a sign that will be refused must not start one
 * — and it answers no refusal of its own: the store asks the same questions under the lock, in
 * the order a caller reads, and its sentence is the one a result carries. An override runs
 * nothing at all: it is the close a gate did not get. A card whose contract names no command is
 * `undefined` from {@link verifySpotCheck}, which is the same answer it gives an override.
 */
export async function spotCheck(
	options: SpotCheck,
): Promise<{ verified: Verification } | { error: string } | undefined> {
	if ("error" in reviewGate(options.card, options.actor, options.lead, options.override)) return undefined;
	if (options.override !== undefined) return undefined;
	return verifySpotCheck(options.card, options.cwd, options.run, options.now, options.tree);
}

/** The clipped output as one line a refusal can carry: merged, collapsed, and sanitized. */
export function outputLine(outcome: VerifyOutcome): string | undefined {
	const text = sanitizeLine(outcome.output).trim();
	return text === "" ? undefined : text;
}
