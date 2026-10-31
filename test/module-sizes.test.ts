/**
 * The module line bar: `AGENTS.md`'s "no module grows".
 *
 * Past 600 lines a module is named in LONG_MODULES with the one responsibility that keeps it
 * whole and its own height, so staying oversized costs a stated reason and a height that only
 * falls. The suites have their own bar, in `suite-sizes.test.ts`.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { extensionsDir, libDir, lineCount, repo, scriptsDir, sourceFiles } from "./helpers/scan.ts";

/** The line bar from AGENTS.md "Code quality". */
const MAX_MODULE_LINES = 600;

/**
 * Source modules over the bar, each with the one responsibility that keeps it
 * whole and its own height. Listing a module here is a deliberate choice, so a
 * new oversized module fails until someone states why it stays; the height makes
 * the entry a ceiling rather than a licence, since one added line fails and only
 * a smaller file lowers it. An entry that drops below the bar is stale and fails
 * too, so the list cannot quietly grow.
 */
const LONG_MODULES: Record<string, { lines: number; why: string }> = {
	"extensions/file-browse/view/markdown.ts": {
		lines: 875,
		why: "one escape-first block and inline scan for README Markdown",
	},
	"lib/highlight.ts": {
		lines: 1000,
		why: "one tokenizer per language over a shared escape-first scan",
	},
	"lib/requirements.ts": {
		lines: 808,
		why: "one prerequisite table plus the pure probe over its injected seams",
	},
};

/**
 * The named modules' total, written down so raising one height has to lower
 * another. It falls whenever a module shrinks; it never rises.
 */
const LONG_MODULE_TOTAL = 2683;

describe("module sizes", () => {
	test("a module over the line bar states the responsibility that keeps it whole", () => {
		const offenders: string[] = [];
		for (const root of [extensionsDir, libDir, scriptsDir]) {
			for (const file of sourceFiles(root)) {
				const relative = file.slice(repo.length + 1);
				const lines = lineCount(file);
				if (lines <= MAX_MODULE_LINES || LONG_MODULES[relative] !== undefined) continue;
				offenders.push(`${relative}: ${lines} lines; split it, or name it in LONG_MODULES with the one responsibility`);
			}
		}
		expect(offenders).toEqual([]);
	});

	test("a named module keeps its own height, never headroom", () => {
		// A height above the file would pass a few new lines through, which is the
		// growth this gate exists to stop.
		const slack = Object.entries(LONG_MODULES)
			.filter(([relative, entry]) => lineCount(join(repo, relative)) !== entry.lines)
			.map(
				([relative, entry]) =>
					`${relative}: named ${entry.lines}, file ${lineCount(join(repo, relative))}; set it to the file's height`,
			);
		expect(slack).toEqual([]);
	});

	test("LONG_MODULES carries no stale entry", () => {
		const stale = Object.keys(LONG_MODULES).filter((relative) => {
			const path = join(repo, relative);
			return !existsSync(path) || lineCount(path) <= MAX_MODULE_LINES;
		});
		expect(stale, "delete the entry: that module fits the bar again").toEqual([]);
	});

	test("the named modules cannot grow in total", () => {
		const total = Object.values(LONG_MODULES).reduce((sum, entry) => sum + entry.lines, 0);
		expect(total, "lower LONG_MODULE_TOTAL with the file: a split lowers it, nothing raises it").toBe(
			LONG_MODULE_TOTAL,
		);
	});
});
