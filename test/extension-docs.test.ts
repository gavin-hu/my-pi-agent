/**
 * Contract guard for the extension docs.
 *
 * The template lives in `docs/development.md#one-doc-per-extension`; this file
 * is what makes it a rule rather than a habit. Three failures it is built for:
 *
 * - a page whose sections drift back out of order, so the thing a reader arrives
 *   for — the capabilities — is no longer first;
 * - a capability the extension ships but the page never names, because a tool was
 *   added and its row was not;
 * - a Files row the tree has outgrown: a module with no row, or a row naming a file
 *   that is gone, which is how a page keeps describing a tree that no longer exists;
 * - a second copy of the doc creeping back beside the code: the `extensions/`
 *   tree holds code and tests only, and this file is what keeps it that way.
 *
 * It loads every factory through the fake runtime for the same reason
 * `extension-load.test.ts` does: the registered surface is the fact a doc has to
 * match, not a list a contributor maintains twice.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import { registeredSurface } from "./helpers/surface.ts";

const root = join(import.meta.dir, "..");
const docsDir = join(root, "docs", "extensions");

/** The extension entry files the package manifest declares. */
const manifest: string[] = JSON.parse(readFileSync(join(root, "package.json"), "utf-8")).pi.extensions;

/** An extension's name, from its manifest entry: `./extensions/todo/index.ts` → `todo`. */
function nameOf(entry: string): string {
	return entry.split("/")[2] ?? entry;
}

const names = manifest.map(nameOf).sort();

/** A page's text, with its heading list read the way GitHub renders it. */
function pageOf(name: string): string {
	return readFileSync(join(docsDir, `${name}.md`), "utf-8");
}

const HEADING = /^##\s+(.+?)\s*$/;
const FENCE = /^\s*(?:```|~~~)/;

/** The `##` headings of a page, in order, ignoring fenced code. */
function headingsOf(text: string): string[] {
	const headings: string[] = [];
	let fenced = false;
	for (const line of text.split("\n")) {
		if (FENCE.test(line)) {
			fenced = !fenced;
			continue;
		}
		const heading = fenced ? null : HEADING.exec(line)?.[1];
		if (heading !== undefined && heading !== null) headings.push(heading);
	}
	return headings;
}

/** One page's `## <heading>` section, from its heading to the next `##`. */
function sectionOf(text: string, heading: string): string {
	const lines = text.split("\n");
	const start = lines.findIndex((line) => HEADING.exec(line)?.[1] === heading);
	if (start === -1) return "";
	const end = lines.findIndex((line, at) => at > start && /^##\s/.test(line));
	return lines.slice(start + 1, end === -1 ? undefined : end).join("\n");
}

/** The paths a Files row's first cell names: a link's target, else its files. */
function fileTargetsOf(cell: string): string[] {
	const linked = /\[[^\]]*\]\(([^)]+)\)/.exec(cell)?.[1];
	if (linked !== undefined) return [linked];
	// A page groups rows two ways — `a.ts / b.ts`, and `` `a.ts`, `b.ts` `` — so a
	// path with a directory in it (`search/tool.ts`) is never split.
	return cell
		.split(/\s*,\s*|\s+\/\s+/)
		.map((part) => part.replaceAll("`", "").trim())
		.filter((part) => part !== "");
}

/**
 * Whether a Files row names something on disk.
 *
 * An extension's own module is written bare and resolves inside `extensions/<name>/`,
 * while the shared module it leans on is written as a link or a `lib/` path and
 * resolves from the repository root.
 */
function namesAFile(target: string, name: string): boolean {
	const fromRoot = target.startsWith("../") || target.startsWith("lib/") || target.startsWith("extensions/");
	const candidates = fromRoot
		? [resolve(docsDir, target), resolve(root, target)]
		: [resolve(root, "extensions", name, target), resolve(root, target)];
	return candidates.some((path) => existsSync(path));
}

/** One table inside a section, as its rows of cells. */
function tablesOf(section: string): string[][][] {
	const blocks: string[][] = [];
	let current: string[] = [];
	for (const line of section.split("\n")) {
		if (line.startsWith("|")) current.push(line);
		else if (current.length > 0) {
			blocks.push(current);
			current = [];
		}
	}
	if (current.length > 0) blocks.push(current);
	// A cell may hold an escaped pipe (`[off\\|wake]`), which the renderer does not
	// treat as a column break, so neither does this.
	return blocks.map((block) =>
		block
			.filter((line) => !/^\|[\s|:-]+\|$/.test(line))
			.map((line) =>
				line
					.replaceAll("\\|", "\u0000")
					.split("|")
					.slice(1, -1)
					.map((cell) => cell.replaceAll("\u0000", "|").trim()),
			),
	);
}

/** The page headings that are the template's own, and the surface ones among them. */
const SURFACE = new Set(["Tool", "Tools", "Commands", "Commands and flags", "Routes"]);
const FRONT = new Set([...SURFACE, "Behaviour by mode", "Configuration", "Security", "Limitations", "Non-goals"]);
const SUFFIX = ["Limitations", "Non-goals", "Pi integration", "Design notes", "Files", "Testing"];
const REQUIRED = ["Capabilities", "Quickstart", "Pi integration", "Design notes", "Files"];
/** An optional fourth column; a page uses it only when a capability is unreleased. */
const STATUSES = new Set(["Shipped", "Unreleased", "Partial"]);

/** The index page, and a Markdown-free extension tree. */
describe("the extension doc set", () => {
	test("has one page per manifest extension, and no orphan page", () => {
		const pages = [...new Bun.Glob("*.md").scanSync(docsDir)]
			.filter((file) => file !== "README.md")
			.map((file) => file.slice(0, -3))
			.sort();
		expect(pages).toEqual(names);
	});

	test("lists every page in the index", () => {
		const index = readFileSync(join(docsDir, "README.md"), "utf-8");
		const missing = names.filter((name) => !index.includes(`](./${name}.md)`));
		expect(missing, "a doc the index does not list").toEqual([]);
	});

	test("keeps the extension tree free of Markdown", () => {
		const pages = [...new Bun.Glob("**/*.md").scanSync(join(root, "extensions"))].sort();
		expect(pages, "an extension's doc is docs/extensions/<name>.md, not a file beside the code").toEqual([]);
	});
});

describe("the template every page follows", () => {
	for (const name of names) {
		test(`${name}.md`, () => {
			const text = pageOf(name);
			const headings = headingsOf(text);

			expect(headings[0], "the capabilities come first").toBe("Capabilities");
			expect(headings[1], "then the quickstart").toBe("Quickstart");
			expect(text.startsWith(`# ${name} — `), "the title names the extension").toBe(true);

			for (const heading of REQUIRED) expect(headings, `missing ## ${heading}`).toContain(heading);

			// The surface sections sit between the quickstart and the deep dives.
			const surface = headings.map((heading, at) => (SURFACE.has(heading) ? at : -1)).filter((at) => at !== -1);
			expect(surface.length, "no tool or command section").toBeGreaterThan(0);
			const firstFront = headings.findIndex((heading) => FRONT.has(heading) && !SURFACE.has(heading));
			const lastSurface = surface.at(-1) ?? 0;
			if (firstFront !== -1) expect(lastSurface, "a surface section after the deep dives").toBeLessThan(firstFront);

			// Behaviour, configuration, and security keep their relative order.
			const optional = headings.map((heading, at) =>
				["Behaviour by mode", "Configuration", "Security"].includes(heading) ? at : -1,
			);
			const present = optional.filter((at) => at !== -1);
			expect(present, "behaviour, configuration, and security are out of order").toEqual(
				[...present].sort((a, b) => a - b),
			);

			// The contributor sections come last, in the template's order, with no deep
			// dive after them.
			const suffix = headings.map((heading, at) => (SUFFIX.includes(heading) ? at : -1)).filter((at) => at !== -1);
			const spelled = suffix.map((at) => headings[at]);
			expect(spelled, "the contributor sections are out of order").toEqual(
				SUFFIX.filter((heading) => spelled.includes(heading)),
			);
			const firstSuffix = suffix[0] ?? headings.length;
			const afterPi = headings.slice(headings.indexOf("Pi integration") + 1);
			expect(
				afterPi.filter((heading) => !SUFFIX.includes(heading)),
				"a deep dive after the contract",
			).toEqual([]);
			// A surface heading never follows the first contributor heading either.
			expect(
				surface.filter((at) => at > firstSuffix),
				"a surface section after Limitations",
			).toEqual([]);
		});
	}
});

describe("the capabilities table", () => {
	for (const name of names) {
		test(`${name}.md`, () => {
			const section = sectionOf(pageOf(name), "Capabilities");
			const tables = tablesOf(section);
			expect(tables.length, "no capabilities table").toBeGreaterThan(0);

			for (const [at, table] of tables.entries()) {
				const header = table[0] ?? [];
				const hasStatus = header.length === 4 && header[3] === "Status";
				expect(header, `table ${at + 1}: the header`).toEqual(
					hasStatus ? ["Capability", "How", "What you get", "Status"] : ["Capability", "How", "What you get"],
				);
				const rows = table.slice(1);
				expect(rows.length, `table ${at + 1}: no rows`).toBeGreaterThan(0);
				for (const [row, cells] of rows.entries()) {
					expect([name, at + 1, row + 1, cells.length]).toEqual([name, at + 1, row + 1, header.length]);
					const how = cells[1] ?? "";
					expect(how, `${name}: row ${row + 1} names no surface in backticks`).toMatch(/^automatic:|`[^`]+`/);
					if (hasStatus) {
						expect(STATUSES, `${name}: row ${row + 1} has an unknown status`).toContain(cells[3] ?? "");
					}
				}
			}
		});
	}
});

describe("the registered surface is in the capabilities", () => {
	for (const entry of manifest) {
		test(entry, async () => {
			const name = nameOf(entry);
			const section = sectionOf(pageOf(name), "Capabilities");
			const { tools, commands } = await registeredSurface(entry);

			const missingTools = tools.filter((tool) => !new RegExp(`\`[^\`]*\\b${tool}\\b[^\`]*\``).test(section));
			const missingCommands = commands.filter((command) => !section.includes(`\`/${command}`));
			expect({ tools: missingTools, commands: missingCommands }).toEqual({ tools: [], commands: [] });
		});
	}
});

describe("the Files table", () => {
	for (const name of names) {
		test(`${name}.md`, () => {
			const rows = (tablesOf(sectionOf(pageOf(name), "Files"))[0] ?? []).slice(1);
			// Only the first column: a module named in a responsibility sentence is
			// not a row, and would hide the one next to it that is missing.
			const named = rows.map((row) => row[0] ?? "").join("\n");

			const modules = readdirSync(join(root, "extensions", name)).filter(
				(file) => file.endsWith(".ts") && !file.endsWith(".test.ts"),
			);
			const unnamed = modules.filter((file) => !new RegExp(`\\b${file.replaceAll(".", "\\.")}\\b`).test(named));
			expect(unnamed, "a module with no Files row").toEqual([]);

			const broken = rows.flatMap((row) => fileTargetsOf(row[0] ?? "")).filter((target) => !namesAFile(target, name));
			expect(broken, "a Files row naming no file or directory").toEqual([]);
		});
	}
});
