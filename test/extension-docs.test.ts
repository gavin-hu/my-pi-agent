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
 * - a second copy of the doc creeping back into `extensions/<name>/README.md`,
 *   which is a signpost and must stay one line of prose.
 *
 * It loads every factory through the fake runtime for the same reason
 * `extension-load.test.ts` does: the registered surface is the fact a doc has to
 * match, not a list a contributor maintains twice.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { ROOT_TOOL_NAMES } from "../extensions/worktree/root-tools.ts";
import { ENV_DISABLED_EXTENSIONS } from "../lib/env.ts";
import { withAgentDir, withEnv } from "./helpers/env.ts";
import { createFakePi } from "./helpers/fakes.ts";

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

/** One page's `## Capabilities` section, from its heading to the next `##`. */
function capabilitiesOf(text: string): string {
	const lines = text.split("\n");
	const start = lines.findIndex((line) => HEADING.exec(line)?.[1] === "Capabilities");
	if (start === -1) return "";
	const end = lines.findIndex((line, at) => at > start && /^##\s/.test(line));
	return lines.slice(start + 1, end === -1 ? undefined : end).join("\n");
}

/** One table inside the capabilities section, as its rows of cells. */
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

/** The names a factory registers for the host to hold. */
async function surfaceOf(entry: string): Promise<{ tools: string[]; commands: string[] }> {
	const module = (await import(join(root, entry))) as { default?: (pi: unknown) => void };
	return await withAgentDir(async () =>
		withEnv({ [ENV_DISABLED_EXTENSIONS]: "" }, () => {
			const fake = createFakePi();
			module.default?.(fake.pi);
			// Pi's own path tools are re-registered by `worktree` to follow the active
			// root; they replace the model's tool rather than joining the surface.
			const overridden = new Set<string>(ROOT_TOOL_NAMES);
			return {
				tools: [...fake.tools.keys()].filter((name) => !overridden.has(name)),
				commands: [...fake.commands.keys()],
			};
		}),
	);
}

/** The page headings that are the template's own, and the surface ones among them. */
const SURFACE = new Set(["Tool", "Tools", "Commands", "Commands and flags", "Routes"]);
const FRONT = new Set([...SURFACE, "Behaviour by mode", "Configuration", "Security", "Limitations", "Non-goals"]);
const SUFFIX = ["Limitations", "Non-goals", "Pi integration", "Design notes", "Files", "Testing"];
const REQUIRED = ["Capabilities", "Quickstart", "Pi integration", "Design notes", "Files"];

/** The index page and one signpost per extension. */
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

	test("leaves a signpost in the extension directory, not a second copy", () => {
		const offenders = names.flatMap((name) => {
			const path = join(root, "extensions", name, "README.md");
			const text = readFileSync(path, "utf-8");
			const lines = text.split("\n").filter((line) => line.trim() !== "");
			const problems: string[] = [];
			if (lines.length > 3)
				problems.push(`${name}: ${lines.length} non-empty lines; the doc belongs in docs/extensions/`);
			if (/^##\s/m.test(text)) problems.push(`${name}: a section heading in the signpost`);
			if (!text.includes(`](../../docs/extensions/${name}.md)`)) problems.push(`${name}: no link to its doc`);
			return problems;
		});
		expect(offenders).toEqual([]);
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
			const section = capabilitiesOf(pageOf(name));
			const tables = tablesOf(section);
			expect(tables.length, "no capabilities table").toBeGreaterThan(0);

			for (const [at, table] of tables.entries()) {
				expect(table[0], `table ${at + 1}: the header`).toEqual(["Capability", "How", "What you get"]);
				const rows = table.slice(1);
				expect(rows.length, `table ${at + 1}: no rows`).toBeGreaterThan(0);
				for (const [row, cells] of rows.entries()) {
					expect([name, at + 1, row + 1, cells.length]).toEqual([name, at + 1, row + 1, 3]);
					const how = cells[1] ?? "";
					expect(how, `${name}: row ${row + 1} names no surface in backticks`).toMatch(/^automatic:|`[^`]+`/);
				}
			}
		});
	}
});

describe("the registered surface is in the capabilities", () => {
	for (const entry of manifest) {
		test(entry, async () => {
			const name = nameOf(entry);
			const section = capabilitiesOf(pageOf(name));
			const { tools, commands } = await surfaceOf(entry);

			const missingTools = tools.filter((tool) => !new RegExp(`\`[^\`]*\\b${tool}\\b[^\`]*\``).test(section));
			const missingCommands = commands.filter((command) => !section.includes(`\`/${command}`));
			expect({ tools: missingTools, commands: missingCommands }).toEqual({ tools: [], commands: [] });
		});
	}
});
