/**
 * Every number a document states about the code, derived rather than trusted.
 *
 * A prose count is the first thing to rot: nothing breaks when "21 extensions"
 * becomes 22, so it stays 21 until somebody notices. `test/settings-coverage.test.ts`
 * solved the same problem for one number by deriving it from `SETTING_ROWS`; this file
 * is the same idea for the catalog.
 *
 * Each statement is a **pattern plus what it claims**, not a sentence rebuilt from the
 * numbers: the pattern captures the numbers in the order the sentence names them, and
 * the assertion compares them with what the tree holds. A document reworded past its
 * pattern fails loudly, and the fix is to update the pattern beside the prose — never to
 * drop the check.
 *
 * What it cannot do is tell whether a sentence is *well written*: a count that is right
 * in a confusing sentence still passes. That stays a review judgement.
 *
 * One count is deliberately **not** claimed here: the pack's total number of tools. The
 * entry README's "Tools and commands" column is compared with the registered set by
 * `test/naming.test.ts`, which is the same fact held exactly — a total beside it could
 * only rot, and it did, for as long as the guide's reference page carried one. A page
 * that states the count for its own extension is not this problem: it is prose about a
 * handful of tools a reader can see in that extension's own table.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { catalogCounts, manifest } from "./helpers/surface.ts";

const root = join(import.meta.dir, "..");

/** The counts one document states, and the numbers it names them with. */
interface Claim {
	/** The file, relative to the package root, and the line a reader meets it on. */
	file: string;
	/** The sentence's shape: one capture group per number, in the order it names them. */
	pattern: RegExp;
	/** Which derived count each capture group claims. */
	counts: Array<keyof Counts>;
}

/** What the tree holds: the catalog. */
interface Counts {
	extensions: number;
	skills: number;
	themes: number;
}

/** The three places a count of the code is stated. */
const CLAIMS: Claim[] = [
	{
		file: "README.md",
		pattern: /(\d+) extensions, (\d+) packaged skills, and (\d+) themes/,
		counts: ["extensions", "skills", "themes"],
	},
	{
		file: "README.zh-CN.md",
		pattern: /(\d+) 个扩展、(\d+) 个随包技能，以及 (\d+) 个主题/,
		counts: ["extensions", "skills", "themes"],
	},
];

const counts: Counts = catalogCounts();

describe("doc counts", () => {
	test("derives the counts from the tree, and finds something to count", () => {
		// A glob that stopped matching would make every statement below trivially true.
		for (const [name, value] of Object.entries(counts)) expect(value, name).toBeGreaterThan(0);
		// The manifest is the registry: `extension-load.test.ts` holds it to the directories,
		// and this file counts it rather than the directory again.
		expect(counts.extensions).toBe(manifest.length);
	});

	test("claims no total of the pack's tools, because the registered set is the claim", () => {
		// The half of the decision a test can hold: no claim captures a tool count, so adding
		// one means deleting this case and saying why in the header. The header paragraph is
		// the guard for the other half — nothing here can stop an author who removes both.
		const sources = CLAIMS.map((claim) => claim.pattern.source).join(" ");
		expect(/\(\d\+\) (?:tools|commands)\b/.test(sources)).toBe(false);
	});

	for (const claim of CLAIMS) {
		test(`${claim.file} states the counts the tree has`, () => {
			const text = readFileSync(join(root, claim.file), "utf-8");
			const matches = [...text.matchAll(new RegExp(claim.pattern.source, "g"))];
			// Twice in one file means one copy can go stale while the other passes.
			expect(matches.length, `${claim.file}: the sentence matching ${claim.pattern}`).toBe(1);
			const stated = matches[0]?.slice(1).map(Number) ?? [];
			const expected = claim.counts.map((name) => counts[name]);
			expect(stated, `${claim.file}: a stated count no longer matches the tree`).toEqual(expected);
		});
	}
});
