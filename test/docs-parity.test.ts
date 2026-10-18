/**
 * Parity guard for the two entry READMEs.
 *
 * `README.md` is the front door and `README.zh-CN.md` mirrors it: a reader of
 * either should get the same map of the package. Translated prose cannot be
 * compared, so this checks the language-independent shape instead — section
 * structure, table rows, and the relative links and images a reader is sent to.
 *
 * Policy: the two entry READMEs stay in sync; deep docs (`docs/`,
 * `extensions/<name>/README.md`, `lib/`, `test/`) stay English until a
 * translation owner exists. `test/docs-truth.test.ts` pins the catalog against
 * the code, `test/config-docs.test.ts` pins the configuration reference against
 * the loaders, and this file pins the translation against its original.
 *
 * Deliberately not compared: heading and cell text (they are translated), pure
 * `#anchor` links (their fragments are translated), absolute URLs (the badges),
 * the language switcher at the top of each file (the two links are intentionally
 * asymmetric and are asserted on their own), code blocks, and release-time
 * content such as version markers.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const root = join(import.meta.dir, "..");
const english = readFileSync(join(root, "README.md"), "utf-8");
const chinese = readFileSync(join(root, "README.zh-CN.md"), "utf-8");

/** A language-independent outline of one README. */
export interface DocShape {
	/** Heading depths, in order. */
	headings: number[];
	/** Body row count of each markdown table, in order. */
	tables: number[];
	/** Relative link and image targets, in order, without fragments. */
	targets: string[];
}

const FENCE = /^\s*(`{3,}|~{3,})/;
const HEADING = /^(#{1,6})\s/;

/** A table's `|---|:--:|` separator row. */
function isSeparator(line: string): boolean {
	return line.trim().startsWith("|") && /^[\s|:-]+$/.test(line) && line.includes("-");
}

/** A table starts at a `|` header row followed by a separator row. */
function isTableStart(lines: readonly string[], index: number): boolean {
	const header = lines[index]?.trim() ?? "";
	const separator = lines[index + 1];
	return header.startsWith("|") && header.includes("|") && separator !== undefined && isSeparator(separator);
}

/** The language switcher pair: each file links to the other on purpose. */
const SWITCHER = new Set(["./README.md", "./README.zh-CN.md"]);

/** Record a link or image target unless it is absolute, an anchor, or the switcher. */
function addTarget(raw: string, targets: string[]): void {
	if (/^(?:https?:|mailto:|#|\/\/)/i.test(raw)) return;
	const target = raw.split("#")[0].trim();
	if (target && !SWITCHER.has(target)) targets.push(target);
}

/** The language-independent outline of `markdown`. */
export function shape(markdown: string): DocShape {
	const lines = markdown.split("\n");
	const headings: number[] = [];
	const tables: number[] = [];
	const targets: string[] = [];
	let fence: string | undefined;

	for (const [index, line] of lines.entries()) {
		const fenceMatch = FENCE.exec(line);
		if (fenceMatch) {
			if (fence === undefined) fence = fenceMatch[1][0];
			else if (fence === fenceMatch[1][0]) fence = undefined;
			continue;
		}
		if (fence !== undefined) continue;

		const heading = HEADING.exec(line);
		if (heading) headings.push(heading[1].length);
		if (isTableStart(lines, index)) {
			let rows = 0;
			const body = lines.slice(index + 2);
			for (const candidate of body) {
				if (!candidate.trim().startsWith("|")) break;
				rows++;
			}
			tables.push(rows);
		}
		for (const match of line.matchAll(/\]\(([^)\s]+)\)/g)) addTarget(match[1], targets);
		for (const match of line.matchAll(/\bsrc="([^"]+)"/g)) addTarget(match[1], targets);
	}
	return { headings, tables, targets };
}

/** One human sentence per difference between the two shapes. */
export function parityProblems(englishShape: DocShape, chineseShape: DocShape): string[] {
	const problems: string[] = [];

	if (englishShape.headings.length !== chineseShape.headings.length) {
		problems.push(
			`sections: the English README has ${englishShape.headings.length} headings, the Chinese one ${chineseShape.headings.length}`,
		);
	} else {
		const at = englishShape.headings.findIndex((depth, index) => depth !== chineseShape.headings[index]);
		if (at >= 0) {
			problems.push(
				`section ${at + 1}: English is h${englishShape.headings[at]}, Chinese is h${chineseShape.headings[at]}`,
			);
		}
	}

	if (englishShape.tables.length !== chineseShape.tables.length) {
		problems.push(
			`tables: the English README has ${englishShape.tables.length}, the Chinese one ${chineseShape.tables.length}`,
		);
	} else {
		const at = englishShape.tables.findIndex((rows, index) => rows !== chineseShape.tables[index]);
		if (at >= 0) {
			problems.push(
				`table ${at + 1}: the English README has ${englishShape.tables[at]} rows, the Chinese one ${chineseShape.tables[at]}`,
			);
		}
	}

	if (englishShape.targets.length !== chineseShape.targets.length) {
		problems.push(
			`links: the English README has ${englishShape.targets.length}, the Chinese one ${chineseShape.targets.length}`,
		);
	} else {
		const at = englishShape.targets.findIndex((target, index) => target !== chineseShape.targets[index]);
		if (at >= 0) {
			problems.push(
				`link ${at + 1}: English targets ${englishShape.targets[at]}, the Chinese README targets ${chineseShape.targets[at]}`,
			);
		}
	}

	return problems;
}

describe("entry README parity", () => {
	test("the English and Chinese READMEs share one structure", () => {
		expect(parityProblems(shape(english), shape(chinese))).toEqual([]);
	});

	test("each entry README links to the other", () => {
		expect(english).toContain("](./README.zh-CN.md)");
		expect(chinese).toContain("](./README.md)");
	});

	test("names a missing section", () => {
		const problems = parityProblems(shape("# A\n\n## One\n\n## Two\n"), shape("# A\n\n## 一\n"));
		expect(problems).toEqual(["sections: the English README has 3 headings, the Chinese one 2"]);
	});

	test("names a mismatched heading level", () => {
		const problems = parityProblems(shape("# A\n\n## One\n"), shape("# A\n\n### 一\n"));
		expect(problems).toEqual(["section 2: English is h2, Chinese is h3"]);
	});

	test("names a missing table row", () => {
		const source = (rows: string): string => `# A\n\n| x | y |\n|---|---|\n${rows}`;
		expect(parityProblems(shape(source("| 1 | 2 |\n| 3 | 4 |\n")), shape(source("| 1 | 2 |\n")))).toEqual([
			"table 1: the English README has 2 rows, the Chinese one 1",
		]);
	});

	test("names a missing link target", () => {
		const problems = parityProblems(shape("# A\n\n[a](./one.md) [b](./two.md)\n"), shape("# A\n\n[甲](./one.md)\n"));
		expect(problems).toEqual(["links: the English README has 2, the Chinese one 1"]);
	});

	test("ignores fences, anchors, absolute URLs, and the switcher in both", () => {
		const markdown = "# A\n\n[en](./README.zh-CN.md) [x](#anchor) [y](https://pi.dev)\n\n```\n## not a heading\n```\n";
		expect(shape(markdown)).toEqual({ headings: [1], tables: [], targets: [] });
	});
});
