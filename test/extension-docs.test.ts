/**
 * Contract guard for the extension pages.
 *
 * Every page is written for a reader who uses the pack rather than changes it, so
 * this file holds what makes that a rule rather than a habit:
 *
 * - a page whose sections drift, so the thing a reader arrives for is no longer
 *   first, or which grows a contributor section back;
 * - a page that grows into a manual, past the length a short page can hold;
 * - a capability the extension ships but the page never names, because a tool or
 *   command was added and the page was not;
 * - a page that outgrows the index, or an extension whose page is a file beside
 *   the code instead of one page in `docs/extensions/`;
 * - a store under the agent directory with no page that says where it lives.
 *
 * It loads every factory through the fake runtime for the same reason
 * `extension-load.test.ts` does: the registered surface is the fact a page has to
 * match, not a list a contributor maintains twice.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "bun:test";
import { headingsOf, sectionOf, tablesOf } from "./helpers/docs.ts";
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

/** A page's text. */
function pageOf(name: string): string {
	return readFileSync(join(docsDir, `${name}.md`), "utf-8");
}

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

/**
 * The page: what the reader can do, how to try it, and one reference half under
 * it. The allowlist is the point — a contributor section cannot creep back in, and
 * a page cannot grow back into a manual, without failing here.
 */
const USER_SECTIONS = ["What you can do", "Try it", "Reference", "Limits", "Settings", "Learn more"];

/** A page stays short; the walkthrough belongs in `docs/tutorials/`. */
const USER_PAGE_LINES = 120;

describe("the end-user template", () => {
	for (const name of names) {
		test(`${name}.md`, () => {
			const text = pageOf(name);
			const headings = headingsOf(text);

			expect(text.startsWith(`# ${name} — `), "the title names the extension").toBe(true);
			expect(headings[0], "what the reader can do comes first").toBe("What you can do");
			expect(headings[1], "then how to try it").toBe("Try it");
			expect(headings, "the page sends the reader onward").toContain("Learn more");

			expect(
				headings.filter((heading) => !USER_SECTIONS.includes(heading)),
				"a contributor section crept back in",
			).toEqual([]);
			const order = headings.map((heading) => USER_SECTIONS.indexOf(heading));
			expect(order, "the sections are out of order").toEqual([...order].sort((left, right) => left - right));

			const table = tablesOf(sectionOf(text, "What you can do"))[0] ?? [];
			expect(table[0], "the table says what the reader wants and what to do").toEqual(["What you want", "What to do"]);
			expect(table.length, "the table has at least one row").toBeGreaterThan(1);

			const learnMore = sectionOf(text, "Learn more");
			expect(learnMore, "a link onward").toMatch(/\]\(\.{1,2}\/[^)\s]+\.md\)/);

			expect(
				text.split("\n").length,
				"a rewritten page stays short; the walkthrough lives in docs/tutorials",
			).toBeLessThanOrEqual(USER_PAGE_LINES);
		});
	}
});

describe("the registered surface is on the page", () => {
	for (const entry of manifest) {
		test(entry, async () => {
			const text = pageOf(nameOf(entry));
			const { tools, commands } = await registeredSurface(entry);

			const missingTools = tools.filter((tool) => !new RegExp(`\`[^\`]*\\b${tool}\\b[^\`]*\``).test(text));
			const missingCommands = commands.filter((command) => !text.includes(`\`/${command}`));
			expect({ tools: missingTools, commands: missingCommands }).toEqual({ tools: [], commands: [] });
		});
	}
});

/**
 * One place a module puts state under the agent directory, and what the page says about it.
 *
 * The row is the location as the tree spells it; `page` is the page that must name it,
 * empty for a `lib/` store whose row is in `lib/README.md`; `names` is the literal the
 * module itself has to still contain, so a moved directory fails here rather than in a
 * reader's terminal.
 */
interface StoreRow {
	/** The location, written the way the extension pages write it. */
	location: string;
	/** The page that names the location in the reader's spelling; empty for `lib/`. */
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
		// Prose is where the spelling drifted: every sweep fixed the page it was reading
		// and left `<agentDir>` in the rest, because only a store row was ever checked. A
		// page says `~/.pi/agent/…`; a row or a comment says `<agent-dir>/…`.
		const scanned = ["docs", "extensions", "lib", "scripts", "skills"].flatMap((directory) =>
			walkFiles(join(root, directory)),
		);
		const offenders = scanned
			.filter((file) => file.endsWith(".md") || file.endsWith(".ts"))
			.filter((file) => readFileSync(file, "utf-8").includes("<agentDir>"))
			.map((file) => relative(root, file));
		expect(offenders, "write `<agent-dir>` in a row or a comment, `~/.pi/agent` in a page").toEqual([]);
	});

	test("names each store's location on its page", () => {
		// A page has no Files table to carry the row, so it says where the store lives in
		// the reader's own spelling: `~/.pi/agent/…`.
		const missing: string[] = [];
		for (const store of STORES) {
			if (store.page === "") continue;
			const spelled = store.location.replace("<agent-dir>/", "~/.pi/agent/");
			if (!pageOf(store.page.replace(/\.md$/, "")).includes(spelled)) {
				missing.push(`${store.page}: the page never says ${spelled}`);
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
