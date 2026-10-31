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
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, test } from "bun:test";
import { walkFiles } from "./helpers/files.ts";
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

/** Every module under `extensions/<name>/`, as paths relative to the extension. */
function modulesOf(name: string): string[] {
	const walk = (directory: string, prefix: string): string[] =>
		readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
			const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
			if (entry.isDirectory()) return walk(join(directory, entry.name), relative);
			if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) return [];
			return [relative];
		});
	// Recursive on purpose: a nested module is the one a table forgets, because the
	// page's prose keeps talking about the directory it lives in.
	return walk(join(root, "extensions", name), "").sort();
}

describe("the Files table", () => {
	for (const name of names) {
		test(`${name}.md`, () => {
			const rows = (tablesOf(sectionOf(pageOf(name), "Files"))[0] ?? []).slice(1);
			// Only the first column: a module named in a responsibility sentence is
			// not a row, and would hide the one next to it that is missing.
			const extensionDir = resolve(root, "extensions", name);
			// Coverage is by target, not by text: a row names a file — written bare, or as a
			// link into the tree — or a directory it groups (`tools/`, whose modules the next
			// cell lists). Matching the cell for a file name instead would let `web-write.ts`
			// cover `tools/write.ts`, and would miss a grouped row that names its modules in
			// prose.
			const local = rows
				.flatMap((row) => fileTargetsOf(row[0] ?? ""))
				.map((target) => {
					// Containment is compared with the platform's own separator: `resolve` builds a
					// native path, and a literal "/" made every row look like it named nothing on
					// Windows, where the whole table then read as unrowed.
					const inside = [resolve(extensionDir, target), resolve(docsDir, target)].find(
						(path) => path.startsWith(extensionDir + sep) && existsSync(path),
					);
					return inside
						?.slice(extensionDir.length + 1)
						.replaceAll("\\", "/")
						.replace(/\/+$/, "");
				})
				.filter((target): target is string => target !== undefined && target !== "");
			const unnamed = modulesOf(name).filter((module) => {
				if (local.includes(module)) return false;
				return !local.some((target) => module.startsWith(`${target}/`));
			});
			expect(unnamed, "a module with no Files row").toEqual([]);

			const broken = rows.flatMap((row) => fileTargetsOf(row[0] ?? "")).filter((target) => !namesAFile(target, name));
			expect(broken, "a Files row naming no file or directory").toEqual([]);
		});
	}
});

describe("the Testing section names suites that exist", () => {
	/** A token the section writes as a suite stem: lowercase, hyphenated, with a path. */
	const STEM = /^[a-z][a-z0-9-]*(?:\/[a-z0-9-]+)+$/;

	for (const name of names) {
		test(`${name}.md`, () => {
			// Backticked tokens with a slash, and only those: a bare `chrome` reads the same
			// as a word, while a stale stem without one is what a consolidation leaves
			// behind — `footer/render/format` after the footer's one suite absorbed it.
			const stems = [...sectionOf(pageOf(name), "Testing").matchAll(/`([^`]+)`/g)]
				.map((match) => match[1] ?? "")
				.filter((token) => STEM.test(token));
			const missing = stems.filter((stem) => !existsSync(join(root, "extensions", name, `${stem}.test.ts`)));
			expect(missing, "a Testing stem with no suite").toEqual([]);
		});
	}
});

/**
 * One place a module puts state under the agent directory, and what the page says about it.
 *
 * The row is the location as a page spells it; `page` is the page whose Files row must name
 * it; `names` is the literal the module itself has to still contain, so a moved directory
 * fails here rather than in a reader's terminal. `lib/`'s stores carry no `page`: their row
 * is in `lib/README.md`, so they are declared here for the ratchet and checked on the code.
 */
interface StoreRow {
	/** The location, written the way the extension pages write it. */
	location: string;
	/** The page whose Files row for this module must name the location; empty for `lib/`. */
	page: string;
	/** The module that decides where it goes, relative to the repository root. */
	module: string;
	/** The directory or file name, as the code spells it. */
	names: string;
	/** A second module that spells the name, when the first joins its constant. */
	constantsIn?: string;
}

/** The modules that own a location under the agent directory. */
const STORES: readonly StoreRow[] = [
	{
		location: "<agent-dir>/plans/",
		page: "plan.md",
		module: "extensions/plan/plans.ts",
		constantsIn: "lib/plans/paths.ts",
		names: "plans",
	},
	{
		location: "<agent-dir>/subagents/",
		page: "subagent.md",
		module: "extensions/subagent/transcripts.ts",
		names: "subagents",
	},
	{ location: "<agent-dir>/memory.md", page: "memory.md", module: "extensions/memory/store.ts", names: "memory.md" },
	{
		location: "<agent-dir>/session-bus/<repo-key>/",
		page: "session-bus.md",
		module: "extensions/session-bus/runtime.ts",
		constantsIn: "lib/session-roster.ts",
		names: "session-bus",
	},
	{
		location: "<agent-dir>/wechat/",
		page: "wechat.md",
		module: "extensions/wechat/state/credentials.ts",
		names: "wechat",
	},
	{ location: "<agent-dir>/jobs/<project>/", page: "job.md", module: "extensions/job/registry.ts", names: "jobs" },
	{
		location: "<agent-dir>/bytefly/update.json",
		page: "bytefly.md",
		module: "extensions/bytefly/update/cache.ts",
		names: "update.json",
	},
	{ location: "<agent-dir>/board/<repo-key>/", page: "", module: "lib/board/store.ts", names: "board" },
	{ location: "<agent-dir>/bytefly.json", page: "", module: "lib/config.ts", names: "bytefly.json" },
];

/**
 * Modules that read the agent directory without owning a place in it.
 *
 * This is the ratchet: a module that starts anchoring a path on the agent directory is
 * either a store row or listed here with a reason, so a new store cannot ship unannounced.
 */
const READS_AGENT_DIR = new Map<string, string>([
	["extensions/bytefly/doctor/runtime.ts", "probes what the health report lists"],
	["extensions/bytefly/panel/commands.ts", "opens the settings screen over Pi's own file"],
	["extensions/bytefly/panel/settings-runtime.ts", "reads and writes Pi's own settings"],
	["extensions/bytefly/picker/discovery.ts", "finds installed packages in the agent directory"],
	["extensions/bytefly/picker/resources.ts", "reads a package's own metadata"],
	["extensions/bytefly/picker/toggle.ts", "writes Pi's own settings through the host"],
	["extensions/bytefly/footer/register.ts", "hands the agent directory to the label follower"],
	["extensions/bytefly/update/check.ts", "asks the package manager what is installed"],
	["extensions/bytefly/update/register.ts", "wires the update check to the cache"],
	["extensions/subagent/agents.ts", "reads the agent definitions Pi ships"],
	["extensions/wechat/commands/commands.ts", "opens the bridge's own directory for its report"],
	["extensions/wechat/index.ts", "hands the agent directory to the bridge"],
	["extensions/worktree/config.ts", "owns a location in the checkout, not one under the agent directory"],
	[
		"lib/board/session.ts",
		"derives the bus directory a card's owner is read from, and the plan store a plan is proved against",
	],
	["lib/requirements.ts", "checks the state files doctor reports on"],
]);

/** Every non-test module under `directory`, relative to the repository root. */
function modulesIn(directory: string): string[] {
	return readdirSync(join(root, directory), { withFileTypes: true }).flatMap((entry) => {
		const path = `${directory}/${entry.name}`;
		if (entry.isDirectory()) return modulesIn(path);
		if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) return [];
		return [path];
	});
}

describe("the stores under the agent directory", () => {
	/** The row a page gives a module, as its cells, or undefined when it has none. */
	function rowOf(file: string, module: string): string[] | undefined {
		const stem = module.replace(/^extensions\/[^/]+\//, "");
		const rows = (tablesOf(sectionOf(pageOf(file.replace(/\.md$/, "")), "Files"))[0] ?? []).slice(1);
		return rows.find((row) => fileTargetsOf(row[0] ?? "").some((target) => target === stem));
	}

	test("declares every module that anchors on the agent directory", () => {
		const anchored = [...modulesIn("extensions"), ...modulesIn("lib")]
			.filter((module) => /getAgentDir|CONFIG_DIR_NAME/.test(readFileSync(join(root, module), "utf-8")))
			.sort();
		// A scan that stopped matching would make the ratchet vacuous.
		expect(anchored.length).toBeGreaterThan(10);
		const declared = new Set([
			...STORES.flatMap((store) => [store.module, store.constantsIn].filter((file) => file !== undefined)),
			...READS_AGENT_DIR.keys(),
		]);
		expect(
			anchored.filter((module) => !declared.has(module)),
			"a module anchoring on the agent directory with no store row and no reader entry",
		).toEqual([]);
	});

	test("spells an agent-directory location one way", () => {
		// The rule in `docs/development.md` is one spelling, and prose is where it drifted:
		// three sweeps each fixed the page they were reading and left `<agentDir>` in the rest,
		// because only a store row was ever checked. This reads every page and every comment.
		const scanned = ["docs", "extensions", "lib", "scripts", "skills"].flatMap((directory) =>
			walkFiles(join(root, directory)),
		);
		const offenders = scanned
			.filter((file) => file.endsWith(".md") || file.endsWith(".ts"))
			.filter((file) => readFileSync(file, "utf-8").includes("<agentDir>"))
			.map((file) => relative(root, file));
		expect(offenders, "write `<agent-dir>`").toEqual([]);
	});

	test("names each store's location in the Files row for its module", () => {
		const missing: string[] = [];
		for (const store of STORES) {
			if (store.page === "") continue;
			const row = rowOf(store.page, store.module);
			if (row === undefined) {
				missing.push(`${store.page}: no Files row for ${store.module}`);
				continue;
			}
			if (!row.join(" ").includes(store.location)) {
				missing.push(`${store.page}: ${store.module} row omits ${store.location}`);
			}
		}
		expect(missing, "a store whose page does not say where it lives").toEqual([]);
	});

	test("keeps each store under the name its own module spells", () => {
		const problems: string[] = [];
		for (const store of STORES) {
			const sources = [store.module, ...(store.constantsIn === undefined ? [] : [store.constantsIn])];
			const missing = sources.filter((file) => !existsSync(join(root, file)));
			if (missing.length > 0) {
				problems.push(`${store.location}: ${missing.join(", ")} does not exist`);
				continue;
			}
			// Any source: a module often joins a constant the shared module spells.
			if (!sources.some((file) => readFileSync(join(root, file), "utf-8").includes(store.names))) {
				problems.push(`${store.location}: ${sources.join(", ")} no longer names ${store.names}`);
			}
		}
		expect(problems, "a store whose module no longer spells its location").toEqual([]);
	});
});
