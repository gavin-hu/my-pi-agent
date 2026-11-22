/**
 * Drift guard for the slow failures the shared-helper gate cannot see.
 *
 * `test/shared-helpers.test.ts` answers "is this helper written twice". These four
 * answer the slower failures around it:
 *
 * - a shared module nobody can find, because the `lib/README.md` index and the
 *   modules on disk drifted apart, so the next session writes a fourth copy;
 * - `AGENTS.md` growing back into a second manual, which is how the rules stop
 *   being read at all;
 * - a rule in `AGENTS.md` citing a test that was renamed, which turns the rule
 *   back into prose with nothing red;
 * - the entry README's catalog growing back into a manual too, one long table cell
 *   at a time, which is how a reader stops scanning it and the page starts
 *   restating the extension pages beside it;
 * - `CONTRIBUTING.md` growing the same way `AGENTS.md` did, one owned list at a
 *   time, which is how the workflow at the top stops being read.
 *
 * All five are ratchets: the index is compared against the tree, and the three word
 * budgets only ever fall. A duplicate body is not repeated here; that gate owns it.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { walkFiles } from "./helpers/files.ts";
import { RESERVED_PATHS, type StorageHome } from "../lib/storage.ts";
import { dirsOf, extensionsDir, relative } from "./helpers/scan.ts";

// `join` resolves the `..` on every platform, including Windows, where the
// backslashed absolute path is one long name to `posix.join`.
const repo = join(import.meta.dir, "..").replaceAll("\\", "/");
const libDir = join(repo, "lib");

/**
 * A path relative to `root`, in posix form, so a failure names the same file on
 * every OS. Slicing a native Windows path and normalising it is the whole
 * platform story, so it is a named function the test below can hold to it.
 */
function relativeTo(root: string, file: string): string {
	return file.slice(root.length + 1).replaceAll("\\", "/");
}

/** Every non-test TypeScript module under `lib/`. */
function libModules(): string[] {
	return (
		walkFiles(libDir)
			.filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
			// A barrel is a re-export list, not a module of its own.
			.filter((file) => !relative(file).endsWith("/index.ts"))
	);
}

test("the repo root it measures from is resolved and posix", () => {
	// A `..` left in place shifts every slice by one segment, which passes on macOS
	// and Linux and fails on Windows; the backslash check is the same trap.
	expect(repo).not.toContain("..");
	expect(repo).not.toContain("\\");
});

test("a native Windows path slices to the same posix module name", () => {
	expect(relativeTo("D:/a/my-pi-agent", "D:\\a\\my-pi-agent\\lib\\format.ts")).toBe("lib/format.ts");
	expect(relativeTo("/Users/gavin/my-pi-agent", "/Users/gavin/my-pi-agent/lib/format.ts")).toBe("lib/format.ts");
});

describe("the shared surface index", () => {
	test("every lib module has a row in lib/README.md", () => {
		const rows = readFileSync(join(libDir, "README.md"), "utf-8")
			.split("\n")
			.filter((line) => line.startsWith("|"));
		const missing = libModules()
			.filter((file) => {
				const module = relative(file).slice("lib/".length);
				return !rows.some((row) => row.includes(`](./${module})`));
			})
			.map((file) => `${relative(file)}: no table row in lib/README.md; a helper nobody can find gets written again`);
		expect(missing).toEqual([]);
	});
});

/**
 * The body rows of every table between `## What you get` and the next `## `, and
 * how many words each one holds. A separator row is punctuation, not a row.
 */
function catalogRows(markdown: string): string[] {
	const lines = markdown.split("\n");
	const start = lines.findIndex((line) => line.trim() === "## What you get");
	if (start < 0) return [];
	const end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
	return lines
		.slice(start, end < 0 ? undefined : end)
		.map((line) => line.trim())
		.filter((line) => line.startsWith("|") && !/^[\s|:-]+$/.test(line));
}

/** The words in one Markdown line, by the same split every budget here uses. */
function words(line: string): number {
	return line.split(/\s+/).filter(Boolean).length;
}

/**
 * A whole document's words, summed line by line through {@link words}: the doc ceilings
 * hold a file rather than a row, and a second split beside this one is how two counts
 * start to disagree.
 */
function documentWords(markdown: string): number {
	return markdown.split("\n").reduce((sum, line) => sum + words(line), 0);
}

/**
 * A path the doc cites: a code span with a `/` in it and a file extension. That is
 * narrower than "every filename it names" — a bare `package.json` is a filename
 * rather than a citation, and `docs/extensions/<name>.md` is a shape, so both are
 * left out; a span carrying an anchor is a link, which `test/doc-links.test.ts`
 * resolves. 23 spans cite a file today, over 20 distinct paths; the floor is the 20
 * distinct, and it may only fall.
 */
const CITED = /`([^`\n]*\/[^`\n]*\.(?:ts|json|md))`/g;
const CITED_FLOOR = 20;

/**
 * The distinct paths a document cites, each with the line it first appears on. A `Map`
 * rather than a tally of spans: one path cited twenty times is one piece of evidence,
 * which is what the floor counts, while a missing file still has a line to name.
 */
function citations(markdown: string): Map<string, number> {
	const paths = new Map<string, number>();
	for (const match of markdown.matchAll(CITED)) {
		const path = match[1] ?? "";
		if (/[<*#]/.test(path)) continue;
		if (!paths.has(path)) paths.set(path, markdown.slice(0, match.index).split("\n").length);
	}
	return paths;
}

describe("the entry README catalog", () => {
	/**
	 * The catalog is what a reader scans to pick an extension: a name, its commands,
	 * and one line about what it buys. `board`'s row reached 207 words once, holding
	 * a copy of `docs/extensions/board.md` in a table cell — this is the ratchet that
	 * keeps that copy from coming back. Both ceilings may only fall; lower each one
	 * when the page shrinks.
	 *
	 * Only the English README is measured. CJK words are not whitespace separated, so
	 * a word count over the mirror would be a number about nothing; the mirror's row
	 * count is held by `docs-parity.test.ts` and its length by review.
	 */
	const CATALOG_WORDS = 566;
	const ROW_WORDS = 35;

	const rows = catalogRows(readFileSync(join(repo, "README.md"), "utf-8"));

	test("measures the catalog, so a section renamed out from under it fails here", () => {
		expect(rows.length, "no table rows under `## What you get`").toBeGreaterThan(0);
	});

	test("keeps the catalog inside its word budget", () => {
		const total = rows.reduce((sum, row) => sum + words(row), 0);
		expect(total, "move the detail onto the extension's page and link it").toBeLessThanOrEqual(CATALOG_WORDS);
	});

	test("keeps every catalog row to one line", () => {
		const longest = rows.reduce((widest, row) => (words(row) > words(widest) ? row : widest), "");
		expect(words(longest), `the longest row: ${longest.slice(0, 60)}`).toBeLessThanOrEqual(ROW_WORDS);
	});
});

describe("the agent contract", () => {
	/**
	 * `AGENTS.md` is the entry point: the rules and their gates, with the reasoning in the
	 * guides it links. 981 words today, ceiling 981, and it may only fall: a new paragraph
	 * replaces one, and a trim lowers this number in the same commit, so the comment cannot
	 * go stale while the gate keeps headroom.
	 */
	const CEILING = 981;

	const source = readFileSync(join(repo, "AGENTS.md"), "utf-8");

	test("AGENTS.md holds its word ceiling", () => {
		expect(documentWords(source), "replace a paragraph rather than adding one, or move it into a guide").toBe(CEILING);
	});

	test("every file AGENTS.md cites is still a file", () => {
		const missing = [...citations(source)]
			.filter(([path]) => !existsSync(join(repo, path)))
			.map(([path, line]) => `AGENTS.md:${line}: ${path}`);
		expect(missing, "cite a file that exists, or say the shape instead").toEqual([]);
	});

	test("the citation floor counts distinct paths, so one repeated path cannot hold it", () => {
		// `cited++` ran per span once, so one path cited twenty-three times kept the floor
		// green while every other citation left the doc. A synthetic source, because the real
		// doc is the 23-over-20 case rather than this one.
		const repeated = Array.from({ length: CITED_FLOOR + 3 }, () => "`lib/lazy.ts`").join(" and ");
		expect(citations(repeated).size).toBe(1);
	});

	test("AGENTS.md cites enough distinct files to hold the floor", () => {
		expect(
			citations(source).size,
			"the doc lost a citation it had: restore it, or lower the floor with the doc",
		).toBeGreaterThanOrEqual(CITED_FLOOR);
	});
});

describe("the contributor guide", () => {
	/**
	 * `CONTRIBUTING.md` is where `AGENTS.md` points for the workflow, so it grows the way the
	 * entry doc did: one more caveat per gate, until the flow at the top is a wall nobody
	 * reads. 2357 words today, ceiling 2357, and it may only fall — a trim lowers this number
	 * in the same commit.
	 */
	const CEILING = 2357;

	test("CONTRIBUTING.md holds its word ceiling", () => {
		const source = readFileSync(join(repo, "CONTRIBUTING.md"), "utf-8");
		expect(documentWords(source), "move the detail into a guide and link it, then lower this ceiling").toBe(CEILING);
	});
});

/** One Markdown table, read by its header row so a column added to either is a loud failure. */
interface DocTable {
	headers: string[];
	rows: string[][];
}

/** A table row as cells: the pipes are the separators and the padding is not content. */
function cells(line: string): string[] {
	return line
		.trim()
		.replace(/^\|/, "")
		.replace(/\|$/, "")
		.split("|")
		.map((cell) => cell.trim());
}

/** The one table in `markdown` whose header row is exactly `headers`. */
function tableWith(markdown: string, headers: readonly string[]): DocTable | undefined {
	const lines = markdown.split("\n");
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index]?.trim() ?? "";
		if (!line.startsWith("|")) continue;
		const head = cells(line);
		if (head.length !== headers.length || head.some((cell, at) => cell !== headers[at])) continue;
		const rows: string[][] = [];
		// The separator row is punctuation; the body runs until the table ends.
		for (let next = index + 2; next < lines.length && (lines[next] ?? "").trim().startsWith("|"); next += 1) {
			rows.push(cells(lines[next] ?? ""));
		}
		return { headers: head, rows };
	}
	return undefined;
}

/** The name a table row opens with: the code span in its first cell. */
function nameOf(cell: string): string {
	return /^`([^`]+)`$/.exec(cell)?.[1] ?? cell;
}

/** The extension names a cell mentions, which is how a `Written by` cell is read. */
function extensionsIn(cell: string, known: ReadonlySet<string>): string[] {
	return [...cell.matchAll(/`([^`]+)`/g)]
		.map((match) => match[1] ?? "")
		.filter((text) => known.has(text))
		.sort();
}

/** A mode as a table spells it: `0700`, `0600`, or `—` for a path this package does not create. */
function modeCell(mode: number | undefined): string {
	return mode === undefined ? "—" : mode.toString(8).padStart(4, "0");
}

/**
 * What one table says that the registry does not, and the reverse.
 *
 * Kept apart from the docs case so the writer half can be held with a table that is wrong on
 * purpose: the real doc is right now, and a check that only ever sees a right table proves nothing.
 */
function registryDrift(table: DocTable, home: StorageHome, known: ReadonlySet<string>): string[] {
	const problems: string[] = [];
	const reserved = RESERVED_PATHS.filter((entry) => entry.home === home);
	const seen = new Set<string>();
	for (const row of table.rows) {
		const name = nameOf(row[0] ?? "");
		const entry = reserved.find((candidate) => candidate.name === name);
		if (entry === undefined) {
			problems.push(
				`${home}: \`${name}\` is documented and no code reserves it; add it to RESERVED_PATHS or drop the row`,
			);
			continue;
		}
		seen.add(name);
		const claimed = extensionsIn(row[2] ?? "", known).join(", ") || "nobody this package ships";
		const writes = [...entry.written].sort().join(", ") || "nobody this package ships";
		if (claimed !== writes) problems.push(`${home}: \`${name}\` is written by ${writes} and the row says ${claimed}`);
		const at = table.headers.indexOf("Mode");
		if (at >= 0) {
			const spelled = (row[at] ?? "").replaceAll("`", "");
			const wanted = modeCell(entry.mode);
			if (spelled !== wanted) problems.push(`${home}: \`${name}\` is created ${wanted} and the row says ${spelled}`);
		}
	}
	for (const entry of reserved) {
		// Pi's own names are documented in prose, not in a table this package keeps: the reverse
		// check is about the names a reader of OUR docs would take for ours.
		if (entry.owner === "pi" || seen.has(entry.name)) continue;
		problems.push(`${home}: \`${entry.name}\` is reserved and no row in the table names it`);
	}
	return problems;
}

describe("the reserved paths and the docs", () => {
	const source = readFileSync(join(repo, "docs", "configuration.md"), "utf-8");
	const known = new Set(dirsOf(extensionsDir));

	test("the project `.pi` table names every path either side writes", () => {
		const table = tableWith(source, ["Path", "Holds", "Written by", "Safe to delete"]);
		expect(table).toBeDefined();
		expect(registryDrift(table as DocTable, "project", known)).toEqual([]);
	});

	test("the agent-directory table names every store, its writer, and its mode", () => {
		const table = tableWith(source, ["Path", "Holds", "Written by", "Mode"]);
		expect(table).toBeDefined();
		expect(registryDrift(table as DocTable, "agent", known)).toEqual([]);
	});

	test("a row naming an extension the code does not have fails, not only a missing row", () => {
		// The defect this replaced: `.pi/agents` said `subagent` wrote it, while the subagent only
		// reads a trusted directory. A table that only checked "is every reserved name documented"
		// would have passed that row for the three years it was wrong.
		const wrong: DocTable = {
			headers: ["Path", "Holds", "Written by", "Mode"],
			rows: [["`agents/`", "agent definitions", "[`subagent`](./extensions/subagent.md)", "—"]],
		};
		expect(registryDrift(wrong, "agent", known)).toContain(
			"agent: `agents/` is written by nobody this package ships and the row says subagent",
		);
	});

	test("a documented name the code reserves nothing for fails", () => {
		const invented: DocTable = {
			headers: ["Path", "Holds", "Written by", "Mode"],
			rows: [
				["`board/`", "", "`board`", "0700"],
				["`theatre/`", "", "you", "—"],
			],
		};
		expect(registryDrift(invented, "agent", known)).toContain(
			"agent: `theatre/` is documented and no code reserves it; add it to RESERVED_PATHS or drop the row",
		);
	});
});
