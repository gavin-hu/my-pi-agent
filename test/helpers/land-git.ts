/**
 * The landing verb's seam, as two suites drive it: a scripted `RunGit`, the shas a case reads, and
 * the one call each case makes.
 *
 * Shared because the verb's own suite and the append-hotspot suite both need the same script — a
 * second copy of `fakeGit` would be the drift the landing gate exists to refuse, and the hotspot
 * cases outgrew the suite they started in (#905). Nothing here touches a repository: every case is
 * a script of git's answers, so the order the commands run in is what is pinned.
 */

import { boardCard } from "./fixtures/board.ts";
import type { Card } from "../../lib/workflow/card.ts";
import { landCard } from "../../lib/workflow/land.ts";
import type { RunGit } from "../../lib/git/runner.ts";

export const BASE = "1111111111111111111111111111111111111111";
export const BRANCH = "2222222222222222222222222222222222222222";
export const REVIEWED = "3333333333333333333333333333333333333333";
export const MERGE = "4444444444444444444444444444444444444444";

/** One scripted answer; an array is consumed in call order for a command asked twice. */
export interface Answer {
	code?: number;
	stdout?: string;
	stderr?: string;
}

/** A git seam that answers from a script, recording every argv it was handed. */
export function fakeGit(script: Record<string, Answer | Answer[]>) {
	const calls: string[][] = [];
	const queues = new Map<string, Answer[]>();
	for (const [key, value] of Object.entries(script)) queues.set(key, Array.isArray(value) ? [...value] : [value]);
	const run: RunGit = async (args) => {
		calls.push(args);
		const key = args.slice(0, 2).join(" ");
		const queue = queues.get(key) ?? queues.get(args[0] ?? "");
		const answer = queue?.length === 1 ? queue[0] : queue?.shift();
		if (answer === undefined) return { stdout: "", stderr: `no answer for "${key}"`, code: 128 };
		return { stdout: answer.stdout ?? "", stderr: answer.stderr ?? "", code: answer.code ?? 0 };
	};
	return { run, calls, argv: (verb: string) => calls.filter((args) => args[0] === verb) };
}

/** The script a clean landing hears: everything succeeds, and `main` is on the remote's tip. */
export function cleanLanding(overrides: Record<string, Answer | Answer[]> = {}) {
	return {
		fetch: { stdout: "" },
		"rev-parse --abbrev-ref": { stdout: "main\n" },
		status: { stdout: "" },
		"rev-parse HEAD": [{ stdout: `${BASE}\n` }, { stdout: `${MERGE}\n` }],
		"rev-parse origin/main": { stdout: `${BASE}\n` },
		"rev-parse worktree-one": { stdout: `${REVIEWED}\n` },
		"merge-base --is-ancestor": { stdout: "" },
		merge: { stdout: "" },
		"diff --numstat": { stdout: "5\t0\tCHANGELOG.md\n59\t0\textensions/board/lead-gate.test.ts\n" },
		push: { stdout: "" },
		...overrides,
	};
}

export const CARD: Card = boardCard("856", {
	title: "board: land is a reviewed card's verb, not a mode exit",
	paths: ["extensions/board/actions.ts", "lib/workflow/land.ts"],
});

/** What a landing is handed: the card, the checkout, and the review's own evidence. */
export function landingWith(script: Record<string, Answer | Answer[]>) {
	const git = fakeGit(script);
	return {
		git,
		answer: landCard({
			card: CARD,
			cwd: "/checkout",
			reviewed: { sha: REVIEWED, branch: "worktree-one" },
			run: git.run,
		}),
	};
}
