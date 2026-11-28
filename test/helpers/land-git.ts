/**
 * The landing verb's seam, as three suites drive it: a scripted `RunGit`, the shas a case reads, the
 * changelog the verb writes, and the one call each case makes.
 *
 * Shared because the verb's own suite, the append-hotspot suite and the door's suite all need the
 * same script — a second copy of `fakeGit` would be the drift the landing gate exists to refuse, and
 * the hotspot cases outgrew the suite they started in (#905). Nothing here touches a repository:
 * every case is a script of git's answers plus the one write a landing makes, so the order the
 * commands run in and the exact text of the bullet are both what is pinned.
 */

import { readFileSync } from "node:fs";
import { boardCard } from "./fixtures/board.ts";
import type { Card } from "../../lib/workflow/card.ts";
import { landCard } from "../../lib/workflow/land.ts";
import { verbSources } from "../../lib/workflow/land-verb.ts";
import type { RunGit } from "../../lib/git/runner.ts";

export const BASE = "1111111111111111111111111111111111111111";
export const BRANCH = "2222222222222222222222222222222222222222";
export const REVIEWED = "3333333333333333333333333333333333333333";
export const MERGE = "4444444444444444444444444444444444444444";

/**
 * The changelog both trees start from: one `[Unreleased]` window with two sections, a release, and the
 * two foot references a version cut rewrites.
 *
 * Written out rather than generated, so a case that reads the landing's text is reading a fixture and
 * not the module it is testing.
 */
export const CHANGELOG = [
	"# Clog",
	"",
	"## [Unreleased]",
	"",
	"### Added",
	"",
	"- an earlier feature",
	"",
	"### Changed",
	"",
	"- an earlier change",
	"",
	"## [0.31.0] - 2026-01-01",
	"",
	"### Added",
	"",
	"- shipped",
	"",
	"[Unreleased]: https://example.com/compare/v0.30.0...HEAD",
	"[0.31.0]: https://example.com/compare/v0.29.0...v0.30.0",
	"",
].join("\n");

/** The bullet {@link CARD} earns: `landSubject`'s scope and title, and the id, opening lowercase. */
export const BULLET = "- `board`: land is a reviewed card's verb, not a mode exit (#856)";

/** The one file a clean landing leaves behind: {@link CHANGELOG} with {@link BULLET} at the head of its list. */
export const LANDED = CHANGELOG.replace("- an earlier change\n", `${BULLET}\n\n- an earlier change\n`);

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

/** The script a signed tree answers with: the verb's own files, exactly as this process holds them. */
export function signedSources(
	sha: string = REVIEWED,
	override?: (path: string) => Answer | undefined,
): Record<string, Answer> {
	const script: Record<string, Answer> = {};
	for (const source of verbSources()) {
		script[`show ${sha}:${source.path}`] = override?.(source.path) ?? { stdout: readFileSync(source.file, "utf-8") };
	}
	return script;
}

/** The script a clean landing hears: everything succeeds, and `main` is on the remote's tip. */
export function cleanLanding(overrides: Record<string, Answer | Answer[]> = {}) {
	return {
		...signedSources(),
		fetch: { stdout: "" },
		"rev-parse --abbrev-ref": { stdout: "main\n" },
		status: { stdout: "" },
		"rev-parse HEAD": [{ stdout: `${BASE}\n` }, { stdout: `${MERGE}\n` }],
		"rev-parse origin/main": { stdout: `${BASE}\n` },
		"rev-parse worktree-one": { stdout: `${REVIEWED}\n` },
		// A synced branch forks at the tip it is landed onto, so every existing case reads the changelog
		// against the base; the cases that are *behind* name their own fork and are the card's evidence.
		[`merge-base ${BASE}`]: { stdout: `${BASE}\n` },
		[`show ${BASE}:CHANGELOG.md`]: { stdout: CHANGELOG },
		[`show ${REVIEWED}:CHANGELOG.md`]: { stdout: CHANGELOG },
		[`show ${MERGE}:CHANGELOG.md`]: { stdout: LANDED },
		merge: { stdout: "" },
		"add --": { stdout: "" },
		commit: { stdout: "" },
		"merge-base --is-ancestor": { stdout: "" },
		"diff --numstat": { stdout: "2\t0\tCHANGELOG.md\n59\t0\textensions/board/lead-gate.test.ts\n" },
		push: { stdout: "" },
		...overrides,
	};
}

export const CARD: Card = boardCard("856", {
	title: "board: land is a reviewed card's verb, not a mode exit",
	paths: ["extensions/board/actions.ts", "lib/workflow/land.ts"],
});

/**
 * What a landing is handed: the card, the checkout, the review's own evidence, the verb's seam, and
 * the write that puts the bullet in the changelog.
 *
 * `fingerprint` and `write` are the two facts a scripted git cannot supply, so they come in beside
 * the script: a case says "moved" or `undefined` the way it says "the push was refused", and the
 * recorded write is how a case reads the exact text a landing put in the file.
 */
export function landingWith(script: Record<string, Answer | Answer[]>, fingerprint?: () => string | undefined) {
	const git = fakeGit(script);
	const written: Array<{ path: string; text: string }> = [];
	return {
		git,
		written,
		answer: landCard({
			card: CARD,
			cwd: "/checkout",
			reviewed: { sha: REVIEWED, branch: "worktree-one" },
			run: git.run,
			write: (path, text) => {
				written.push({ path, text });
			},
			...(fingerprint === undefined ? {} : { fingerprint }),
		}),
	};
}
