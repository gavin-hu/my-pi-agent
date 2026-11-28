/**
 * The module line bar: `AGENTS.md`'s "no module grows".
 *
 * Past 600 lines a module is named in LONG_MODULES with the one responsibility that keeps it
 * whole and its own height, so staying oversized costs a stated reason and a height that only
 * falls. A module at exactly 600 is named in AT_THE_BAR instead, so a trim that lands on the bar
 * rather than under it is a reviewed decision rather than an accident. The suites have their own
 * bar, in `suite-sizes.test.ts`.
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
	"lib/highlight.ts": {
		lines: 1000,
		why: "one tokenizer per language over a shared escape-first scan",
	},
	"lib/requirements.ts": {
		lines: 804,
		why: "one prerequisite table plus the pure probe over its injected seams",
	},
	"extensions/plan/feedback.ts": {
		lines: 616,
		why: "one codec: the marker grammar and its escapes",
	},
};

/**
 * The named modules' total, written down so raising one height has to lower
 * another. It falls whenever a module shrinks; it never rises.
 */
const LONG_MODULE_TOTAL = 2420;

/** One scanned module: its repository path, and its height. */
interface ModuleSize {
	relative: string;
	lines: number;
}

/** Every module the bar measures — an extension's, `lib/`'s, `scripts/`'s — with its height. */
function modules(): ModuleSize[] {
	const found: ModuleSize[] = [];
	for (const root of [extensionsDir, libDir, scriptsDir]) {
		for (const file of sourceFiles(root)) found.push({ relative: file.slice(repo.length + 1), lines: lineCount(file) });
	}
	return found;
}

/**
 * Modules at exactly the bar, each with the responsibility that keeps it whole.
 *
 * This is the only list in which sitting exactly at the bar is deliberate: past it a module needs
 * `LONG_MODULES`, and below it nobody asks. A module trimmed to 600 rather than under it is a
 * decision nobody wrote down, so one at the bar fails until it is named here, and an entry whose
 * module left the bar fails as stale. There is no height and no total to ratchet — the bar stays
 * where it is, and this records the choice.
 */
const AT_THE_BAR: Record<string, string> = {
	"extensions/board/commands.ts": "one table of words over the page's lifecycle, which page.ts owns",
	"extensions/bytefly/panel/tui.ts": "one frame around three sections, so the screen does not change shape",
	"extensions/plan/web-client.ts": "one composition root: every rule the page has lives in its own web-*.ts",
};

/** Modules at exactly the bar that no entry names, which is how a trim lands unnoticed. */
function atBarOffenders(scanned: readonly ModuleSize[], named: Readonly<Record<string, string>>): string[] {
	return scanned
		.filter((module) => module.lines === MAX_MODULE_LINES && named[module.relative] === undefined)
		.map(
			(module) =>
				`${module.relative}: ${module.lines} lines, exactly at the bar; split it, or name it in AT_THE_BAR and say what keeps it whole`,
		);
}

/** Entries whose module is gone, or no longer sits at exactly the bar. */
function staleAtBar(named: Readonly<Record<string, string>>, scanned: readonly ModuleSize[]): string[] {
	const heights = new Map(scanned.map((module) => [module.relative, module.lines]));
	return Object.keys(named)
		.filter((relative) => heights.get(relative) !== MAX_MODULE_LINES)
		.map((relative) => `${relative}: not a module at exactly ${MAX_MODULE_LINES} lines; delete the entry`);
}

describe("module sizes", () => {
	test("a module over the line bar states the responsibility that keeps it whole", () => {
		const offenders = modules()
			.filter((module) => module.lines > MAX_MODULE_LINES && LONG_MODULES[module.relative] === undefined)
			.map(
				(module) =>
					`${module.relative}: ${module.lines} lines; split it, or name it in LONG_MODULES with the one responsibility`,
			);
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

	test("a module at exactly the bar is named for review", () => {
		expect(
			atBarOffenders(modules(), AT_THE_BAR),
			"a trim that lands exactly on the bar is a decision nobody wrote down",
		).toEqual([]);
	});

	test("an AT_THE_BAR entry names a module still at the bar", () => {
		expect(staleAtBar(AT_THE_BAR, modules())).toEqual([]);
	});
});

/** A scan as a case hands one in, so the checks can be exercised on a fixture. */
function scanOf(heights: Record<string, number>): ModuleSize[] {
	return Object.entries(heights).map(([relative, lines]) => ({ relative, lines }));
}

describe("the at-the-bar checks", () => {
	test("fails a module at exactly the bar with no entry, and passes 599 and 601", () => {
		// The tree names its three, so the wrong value is manufactured here: a case that has never
		// failed is a case nobody knows holds.
		expect(atBarOffenders(scanOf({ "extensions/a/at.ts": MAX_MODULE_LINES }), {})).toHaveLength(1);
		expect(atBarOffenders(scanOf({ "extensions/a/under.ts": MAX_MODULE_LINES - 1 }), {})).toEqual([]);
		expect(atBarOffenders(scanOf({ "extensions/a/over.ts": MAX_MODULE_LINES + 1 }), {})).toEqual([]);
	});

	test("passes a named module at the bar", () => {
		const named = { "extensions/a/at.ts": "one responsibility, so it stays whole" };
		expect(atBarOffenders(scanOf({ "extensions/a/at.ts": MAX_MODULE_LINES }), named)).toEqual([]);
	});

	test("fails an entry whose module left the bar, in either direction", () => {
		const named = { "extensions/a/at.ts": "why" };
		expect(staleAtBar(named, scanOf({ "extensions/a/at.ts": MAX_MODULE_LINES - 1 }))).toHaveLength(1);
		expect(staleAtBar(named, scanOf({ "extensions/a/at.ts": MAX_MODULE_LINES + 1 }))).toHaveLength(1);
		expect(staleAtBar(named, scanOf({}))).toHaveLength(1);
	});
});
