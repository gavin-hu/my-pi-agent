/**
 * The verb's own files: which they are, what this process holds, and what the signed tree carries.
 *
 * A landing runs the code its process imported, which is the checkout's, on `main` — so three copies
 * of one judgement exist at land time: the process's, the checkout's disk, and the tree the
 * spot-check signed. `staleVerb` compares the first two and its remedy is a restart. `signedVerb`
 * reads the third, and its remedy is the bootstrap: a tree carrying a different verb is a tree whose
 * rules this process cannot speak for, so the landing leaves that card's entry to the tree instead
 * of writing it with yesterday's rules.
 *
 * The comparison cannot be fooled by a tree that adds a module, and it needs no parsing to know:
 * {@link VERB_SOURCES} is read *out of the tree* by the paths this list names, hashed in the same
 * order — and this file, which spells the list, is itself one of the files compared, so changing the
 * list is changing a file the comparison already reads.
 *
 * Split out of `land.ts` when the third read arrived: that module was 537 of its 600 lines and
 * nothing here knows what a merge is.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { messageOf } from "../errors.ts";
import type { RunGit } from "../git/runner.ts";
import { posixPath } from "../path.ts";

/**
 * The files whose text *is* the landing's judgement.
 *
 * `land.ts` decides the merge, `suite-declarations.ts` what the merge may delete, `changelog.ts` the
 * one line it writes, and `land-subject.ts` the words of that line — so a guard holding fewer of them
 * would pass a stale rule. A module joining them belongs in this list.
 */
export const VERB_SOURCES: readonly string[] = [
	fileURLToPath(new URL("./land.ts", import.meta.url)),
	fileURLToPath(new URL("./suite-declarations.ts", import.meta.url)),
	fileURLToPath(new URL("./changelog.ts", import.meta.url)),
	fileURLToPath(new URL("./land-subject.ts", import.meta.url)),
	// Last, and here at all because this file spells the list: a tree that changes only this one —
	// weakening `signedVerb` itself — would otherwise be invisible to the comparison it runs.
	fileURLToPath(import.meta.url),
];

/** The repository these files belong to: two levels above `lib/workflow/`. */
const PACKAGE_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** A source as the two things a comparison needs: the file here, and the path a tree names. */
export interface VerbSource {
	/** The file this process imported. */
	file: string;
	/** Its path inside the repository — `lib/workflow/land.ts` — which is what `git show` takes. */
	path: string;
}

/** {@link VERB_SOURCES}, each with the path a tree spells it by. */
export function verbSources(): VerbSource[] {
	return VERB_SOURCES.map((file) => ({ file, path: posixPath(relative(PACKAGE_ROOT, file)) }));
}

/** One blob's sha256. */
function sourceSha(bytes: string | Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

/** The sha256 of every source in order, or `undefined` when one could not be read. */
export function verbFingerprint(sources: readonly string[] = VERB_SOURCES): string | undefined {
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

/**
 * Why the verb this process holds is not the one a landing would run, or `undefined` when it is.
 *
 * Both sentences name every source, because one digest cannot say which of them moved or which could
 * not be read, and a refusal that guessed would be a fact nobody checked. Neither says `/reload`
 * fixes it: `/reload` keeps a `lib/` module another extension already loaded, so a restart is the
 * door that does.
 */
export function staleVerb(seam?: () => string | undefined): string | undefined {
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

/** What the tree the spot-check signed carries, against the verb this process holds. */
export type SignedVerb =
	/** The tree is this verb: the landing may write the entry itself. */
	| { kind: "same" }
	/** The tree is a different verb, and these are the files that say so. */
	| { kind: "differs"; paths: readonly string[] }
	/** The tree carries none of them: it is not this package's repository, so there is nothing to compare. */
	| { kind: "absent" }
	/** The read broke, or the tree carries part of the verb, which is a fact nobody can act on. */
	| { kind: "failed"; said: string };

/**
 * The signed tree's copies of {@link VERB_SOURCES}, compared with the ones this process holds.
 *
 * Read one `git show <sha>:<path>` at a time, by the paths the list names, so the answers line up with
 * the files that named them. All of them missing is {@link SignedVerb} `absent` — a consumer repository
 * has no such paths and never did — while a tree that carries some of them is `failed`, because a
 * half-present verb is a tree nobody can read as either.
 */
export async function signedVerb(
	run: RunGit,
	options: { cwd: string; sha: string; timeoutMs: number },
): Promise<SignedVerb> {
	const read: Array<{ source: VerbSource; text: string }> = [];
	const missing: string[] = [];
	for (const source of verbSources()) {
		try {
			const answer = await run(["show", `${options.sha}:${source.path}`], {
				cwd: options.cwd,
				timeoutMs: options.timeoutMs,
			});
			if (answer.code === 0) read.push({ source, text: answer.stdout });
			else missing.push(source.path);
		} catch (error) {
			return {
				kind: "failed",
				said: `could not read \`${source.path}\` at ${options.sha.slice(0, 8)} (${messageOf(error)})`,
			};
		}
	}
	if (read.length === 0) return { kind: "absent" };
	if (missing.length > 0) {
		return {
			kind: "failed",
			said: `the tree at ${options.sha.slice(0, 8)} carries part of the landing verb and not the rest (${missing.join(", ")}): neither the verb this process holds nor a tree it can be read against`,
		};
	}
	// A comparison needs both sides, so a source this process cannot read is a failed read rather than a
	// difference: the sentence for a difference asks for a commit, which no unreadable file would earn.
	const paths: string[] = [];
	for (const entry of read) {
		let here: string;
		try {
			here = sourceSha(readFileSync(entry.source.file));
		} catch (error) {
			return {
				kind: "failed",
				said: `could not read \`${entry.source.path}\` here (${messageOf(error)}): the comparison needs both sides`,
			};
		}
		if (here !== sourceSha(entry.text)) paths.push(entry.source.path);
	}
	return paths.length === 0 ? { kind: "same" } : { kind: "differs", paths };
}
