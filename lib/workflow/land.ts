/**
 * The landing verb: a reviewed card's merge, proof and named-ref push, as fixed argv.
 *
 * `review` runs the card's own check in the tree the work was made in; this puts that tree on
 * trunk, and it runs the commands itself rather than through a shell so every argument is one
 * this module wrote — bar one: the `CHANGELOG.md` bullet it writes into the merge, which is the
 * whole of the difference between the landed tree and the signed one, and the changelog comparison
 * at the proof is what holds that difference to the line it generated. The order is the safety
 * argument — fetch, the checkout's equality with the remote, the signed commit's ancestry, the
 * branch's own changelog, the merge, the proof, the push — and anything that fails
 * after the merge undoes it with `reset --keep`, never `--hard`: the checkout this runs in is
 * shared, and a peer's edit can land between a `status` check and the undo, so the undo refuses
 * rather than eating a file that is not ours.
 *
 * The caller supplies the seam — {@link RunGit} — and this module keeps no state, so a suite
 * drives every refusal without a repository and a second landing cannot see the first's memory.
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { messageOf } from "../errors.ts";
import { headingFor, insertBullet } from "./changelog.ts";
import { landBullet, landSubject } from "./land-subject.ts";
import type { RunGit } from "../git/runner.ts";
import type { Card } from "./card.ts";
import { type DeclaredSuite, declaredSuites, suiteFileOf } from "./suite-declarations.ts";

/** The branch a landing writes. Fixed: the record's landing is resolved against it too. */
export const LAND_BRANCH = "main";

/** The remote it writes. Fixed for the same reason, and pushed as a named ref, never bare. */
export const LAND_REMOTE = "origin";

/** The hotspot whose deletions are never legitimate: a bullet another card appended. */
export const CHANGELOG_HOTSPOT = "CHANGELOG.md";

/** The hotspot whose deletion a card may owe: the line a removed suite leaves behind. */
export const SUITE_HOTSPOT = "test/suite-manifest.ts";

/**
 * The files whose deletions mean a landing lost work rather than rewrote it.
 *
 * A card used to append here from another branch, so a merge that removed a line had overwritten
 * somebody's newest record instead of carrying it. The changelog's bullet now belongs to the
 * landing, which reads that file itself (`changelogPlan`), so the count below is the second opinion
 * on a rule the comparison already holds — and the list stays here because a hand landing is still
 * reviewed by it. The manifest is the one file the layout gate forces a deletion in: a suite's
 * removal deletes its line, so a removed line is a rewrite only when the merge still carries the
 * suite it named (`removedSuitesAbove`).
 */
export const APPEND_HOTSPOTS: readonly string[] = [CHANGELOG_HOTSPOT, SUITE_HOTSPOT];

/** How long one git command may take before the seam gives up on it. */
export const LAND_TIMEOUT_MS = 120_000;

/**
 * The files whose text *is* the landing's judgement.
 *
 * This module decides the merge; `suite-declarations.ts` decides what the merge may delete, because
 * `removedSuitesAbove` refuses a deletion only for a declaration its reader still finds — so a stale
 * reader permits the deletion the guard exists to refuse. The pair is the verb, and a third module
 * joining it belongs in this list. Read through `import.meta.url`, never the landing checkout.
 */
export const VERB_SOURCES: readonly string[] = [
	fileURLToPath(import.meta.url),
	fileURLToPath(new URL("./suite-declarations.ts", import.meta.url)),
	fileURLToPath(new URL("./changelog.ts", import.meta.url)),
	fileURLToPath(new URL("./land-subject.ts", import.meta.url)),
];

/** The sha256 of every source in order, or `undefined` when one could not be read. */
function verbFingerprint(sources: readonly string[] = VERB_SOURCES): string | undefined {
	const hash = createHash("sha256");
	for (const path of sources) {
		try {
			hash.update(readFileSync(path));
		} catch {
			return undefined;
		}
	}
	return hash.digest("hex");
}

/**
 * The digest this process imported, exported so a suite can answer "unchanged" with the real value.
 *
 * `undefined` is a source that could not be read at import, and it refuses rather than throwing: a
 * module that threw here would take the landing door down instead of refusing one call.
 */
export const IMPORTED_LAND_FINGERPRINT = verbFingerprint();

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
	/**
	 * The verb's fingerprint as this process holds it, recomputed at land time.
	 *
	 * The one fact a suite cannot fake through {@link RunGit}: a case says "moved" or `undefined` the
	 * way it says "the push was refused", and the default is the real read of {@link VERB_SOURCES}.
	 */
	fingerprint?: () => string | undefined;
	/**
	 * How the generated bullet reaches `CHANGELOG.md` in the checkout.
	 *
	 * The second fact a suite cannot fake through {@link RunGit}: the base's text comes from `git
	 * show`, but the write is a file operation and a scripted landing names a `cwd` no repository
	 * has. `writeFileSync` in production, a recorder in a case — which is also how a case holds the
	 * verb to the exact text it wrote.
	 */
	write?: (path: string, text: string) => void;
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
 * Why the verb this process holds is not the one a landing would run, or `undefined` when it is.
 *
 * Both sentences name every source, because one digest cannot say which of them moved or which could
 * not be read, and a refusal that guessed would be a fact nobody checked. Neither says `/reload`
 * fixes it: `/reload` keeps a `lib/` module another extension already loaded, so a restart is the
 * door that does.
 */
function staleVerb(seam: (() => string | undefined) | undefined): string | undefined {
	const current = seam === undefined ? verbFingerprint() : seam();
	const sources = VERB_SOURCES.map((path) => `\`${path}\``).join(" and ");
	if (IMPORTED_LAND_FINGERPRINT === undefined || current === undefined) {
		return `could not read the landing verb's own files (${sources}): this process cannot prove it holds the rule on disk, so restart Pi before landing — \`/reload\` keeps a \`lib/\` module another extension already loaded.`;
	}
	if (current !== IMPORTED_LAND_FINGERPRINT) {
		return `${sources} changed since this process imported them: a landing would run the verb from before the edit, so restart Pi before landing — \`/reload\` keeps a \`lib/\` module another extension already loaded.`;
	}
	return undefined;
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
		return { error: `could not fetch ${remote} (${firstLine(fetched.out)}) — \`/board exit\` and land by hand.` };
	}

	const head = await call(["rev-parse", "--abbrev-ref", "HEAD"]);
	if (!head.ok) return { error: `could not read this checkout's branch (${firstLine(head.out)}).` };
	if (head.out !== branch) {
		return {
			error: `this checkout is on \`${head.out}\`, not \`${branch}\`: a landing runs in the checkout — \`/board exit\` and land by hand.`,
		};
	}

	const status = await call(["status", "--porcelain"]);
	if (!status.ok) return { error: `could not read the working tree (${firstLine(status.out)}).` };
	if (status.out !== "") {
		return {
			error: `this checkout has uncommitted changes: a landing starts from a clean tree — commit or stash them, then \`/board exit\` and land by hand.`,
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
			error: `\`${branch}\` is not \`${remote}/${branch}\` (${short(local.out)} vs ${short(remoteTip.out)}): reconcile it first — \`/board exit\` and land by hand.`,
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

	// The verb this process holds is the one a landing would run: the files it imported are the files
	// on disk. It is the last read-only refusal, because every check above names a remedy a holder can
	// act on, and a stale process must not mask one.
	// The branch's own changelog, read before anything is merged: the bullet is this verb's to write,
	// so this is where a branch that wrote one is told to drop it rather than where a merge conflicts.
	const changelog = await changelogPlan(call, base, branchTip.out, card);
	if ("error" in changelog) return changelog;

	const stale = staleVerb(options.fingerprint);
	if (stale !== undefined) return { error: stale };

	const subject = landSubject(card);
	// The merge is left uncommitted for one reason: the bullet has to be in the commit that carries it,
	// so the landed tree holds the line the proof names, and no second commit goes unsigned.
	const merged = await call(["merge", "--no-ff", "--no-commit", branchTip.out]);
	if (!merged.ok) {
		// A conflict leaves a half-merge behind: abort it, so the branch is the one it was.
		await call(["merge", "--abort"]);
		return { error: `the merge conflicts; the branch is untouched — \`/board exit\`, then resolve it by hand.` };
	}
	const written = await writeChangelog(call, cwd, changelog.text, subject, options.write);
	if (written !== undefined) return written;

	const mergeSha = await call(["rev-parse", "HEAD"]);
	if (!mergeSha.ok) {
		await undo();
		return {
			error: `could not read the merge's sha (${firstLine(mergeSha.out)}): the merge was undone and nothing was pushed.`,
		};
	}
	const merge = mergeSha.out;

	// The signed tree is what the merge carries: the one line this verb wrote is the whole of the
	// difference, and the changelog read below holds the landed tree to it.
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
	// The landed tree against the signed one, read from the merge's own tree rather than from the file
	// this verb wrote: the two differ by exactly this card's bullet, so a hook, a filter, or a stray
	// write that changed anything else is caught here instead of landing.
	const landed = await call(["show", `${merge}:${CHANGELOG_HOTSPOT}`]);
	if (!landed.ok) {
		await undo();
		return {
			error: `could not read the merge's ${CHANGELOG_HOTSPOT} (${firstLine(landed.out)}): the merge was undone and nothing was pushed.`,
		};
	}
	if (landed.out !== changelog.text.trim()) {
		await undo();
		return {
			error: `the merge's ${CHANGELOG_HOTSPOT} is not this card's bullet on top of the base: expected\n  ${changelog.bullet}\na bullet is appended by the landing, never edited: the merge was undone and nothing was pushed.`,
		};
	}
	// The manifest's deletion is the one a suite's removal requires, so it is judged by the suite it
	// names: gone from the merge is a removal, still there is a rewritten record.
	if (rows.some((row) => row.deleted > 0 && row.path === SUITE_HOTSPOT)) {
		const suites = await removedSuitesAbove(call, base, merge);
		if (suites.kind === "failed") {
			await undo();
			return { error: `${suites.message}: the merge was undone and nothing was pushed.` };
		}
		if (suites.alive.length > 0) {
			await undo();
			const named = suites.alive.map((suite) => `"${suite.stem}" (${suite.path})`).join(", ");
			return {
				error: `the landing removes the suite line ${named}, which the merge still carries — a suite's removal is the deletion the layout gate requires, while a line whose suite survives is a rewritten record: the merge was undone and nothing was pushed.`,
			};
		}
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

/** The suite a removed declaration left behind: its stem, and the file the merge still has for it. */
interface RemovedSuite {
	stem: string;
	path: string;
}

/** A declaration's identity: the group it sat in, and the stem it named. */
function declarationKey(entry: DeclaredSuite): string {
	const owner = entry.owner.kind === "extension" ? `extensions/${entry.owner.key}` : entry.owner.kind;
	return `${owner}:${entry.stem}`;
}

/**
 * The declarations a landing stopped making while the merge still carries their file.
 *
 * A removal is legitimate when the suite left the tree; it is a rewrite when the merge still has it.
 * The unit is the declaration: several groups declare `runtime`, `tools`, `format` and `presence`,
 * so a stem's absence does not say which group lost it — only the file that group's shape spells may
 * refuse. A surviving file, or a manifest this cannot read, still refuses and names what it found.
 */
async function removedSuitesAbove(
	call: (args: string[]) => Promise<Call>,
	base: string,
	merge: string,
): Promise<{ kind: "failed"; message: string } | { kind: "checked"; alive: RemovedSuite[] }> {
	const before = await call(["show", `${base}:${SUITE_HOTSPOT}`]);
	if (!before.ok) return { kind: "failed", message: `could not read the base manifest (${firstLine(before.out)})` };
	const after = await call(["show", `${merge}:${SUITE_HOTSPOT}`]);
	if (!after.ok) return { kind: "failed", message: `could not read the merge's manifest (${firstLine(after.out)})` };
	const from = declaredSuites(before.out);
	const to = declaredSuites(after.out);
	if (from === undefined || to === undefined) {
		return { kind: "failed", message: `could not read the groups ${SUITE_HOTSPOT} declares` };
	}
	const kept = new Set(to.map(declarationKey));
	const removed = from.filter((entry) => !kept.has(declarationKey(entry)));
	if (removed.length === 0) return { kind: "checked", alive: [] };
	const tree = await call(["ls-tree", "-r", "--name-only", merge]);
	if (!tree.ok) return { kind: "failed", message: `could not read the merge's files (${firstLine(tree.out)})` };
	const files = new Set(
		tree.out
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line !== ""),
	);
	const alive: RemovedSuite[] = [];
	for (const entry of removed) {
		const path = suiteFileOf(entry.owner, entry.stem);
		if (files.has(path)) alive.push({ stem: entry.stem, path });
	}
	return { kind: "checked", alive };
}

/**
 * The changelog's foot reference: `[Unreleased]: https://…` or `[0.31.0]: https://…`.
 *
 * A pointer, not a record. Cutting a version rewrites `[Unreleased]` to the new tag and adds the new
 * version's line beneath it, so a landing that removes one of these has not overwritten a peer's
 * bullet — it has done what every release does.
 */
const FOOT_REFERENCE = /^\[[^\]]+\]:\s+https?:\/\//;

/** The changelog's foot references, trimmed: the lines a version cut rewrites and no reader of the list sees. */
function referencesOf(text: string): string[] {
	return text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => FOOT_REFERENCE.test(line));
}

/** The file without those lines, so a cut's rewrites can be set aside on both sides of a comparison. */
function withoutReferences(text: string): string {
	return text
		.split("\n")
		.filter((line) => !FOOT_REFERENCE.test(line.trim()))
		.join("\n");
}

/** What a landing is about to write: the bullet, and the file with it in place. */
interface ChangelogPlan {
	/** The generated line, named in a refusal and in the proof. */
	bullet: string;
	/** The whole file, one final newline restored, which is what the landing writes. */
	text: string;
}

/**
 * The changelog this landing will leave behind, or why it will not land.
 *
 * Read from the two trees rather than from the checkout, because the branch's own copy is what a
 * merge would carry: a branch that wrote a bullet is the contention this verb exists to remove, and
 * a version cut is the one edit that rides — its foot references, and only those, may differ.
 */
async function changelogPlan(
	call: (args: string[]) => Promise<Call>,
	base: string,
	tip: string,
	card: Card,
): Promise<ChangelogPlan | { error: string }> {
	const before = await call(["show", `${base}:${CHANGELOG_HOTSPOT}`]);
	if (!before.ok) {
		return { error: `could not read the base's ${CHANGELOG_HOTSPOT} (${firstLine(before.out)}).` };
	}
	const branch = await call(["show", `${tip}:${CHANGELOG_HOTSPOT}`]);
	if (!branch.ok) {
		return { error: `could not read the branch's ${CHANGELOG_HOTSPOT} (${firstLine(branch.out)}).` };
	}
	const bullet = landBullet(card);
	if (withoutReferences(before.out) !== withoutReferences(branch.out)) {
		return {
			error: `the branch edits ${CHANGELOG_HOTSPOT}: a landing writes the bullet itself, so drop that change — the line it will land is\n  ${bullet}`,
		};
	}
	const from = referencesOf(before.out);
	const to = referencesOf(branch.out);
	if (from.join("\n") !== to.join("\n") && to.length <= from.length) {
		return {
			error: `the branch rewrites ${CHANGELOG_HOTSPOT}'s foot references without the new version's line, which is what a cut adds.`,
		};
	}
	const text = insertBullet(branch.out, headingFor(card.type), bullet);
	if (text === undefined) {
		return {
			error: `${CHANGELOG_HOTSPOT} has no \`## [Unreleased]\` window: a bullet is written there and nowhere else.`,
		};
	}
	// `call` trims its answer, so the file is rebuilt with the newline every line of it ended on.
	return { bullet, text: `${text}\n` };
}

/** The write, and the two commands that put it in the merge; `undefined` when all three worked. */
async function writeChangelog(
	call: (args: string[]) => Promise<Call>,
	cwd: string,
	text: string,
	subject: string,
	write: ((path: string, text: string) => void) | undefined,
): Promise<{ error: string } | undefined> {
	const undo = () => call(["merge", "--abort"]);
	try {
		(write ?? writeFileSync)(join(cwd, CHANGELOG_HOTSPOT), text);
	} catch (error) {
		await undo();
		return {
			error: `could not write ${CHANGELOG_HOTSPOT} (${messageOf(error)}): the merge was undone and nothing was pushed.`,
		};
	}
	const staged = await call(["add", "--", CHANGELOG_HOTSPOT]);
	if (!staged.ok) {
		await undo();
		return {
			error: `could not stage ${CHANGELOG_HOTSPOT} (${firstLine(staged.out)}): the merge was undone and nothing was pushed.`,
		};
	}
	const committed = await call(["commit", "-m", subject]);
	if (!committed.ok) {
		await undo();
		return {
			error: `could not commit the merge (${firstLine(committed.out)}): the merge was undone and nothing was pushed.`,
		};
	}
	return undefined;
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
