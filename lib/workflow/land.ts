/**
 * The landing verb: a reviewed card's merge, proof and named-ref push, as fixed argv.
 *
 * `review` runs the card's own check in the tree the work was made in; this puts that tree on
 * trunk, and it runs the commands itself rather than through a shell so every argument is one
 * this module wrote. The order is the safety argument — fetch, the checkout's equality with the
 * remote, the signed commit's ancestry, the merge, the proof, the push — and anything that fails
 * after the merge undoes it with `reset --keep`, never `--hard`: the checkout this runs in is
 * shared, and a peer's edit can land between a `status` check and the undo, so the undo refuses
 * rather than eating a file that is not ours.
 *
 * The caller supplies the seam — {@link RunGit} — and this module keeps no state, so a suite
 * drives every refusal without a repository and a second landing cannot see the first's memory.
 */

import { messageOf } from "../errors.ts";
import type { RunGit } from "../git/runner.ts";
import type { Card } from "./card.ts";

/** The branch a landing writes. Fixed: the record's landing is resolved against it too. */
export const LAND_BRANCH = "main";

/** The remote it writes. Fixed for the same reason, and pushed as a named ref, never bare. */
export const LAND_REMOTE = "origin";

/**
 * The files whose deletions mean a landing lost work rather than rewrote it.
 *
 * A card appends here from another branch, so a merge that removes a line has overwritten
 * somebody's newest record instead of carrying it — the one failure the numstat can catch.
 */
export const APPEND_HOTSPOTS: readonly string[] = ["CHANGELOG.md", "test/suite-manifest.ts"];

/** How long one git command may take before the seam gives up on it. */
export const LAND_TIMEOUT_MS = 120_000;

/** What a landing needs: the card, the tree it was signed in, and the git seam. */
export interface LandOptions {
	/** The card being landed: its title and paths write the subject, and nothing else is read. */
	card: Card;
	/** The checkout to merge in — the session's own, which must be on {@link LAND_BRANCH}. */
	cwd: string;
	/**
	 * What the spot-check recorded: the commit that was read, and the branch it was made on.
	 *
	 * Both come from the review's own evidence, so a branch that moved after the sign is caught
	 * by the ancestry check rather than merged because a caller said so.
	 */
	reviewed: { sha: string; branch: string };
	/** The git seam: `createExecRunner` in production, a fake in a suite. */
	run: RunGit;
}

/** One numstat row, as the proof reports it. */
export interface LandRow {
	/** The path git names, which a rename spells `old => new`. */
	path: string;
	/** Lines the merge added. */
	added: number;
	/** Lines it removed. */
	deleted: number;
}

/** What a landing produced, or the sentence stopping it. */
export type LandAnswer =
	| {
			/** The merge commit that carried the reviewed tree. */
			merge: string;
			/** The subject it was given. */
			subject: string;
			/** Its numstat, so the caller can print what moved. */
			rows: LandRow[];
			/** Where it was pushed, as `origin main`. */
			pushed: string;
	  }
	| { error: string };

/** A card's title often opens with its scope — `board:`, or the `docs(board):` a typed title uses. */
const TITLE_SCOPE = /^(?:[\w-]+\([^)]*\)|[\w-]+):\s*/;

/**
 * The extension a card's paths name, else `board` — the repository's own merge scopes.
 *
 * Paths outside `extensions/` are ignored rather than disqualifying: a card that moves a module
 * and its extension is the extension's work (#853 was `merge(plan)` with `lib/mode-state.ts`
 * among its paths), while two extensions disagreeing is no single scope at all.
 */
export function landScope(card: Pick<Card, "paths">): string {
	const names = card.paths
		.map((path) => /^extensions\/([^/]+)\//.exec(path)?.[1])
		.filter((name): name is string => name !== undefined);
	return names.length > 0 && names.every((name) => name === names[0]) ? names[0] : "board";
}

/**
 * The merge subject a card earns: `merge(<scope>): <title> (#<id>)`.
 *
 * Derived rather than supplied, because a landed sha cannot be repaired: a title is already the
 * sentence about what moved, and the one `scope:` prefix a title often carries is dropped so the
 * subject states it once.
 */
export function landSubject(card: Pick<Card, "id" | "title" | "paths">): string {
	const title = card.title.replace(TITLE_SCOPE, "").replace(/\s+/g, " ").trim();
	return `merge(${landScope(card)}): ${title} (#${card.id})`;
}

/** A sha as a sentence spells it. */
function short(sha: string): string {
	return sha.slice(0, 8);
}

/** The first line of git's output, for a refusal that quotes the tool rather than the transcript. */
function firstLine(text: string): string {
	const line = text.split("\n").find((entry) => entry.trim() !== "");
	return (line ?? "").trim();
}

/** One git command's answer: whether it succeeded, and the output a refusal quotes. */
interface Call {
	ok: boolean;
	out: string;
}

/**
 * Land `options.card`, or answer why not.
 *
 * Every refusal that leaves the branch alone says so; every refusal after the merge says the
 * merge was undone, because a caller reading "the push was refused" must know whether the
 * checkout is ahead of the remote it did not move.
 */
export async function landCard(options: LandOptions): Promise<LandAnswer> {
	const { card, cwd, reviewed, run } = options;
	const remote = LAND_REMOTE;
	const branch = LAND_BRANCH;
	const call = async (args: string[]): Promise<Call> => {
		try {
			const result = await run(args, { cwd, timeoutMs: LAND_TIMEOUT_MS });
			return { ok: result.code === 0, out: `${result.stdout}${result.stderr}`.trim() };
		} catch (error) {
			// A seam that broke is a failed command, never a pass: the answer quotes it.
			return { ok: false, out: messageOf(error) };
		}
	};

	const fetched = await call(["fetch", remote]);
	if (!fetched.ok) {
		return { error: `could not fetch ${remote} (${firstLine(fetched.out)}) — \`/board stop\` and land by hand.` };
	}

	const head = await call(["rev-parse", "--abbrev-ref", "HEAD"]);
	if (!head.ok) return { error: `could not read this checkout's branch (${firstLine(head.out)}).` };
	if (head.out !== branch) {
		return {
			error: `this checkout is on \`${head.out}\`, not \`${branch}\`: a landing runs in the checkout — \`/board stop\` and land by hand.`,
		};
	}

	const status = await call(["status", "--porcelain"]);
	if (!status.ok) return { error: `could not read the working tree (${firstLine(status.out)}).` };
	if (status.out !== "") {
		return {
			error: `this checkout has uncommitted changes: a landing starts from a clean tree — commit or stash them, then \`/board stop\` and land by hand.`,
		};
	}

	const local = await call(["rev-parse", "HEAD"]);
	const remoteTip = await call(["rev-parse", `${remote}/${branch}`]);
	if (!local.ok || !remoteTip.ok) {
		return {
			error: `could not read \`${branch}\` and \`${remote}/${branch}\` (${firstLine(local.out || remoteTip.out)}).`,
		};
	}
	if (local.out !== remoteTip.out) {
		return {
			error: `\`${branch}\` is not \`${remote}/${branch}\` (${short(local.out)} vs ${short(remoteTip.out)}): reconcile it first — \`/board stop\` and land by hand.`,
		};
	}
	/** The commit the merge starts from, and the one an undo returns to. */
	const base = local.out;
	const undo = (): Promise<Call> => call(["reset", "--keep", base]);

	const branchTip = await call(["rev-parse", reviewed.branch]);
	if (!branchTip.ok) {
		return {
			error: `could not read \`${reviewed.branch}\` (${firstLine(branchTip.out)}): the branch a spot-check ran on must still exist.`,
		};
	}
	// The signed tree *is* the branch: ancestry is not enough, or a commit added after the sign
	// would land under it — the same defect as a stale spot-check, one layer out. The refusal names
	// what a holder can act on (review it again) rather than merging a tree nobody read.
	if (branchTip.out !== reviewed.sha) {
		return {
			error: `\`${reviewed.branch}\` is at ${short(branchTip.out)}, not ${short(reviewed.sha)}: the branch moved past the sign — review it again.`,
		};
	}

	const subject = landSubject(card);
	const merged = await call(["merge", "--no-ff", "-m", subject, branchTip.out]);
	if (!merged.ok) {
		// A conflict leaves a half-merge behind: abort it, so the branch is the one it was.
		await call(["merge", "--abort"]);
		return { error: `the merge conflicts; the branch is untouched — \`/board stop\`, then resolve it by hand.` };
	}

	const mergeSha = await call(["rev-parse", "HEAD"]);
	if (!mergeSha.ok) {
		await undo();
		return {
			error: `could not read the merge's sha (${firstLine(mergeSha.out)}): the merge was undone and nothing was pushed.`,
		};
	}
	const merge = mergeSha.out;

	// The card's one guarantee: the tree the lead signed is the tree that lands.
	const carries = await call(["merge-base", "--is-ancestor", reviewed.sha, merge]);
	if (!carries.ok) {
		await undo();
		return {
			error: `the merge does not carry the signed tree ${short(reviewed.sha)}: the merge was undone and nothing was pushed.`,
		};
	}

	const numstat = await call(["diff", "--numstat", base, merge]);
	if (!numstat.ok) {
		await undo();
		return {
			error: `could not read the landing's numstat (${firstLine(numstat.out)}): the merge was undone and nothing was pushed.`,
		};
	}
	const rows = parseNumstat(numstat.out);
	const lost = rows.filter((row) => row.deleted > 0 && APPEND_HOTSPOTS.includes(row.path));
	if (lost.length > 0) {
		await undo();
		return {
			error: `the landing deletes lines in ${lost.map((row) => row.path).join(", ")}, which are appended and not rewritten: the merge was undone and nothing was pushed.`,
		};
	}

	const pushed = await call(["push", remote, `${branch}:${branch}`]);
	if (!pushed.ok) {
		await undo();
		return {
			error: `the push was refused (${firstLine(pushed.out)}): the remote moved, so the merge was undone — fetch and land again.`,
		};
	}

	return { merge, subject, rows, pushed: `${remote} ${branch}` };
}

/**
 * One numstat's rows, in git's order.
 *
 * A binary file reports `-` for both counts; it is read as zero rather than a number, because the
 * count is the thing a reader acts on and "-" is how git says it cannot give one. A rename's
 * `old => new` spelling is kept whole: the path is what a hotspot check needs, and no hotspot is
 * ever renamed by hand.
 */
export function parseNumstat(text: string): LandRow[] {
	const rows: LandRow[] = [];
	for (const line of text.split("\n")) {
		if (line.trim() === "") continue;
		const [added = "", deleted = "", ...rest] = line.split("\t");
		const path = rest.join("\t").trim();
		if (path === "") continue;
		rows.push({ path, added: numstatCount(added), deleted: numstatCount(deleted) });
	}
	return rows;
}

/** `-` is git saying it cannot count; anything else is a count. */
function numstatCount(raw: string): number {
	const value = Number.parseInt(raw, 10);
	return Number.isFinite(value) ? value : 0;
}
