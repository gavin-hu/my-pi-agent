/**
 * The acceptance command a contract names, and the one run a spot-check records.
 *
 * A contract's `verify` line is a promise the board can check: the sign's own call runs it and
 * keeps `{ cmd, exit, at, root, branch, checkout, sha }` on the sign (`lib/workflow/contract.ts`).
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

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type ChildSink, type ChildSlot, createChildSupervisor } from "../child.ts";
import { messageOf } from "../errors.ts";
import { sanitizeLine, shortenPath } from "../format.ts";
import { createExecRunner, currentBranch, defaultBranch, gitCommonDir, headSha, type RunGit } from "../git/index.ts";
import type { Card } from "./card.ts";
import type { Lead, SizeGatesOutcome, Verification } from "./contract.ts";
import { failedSpotCheck, killedSpotCheck, reviewGate } from "./lead.ts";
import type { Actor } from "./rules.ts";

/** How long one run may take before it is killed with its tree. */
export const VERIFY_TIMEOUT_MS = 10 * 60_000;

/**
 * The repository's size gates, run before every card's own line.
 *
 * A `verify` line can only fail what it names, and two cards proved the gap in one night: #849 grew a
 * module to 638 against a 600 bar, #853 a suite to 449 against a 400, and both were signed green
 * before `bun run check` went red. Running the two gates here is what makes a green sign mean the
 * repository's own bars held on that tree, whatever the card remembered to name.
 *
 * **The gates belong to a repository, so their files decide whether they run** (#481): the command is
 * this repository's shape — `bun`, and two suites under `test/` — while a sign happens in whatever
 * tree the reviewer names. A repository without them keeps no size gates, and `bun test` answers a
 * filter that matches nothing with exit 1, which read as "red" refused every sign in every other
 * repository. So the files are looked for first, and their absence is a skip that the sign records
 * rather than a silence (#475: silence is the harder one to trace).
 */
export const SIZE_GATES = "bun test test/module-sizes.test.ts test/suite-sizes.test.ts";

/**
 * The two files that make {@link SIZE_GATES} mean something: both here, the repository keeps them.
 *
 * A path rather than a probe of `bun` or of a script name: the command names these two files, so
 * whether they exist is the same question as whether the command has anything to run.
 */
export const SIZE_GATE_FILES = ["test/module-sizes.test.ts", "test/suite-sizes.test.ts"] as const;

/**
 * Which of the size gates' files a tree lacks: none means the repository keeps them.
 *
 * The seam the suite drives, because the alternative's answer would depend on the checkout the tests
 * happen to run in — a suite that only passes in this repository is the bug being fixed.
 */
export type MissingSizeGates = (cwd: string) => readonly string[];

/** The files absent under `cwd`, read from the filesystem unless a caller says otherwise. */
export function missingSizeGates(cwd: string, exists: (path: string) => boolean = existsSync): string[] {
	return SIZE_GATE_FILES.filter((file) => !exists(join(cwd, file)));
}

/**
 * The skip a sign records, in the one line a reader meets it: the files it looked for, by path.
 *
 * Named rather than counted — `no size gates here` would leave the next reader guessing which two
 * files the gate wanted, and a repository that moved them would look identical to one that has none.
 */
export function noSizeGatesSentence(missing: readonly string[]): string {
	return `no ${missing.join(" or ")} in this repo`;
}

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
	/**
	 * Whether the tree carries a commit the base branch does not already have.
	 *
	 * The spot-check's own question, asked before it runs anything: a tree that is the base runs a
	 * contract's `verify` on the base, where it passes by construction and the sign attests nothing.
	 * Absent when git cannot name the base or cannot place the commit, which refuses nothing.
	 */
	carries?: boolean;
	/** The branch that answer was taken against, so a refusal can name both ends. */
	base?: string;
	/**
	 * The base's tip, when it holds a commit this tree does not — the fact a landing pays for.
	 *
	 * A sign names a tree and the landing merges it into a base that may have moved since, so a review
	 * that cannot say so costs the holder a sync merge, a second `verify` and a second sign. Absent when
	 * the base was already in the tree, and when git could not answer either end.
	 */
	behind?: { base: string; sha: string };
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
 * `shell: true` because a contract line is a command a person wrote — `bun test --changed=main` —
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
	const read = await tree?.(cwd).catch(() => undefined);
	// The record names the tree the run finished in, and nothing else: `carries` and `base` are the
	// gate's question, asked before the process started, so a sign that stored them would describe a
	// moment the run had already moved past.
	const { carries: _carries, base: _base, ...facts } = read ?? {};
	// The tree is the run's own: the directory the command was started in, which is what the facts
	// beside it were read from. A reader can then tell a branch's evidence from the checkout's, and
	// a checkout's from the worktree the work was made in.
	return { verified: { cmd, exit: outcome.exit, at: now(), root: cwd, ...facts } };
}

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

/**
 * The tree a door runs in, through the git runner the rest of the board already uses.
 *
 * One call, three questions: the commit, the branch, and the git directory the tree shares with the
 * rest of the repository — whose parent is the checkout, which is how a worktree is told from the
 * tree everything lands in without naming a branch anybody's project may spell differently.
 */
export function treeOf(pi: Pick<ExtensionAPI, "exec">, paths: TreePaths = PLATFORM_PATHS): TreeReader {
	const runGit = createExecRunner(pi);
	return async (cwd) => {
		const [sha, branch, common, base] = await Promise.all([
			headSha(runGit, cwd).catch(() => undefined),
			currentBranch(runGit, cwd).catch(() => undefined),
			gitCommonDir(runGit, cwd).catch(() => undefined),
			defaultBranch(runGit, cwd, { fallback: true }).catch(() => undefined),
		]);
		// Both ends, or no answer: a tree whose commit git cannot name has nothing to compare, and a
		// base it cannot name is no evidence either — the same rule as a roster that would not read.
		const carries = base === undefined || sha === undefined ? undefined : await carriedPast(runGit, cwd, base);
		const behind = base === undefined ? undefined : await behindBase(runGit, cwd, base);
		// Resolved, because the two sides do not arrive in one spelling: git for Windows prints the
		// common directory with forward slashes while a cwd is native, and a POSIX literal under a
		// Windows cwd disagrees the same way. `dirname` alone compares bytes, and never matched there.
		const checkout = common !== undefined && paths.resolve(paths.dirname(common)) === paths.resolve(cwd);
		return {
			...(sha === undefined ? {} : { sha }),
			...(branch === undefined ? {} : { branch }),
			...(checkout ? { checkout: true as const } : {}),
			...(carries === undefined ? {} : { carries }),
			...(base === undefined ? {} : { base }),
			...(behind === undefined ? {} : { behind }),
		};
	};
}

/**
 * Whether HEAD holds a commit `base` does not already have: git's own `--is-ancestor` answer.
 *
 * Exit 0 is "already in the base", so no work of its own; 1 is a commit past it. Anything else is
 * a read that failed — the module's rule for a question git will not answer is that it refuses
 * nothing, because a tree nobody can place is not evidence of an empty one.
 */
async function carriedPast(runGit: RunGit, cwd: string, base: string): Promise<boolean | undefined> {
	const answer = await runGit(["merge-base", "--is-ancestor", "HEAD", base], { cwd }).catch(() => undefined);
	if (answer === undefined) return undefined;
	if (answer.code === 0) return false;
	return answer.code === 1 ? true : undefined;
}

/**
 * The base's tip, when HEAD does not already contain it: {@link carriedPast}'s reverse question.
 *
 * The ref asked about is the remote's (`origin/<base>`) when the repository has one, because the
 * landing fetches before it merges and a local branch left stale by an unfetched remote would answer
 * about a commit nobody is landing onto. A repository with no remote asks about the local branch, so
 * a working copy without `origin` still gets the fact.
 *
 * `merge-base --is-ancestor <ref> HEAD` exits 0 when the base is already in the tree, 1 when it holds
 * a commit this tree lacks, and anything else is a read that failed — which asserts nothing, the same
 * rule `carriedPast` follows, because a base nobody can place is not evidence of a synced one. The tip
 * is read second and its own failure is a silence too: a branch named beside a sha that would not read
 * is worse than no sentence at all.
 */
async function behindBase(
	runGit: RunGit,
	cwd: string,
	base: string,
): Promise<{ base: string; sha: string } | undefined> {
	const remote = "origin/" + base;
	const found = await runGit(["rev-parse", "--verify", "--quiet", remote], { cwd }).catch(() => undefined);
	const ref = found?.code === 0 ? remote : base;
	const ahead = await runGit(["merge-base", "--is-ancestor", ref, "HEAD"], { cwd }).catch(() => undefined);
	if (ahead === undefined || ahead.code !== 1) return undefined;
	const tip = await runGit(["rev-parse", ref], { cwd }).catch(() => undefined);
	const sha = tip?.code === 0 ? tip.stdout.trim() : "";
	return sha === "" ? undefined : { base: ref, sha };
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
	missing: MissingSizeGates = missingSizeGates,
): Promise<{ verified: Verification } | { error: string } | undefined> {
	const cmd = card?.contract?.verify;
	if (card === undefined || cmd === undefined) return undefined;
	// The tree first, before any process: a tree that carries no commit past the base *is* the base,
	// so the contract's line would pass there by construction and the sign would attest nothing about
	// the work. A tree git cannot place is no evidence of an empty one, so it signs as it always has.
	const asked = await tree?.(cwd).catch(() => undefined);
	if (asked?.carries === false) return { error: noWorkSentence(cwd, asked) };
	// The gates first, and to their own outcome: two runs on one checkout collide over `.pi/cache` and
	// the board store (#804), so the card's line does not start until this one has settled. No tree
	// read for the gate: the facts belong to the run the sign records, and that is the card's line.
	//
	// A repository that keeps no size gates is one this rule has nothing to say about (#481): the skip
	// is read from the files and recorded on the sign, and it is never read from an exit code — a red
	// gate in the repository that owns them must still refuse the sign.
	const absent = missing(cwd);
	const sizeGates: SizeGatesOutcome = absent.length > 0 ? { skipped: noSizeGatesSentence(absent) } : { ran: true };
	if (absent.length === 0) {
		const gates = await verifiedCommand(SIZE_GATES, cwd, run, now);
		if ("failure" in gates) return { error: sizeGatesSentence(gates.failure) };
	}
	const answer = await verifiedCommand(cmd, cwd, run, now, tree);
	if ("verified" in answer) return { verified: { ...answer.verified, sizeGates } };
	const tail = outputLine(answer.failure);
	const sentence = answer.failure.killed
		? killedSpotCheck(card, cmd, VERIFY_TIMEOUT_MS)
		: failedSpotCheck(card, cmd, answer.failure.exit);
	// The tail is what says why, and it rides the sentence as one clip rather than a second line.
	return { error: tail === undefined ? sentence : `${sentence} — ${tail}` };
}

/**
 * What a sign is refused with when its tree carries nothing of its own.
 *
 * It names the directory, because the seat's fix is usually a different tree — the card's worktree,
 * through `root` — and it names the other door, because a card whose work is already in the base
 * cannot be reviewed at all: the landing carried the commit, so the merged tree is refused by the
 * same rule, and the close is `done` with an override.
 */
function noWorkSentence(cwd: string, facts: TreeFacts): string {
	const at = [facts.sha, facts.branch === undefined ? undefined : `on ${facts.branch}`]
		.filter((part): part is string => part !== undefined)
		.join(" ");
	const where = at === "" ? "at its HEAD" : `at ${at}`;
	return (
		// The path is the caller's — `root` can be one they typed — so it prints as a refusal does
		// elsewhere: shortened against home, and never carrying a second line.
		`the tree at ${sanitizeLine(shortenPath(cwd))} is ${where} and carries no commit past ${facts.base ?? "the base branch"}: ` +
		"a spot-check there would sign the base — name the card's worktree with `root`, or close the card with `done` and an `override` if its work is already in."
	);
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
	/** The note the sign will carry, so a card that cannot keep it starts no process. */
	note?: unknown;
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
 * The gate is asked *before* the process, because a sign that will be refused must not start one —
 * the lane, the holder, the signer, the override and the note are all its — and it answers no
 * refusal of its own: the store asks the same questions under the lock, in the order a caller reads,
 * and its sentence is the one a result carries. An override runs nothing at all: it is the close a
 * gate did not get. A card whose contract names no command is `undefined` from
 * {@link verifySpotCheck}, which is the same answer it gives an override.
 */
export async function spotCheck(
	options: SpotCheck,
): Promise<{ verified: Verification } | { error: string } | undefined> {
	if ("error" in reviewGate(options.card, options.actor, options.lead, options.override, options.note))
		return undefined;
	if (options.override !== undefined) return undefined;
	return verifySpotCheck(options.card, options.cwd, options.run, options.now, options.tree);
}

/**
 * What a red size gate refuses with: the gate's name and its tail, never the card's.
 *
 * The failure is the repository's — a module or a suite past its bar is the state `main` is in, and
 * the card is only the session that noticed — so the sentence must not read as a verdict on the
 * card's work, and it must name the gate a reader can run.
 */
function sizeGatesSentence(outcome: VerifyOutcome): string {
	const tail = outputLine(outcome);
	const said = outcome.killed
		? `\`${SIZE_GATES}\` did not finish within ${Math.max(1, Math.round(VERIFY_TIMEOUT_MS / 60_000))} minutes`
		: `\`${SIZE_GATES}\` exited ${outcome.exit}`;
	const sentence = `the repository's size gates are red: ${said}, so nothing can be signed on this tree`;
	return tail === undefined ? `${sentence}.` : `${sentence} — ${tail}`;
}

/** The clipped output as one line a refusal can carry: merged, collapsed, and sanitized. */
export function outputLine(outcome: VerifyOutcome): string | undefined {
	const text = sanitizeLine(outcome.output).trim();
	return text === "" ? undefined : text;
}
