/**
 * Contract guard between `docs/user-guide/reference.md` and the surface it claims.
 *
 * The reference is the guide's lookup table, and every one of its cells is a fact
 * the package already knows: which commands are registered, what each extension
 * contributes, which flags and environment variables exist, and where the pack
 * writes. Nothing compared the two, and four audit cards in a row found the same
 * drift by hand — a command the tables had never listed, a store path that no
 * module wrote any more.
 *
 * So each table is derived here, not read: the extension load collects the
 * registrations per manifest entry, `lib/env.ts` supplies the environment
 * variables, `skills/` supplies the skill commands Pi synthesizes, and the places
 * the pack writes are declared against the module that builds each one — with a
 * scan of the modules that anchor a path on the agent directory as the ratchet
 * that makes a new store declare itself. A fact that cannot be derived is declared
 * below with its reason, so leaving one out is a reviewed decision rather than an
 * oversight.
 *
 * The one thing this module does not check is prose: a row's *description* is the
 * guide's own writing, and the links are `structure.test.ts`'s.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "bun:test";
import { SHARED_CONFIG_FILE } from "../lib/config.ts";
import { ENV_DISABLED_EXTENSIONS, ENV_OFFLINE, ENV_ROOT } from "../lib/env.ts";
import { boardDirFor } from "../lib/board/store.ts";
import { BUS_DIR_NAME } from "../lib/session-roster.ts";
import { ROOT_TOOL_NAMES } from "../extensions/worktree/root-tools.ts";
import { updateCachePath } from "../extensions/bytefly/update/cache.ts";
import { registryDirFor } from "../extensions/job/registry.ts";
import { projectMemoryPath } from "../extensions/memory/store.ts";
import { DEFAULT_CONFIG as REWIND } from "../extensions/rewind/config/config.ts";
import { DEFAULT_CONFIG as WORKTREE } from "../extensions/worktree/config.ts";
import { wechatDir } from "../extensions/wechat/state/credentials.ts";
import { walkFiles, posix } from "./helpers/files.ts";
import { withAgentDir, withEnv } from "./helpers/env.ts";
import { createFakePi } from "./helpers/fakes.ts";

const root = join(import.meta.dir, "..");
const referenceFile = join(root, "docs", "user-guide", "reference.md");
const reference = readFileSync(referenceFile, "utf-8");

/** The extension entry files the package manifest declares. */
const manifest: string[] = JSON.parse(readFileSync(join(root, "package.json"), "utf-8")).pi.extensions;

/** What one extension registered, by the names the host will hold. */
interface Registered {
	tools: Set<string>;
	commands: Set<string>;
	flags: Set<string>;
	shortcuts: Set<string>;
}

/** Load every manifest extension and keep what each one registered, by entry. */
async function registrationsByEntry(): Promise<Map<string, Registered>> {
	const byEntry = new Map<string, Registered>();
	for (const entry of manifest) {
		const module = (await import(join(root, entry))) as { default?: (pi: unknown) => void };
		expect(typeof module.default, entry).toBe("function");
		const registered: Registered = {
			tools: new Set(),
			commands: new Set(),
			flags: new Set(),
			shortcuts: new Set(),
		};
		// A temp agent directory per extension, so no factory reads or writes the real
		// one, and no inherited disabled list, so every factory registers.
		await withAgentDir(async () => {
			await withEnv({ [ENV_DISABLED_EXTENSIONS]: "" }, () => {
				const fake = createFakePi();
				module.default?.(fake.pi);
				for (const name of fake.tools.keys()) registered.tools.add(name);
				for (const name of fake.commands.keys()) registered.commands.add(name);
				for (const name of fake.flags.keys()) registered.flags.add(name);
				for (const name of fake.shortcuts.keys()) registered.shortcuts.add(name);
			});
		});
		byEntry.set(entry, registered);
	}
	return byEntry;
}

/** The load runs once: every check below reads the same registration result. */
let surfacePromise: Promise<Map<string, Registered>> | undefined;

function surface(): Promise<Map<string, Registered>> {
	surfacePromise ??= registrationsByEntry();
	return surfacePromise;
}

/** The extension name a manifest entry names: `./extensions/<name>/index.ts`. */
function entryName(entry: string): string {
	return entry.split("/")[2] ?? entry;
}

/** One Markdown table's body rows, cells split on unescaped pipes. */
function tableRows(section: string): string[][] {
	const rows: string[][] = [];
	for (const line of section.split("\n")) {
		if (!line.startsWith("|")) continue;
		const cells = line
			.slice(1, line.endsWith("|") ? -1 : undefined)
			.split(/(?<!\\)\|/)
			.map((cell) => cell.trim());
		// The header and the `|---|---|` rule are not facts.
		if (cells.every((cell) => /^:?-+:?$/.test(cell))) continue;
		if (cells[0] === "Command" || cells[0] === "Entry" || cells[0] === "Extension") continue;
		if (cells[0] === "Location" || cells[0] === "Key" || cells[0] === "Pi command") continue;
		rows.push(cells);
	}
	return rows;
}

/** One `##` section's text, up to the next `##`. */
function sectionOf(heading: string): string {
	const start = reference.indexOf(`\n## ${heading}\n`);
	if (start < 0) throw new Error(`docs/user-guide/reference.md has no "## ${heading}" section`);
	const body = reference.slice(start + 1);
	const end = body.indexOf("\n## ", 1);
	return end < 0 ? body : body.slice(0, end);
}

/** One `###` subsection's text, up to the next `###` or `##`. */
function subsection(heading: string): string {
	const start = reference.indexOf(`\n### ${heading}\n`);
	if (start < 0) throw new Error(`docs/user-guide/reference.md has no "### ${heading}" section`);
	const body = reference.slice(start + 1);
	const end = body.indexOf("\n### ", 1);
	const next = end < 0 ? -1 : end;
	const level = body.indexOf("\n## ", 1);
	const stop = [next, level].filter((index) => index >= 0).sort((a, b) => a - b)[0] ?? body.length;
	return body.slice(0, stop);
}

/** Every `/name` a command cell names, so `A <x>` / `B` counts as two. */
function commandNames(cell: string): string[] {
	const names: string[] = [];
	for (const part of cell.split(" / ")) {
		const match = /^`(\/[a-z:-]+)(?:\s|`)/.exec(part.trim());
		if (match?.[1] !== undefined) names.push(match[1].slice(1));
	}
	return names;
}

/** Every backticked name in a cell, in order — a tool list, or a command and flag list. */
function backticked(cell: string): string[] {
	return [...cell.matchAll(/`([^`]+)`/g)].flatMap((match) => (match[1] === undefined ? [] : [match[1]]));
}

/** Every packaged skill's name, which is what Pi turns into `/skill:<name>`. */
function skillNames(): string[] {
	return readdirSync(join(root, "skills"))
		.filter((name) => statSync(join(root, "skills", name)).isDirectory())
		.sort();
}

/**
 * The one shortcut the pack binds, by registered form, and the row that documents it.
 *
 * A shortcut is a key rather than a command, so it sits in the plan table as
 * `Ctrl+Alt+P` and in the harness as `ctrl+alt+p`.
 */
const SHORTCUT_ROWS = new Map([["ctrl+alt+p", "Ctrl+Alt+P"]]);

describe("the command tables list what is registered", () => {
	/** The command rows, from `## Commands` up to Pi's own commands. */
	function commandRows(): string[][] {
		const commands = sectionOf("Commands");
		const own = commands.indexOf("\n### Pi's own commands");
		return tableRows(own < 0 ? commands : commands.slice(0, own));
	}

	test("names every registered command, and nothing else", async () => {
		const registered = [...(await surface()).values()].flatMap((entry) => [...entry.commands]);
		// A loader that registered nothing would make both assertions vacuous.
		expect(registered.length).toBeGreaterThan(0);

		const skills = new Set(skillNames().map((name) => `skill:${name}`));
		const documented = new Set<string>();
		const unknown: string[] = [];
		for (const row of commandRows()) {
			const cell = row[0] ?? "";
			// A key is not a command: the launch suite holds the shortcut to its binding.
			if (SHORTCUT_ROWS.has(cell.replaceAll("`", "").toLowerCase())) continue;
			for (const name of commandNames(cell)) {
				if (skills.has(name)) continue;
				if (registered.includes(name)) documented.add(name);
				else unknown.push(`/${name}`);
			}
		}
		expect(unknown, "docs/user-guide/reference.md documents a command nothing registers").toEqual([]);

		const missing = registered.filter((name) => !documented.has(name)).sort();
		expect(missing, "a registered command the reference does not list").toEqual([]);
	});

	test("lists a skill row for every packaged skill", async () => {
		const rows = new Set(commandRows().flatMap((row) => commandNames(row[0] ?? "")));
		const missing = skillNames()
			.map((name) => `skill:${name}`)
			.filter((name) => !rows.has(name));
		expect(missing, "a packaged skill with no `/skill:` row").toEqual([]);
	});
});

describe("the extension table is the manifest, extension by extension", () => {
	/** One row of `## Extensions and tools`, as the three facts it states. */
	function rows(): Map<string, { tools: Set<string>; commands: Set<string>; flags: Set<string> }> {
		const parsed = new Map<string, { tools: Set<string>; commands: Set<string>; flags: Set<string> }>();
		for (const row of tableRows(sectionOf("Extensions and tools"))) {
			const name = backticked(row[0] ?? "")[0];
			if (name === undefined) continue;
			const commands = backticked(row[2] ?? "")
				.filter((value) => value.startsWith("/"))
				.map((value) => value.split(/\s+/)[0] ?? value);
			const flags = backticked(row[2] ?? "").filter((value) => value.startsWith("--"));
			parsed.set(name, {
				tools: new Set(backticked(row[1] ?? "")),
				commands: new Set(commands.map((value) => value.slice(1))),
				flags: new Set(flags.map((value) => value.slice(2))),
			});
		}
		return parsed;
	}

	test("gives every extension in the manifest one row, and no other", () => {
		const expected = manifest.map(entryName).sort();
		expect([...rows().keys()].sort()).toEqual(expected);
	});

	test("states the tools, commands, and flags each extension registers", async () => {
		const registered = await surface();
		// `worktree` re-registers Pi's path tools, which are replacements rather than
		// additions: the row states the pack's tools, and the sentence above it states
		// the substitution, which the test below holds to the list.
		const overridden = new Set<string>(ROOT_TOOL_NAMES);
		const problems: string[] = [];
		for (const [name, row] of rows()) {
			const entry = manifest.find((candidate) => entryName(candidate) === name);
			const facts = entry === undefined ? undefined : registered.get(entry);
			if (facts === undefined) continue;
			// Each cell claims exactly one set: a tool the extension does not register is
			// drift even though every name in it exists somewhere in the pack. A command
			// cell names the command, and its sub-command words are the guide's own.
			const tools = new Set([...facts.tools].filter((tool) => !overridden.has(tool)));
			const commands = new Set([...facts.commands]);
			for (const [cell, claim, actual] of [
				["tools", row.tools, tools],
				["commands", row.commands, commands],
				["flags", row.flags, facts.flags],
			] as const) {
				const missing = [...actual].filter((value) => !claim.has(value)).sort();
				const extra = [...claim].filter((value) => !actual.has(value)).sort();
				if (missing.length > 0) problems.push(`${name}: ${cell} the row omits — ${missing.join(", ")}`);
				if (extra.length > 0) problems.push(`${name}: ${cell} the row adds — ${extra.join(", ")}`);
			}
		}
		expect(problems, "docs/user-guide/reference.md's extension rows").toEqual([]);
	});

	test("names the Pi tools worktree re-registers, and calls them replacements", () => {
		const section = sectionOf("Extensions and tools");
		const missing = ROOT_TOOL_NAMES.filter((name) => !section.includes(`\`${name}\``));
		expect(missing, "a path tool worktree re-registers that the note does not name").toEqual([]);
		expect(section, "the note says what those tools are").toContain("replacements, not additions");
	});

	// Two tools are not the model's to call freely, so their rows carry the words
	// that say why. The prose under the table explains both; this holds the marks.
	test("marks the tools a script or a model reaches differently", () => {
		const marked = [...sectionOf("Extensions and tools").matchAll(/`([a-z_]+)`\s*\(([a-z-]+)\)/g)].map(
			(match) => `${match[1]} (${match[2]})`,
		);
		expect(marked).toEqual(["ask_user_question (model-only)", "open_path (codemode)"]);
	});
});

/**
 * A variable this table deliberately leaves out, and the page that documents it.
 *
 * `ENV_ROOT` belongs to the worktree screen — it is how an isolated session names
 * its root — so it is documented where it is used rather than as a launch knob.
 */
const ENV_ELSEWHERE = new Map([[ENV_ROOT, join(root, "docs", "extensions", "worktree.md")]]);

describe("the launch table lists the flags and variables that exist", () => {
	/** The `pi --x` rows and the `PI_X=…` rows, as the names they state. */
	function launchRows(): { flags: Set<string>; env: Set<string> } {
		const flags = new Set<string>();
		const env = new Set<string>();
		for (const row of tableRows(subsection("Launch flags and environment"))) {
			const cell = (row[0] ?? "").replaceAll("`", "");
			const flag = /^pi --([\w-]+)/.exec(cell);
			if (flag?.[1] !== undefined) flags.add(flag[1]);
			const variable = /^(PI_[A-Z_]+)/.exec(cell);
			if (variable?.[1] !== undefined) env.add(variable[1]);
		}
		return { flags, env };
	}

	test("names every flag the pack registers, and no other", async () => {
		const registered = [...(await surface()).values()].flatMap((entry) => [...entry.flags]).sort();
		expect([...launchRows().flags].sort()).toEqual(registered);
	});

	test("names every environment variable, or says where it is documented", () => {
		const documented = new Set([...launchRows().env, ...ENV_ELSEWHERE.keys()]);
		const expected = [ENV_DISABLED_EXTENSIONS, ENV_OFFLINE, ENV_ROOT];
		expect([...documented].sort()).toEqual([...expected].sort());
		// The exception is a claim about another page, so it is read rather than trusted.
		for (const [name, page] of ENV_ELSEWHERE) {
			expect(readFileSync(page, "utf-8"), `${name} is documented nowhere`).toContain(name);
		}
	});

	test("names the shortcut the plan extension binds", async () => {
		const registered = [...(await surface()).values()].flatMap((entry) => [...entry.shortcuts]);
		expect(registered.sort()).toEqual([...SHORTCUT_ROWS.keys()].sort());
		for (const row of tableRows(subsection("Planning and verification"))) {
			const cell = (row[0] ?? "").replaceAll("`", "").toLowerCase();
			if (SHORTCUT_ROWS.has(cell)) return;
		}
		throw new Error("docs/user-guide/reference.md has no row for the plan-mode shortcut");
	});
});

/**
 * One place the pack writes, and what decides it.
 *
 * The row is the location as the reference spells it; `names` is the literal the
 * module has to still name, so a moved or renamed directory fails here rather than
 * in a reader's terminal. `build` is the module's own answer where it exports one,
 * which is the only form of the claim that cannot drift.
 */
interface StoreRow {
	row: string;
	/** The non-test module that decides where it goes. */
	module?: string;
	/** The module that exports the directory name, when `module` joins a constant. */
	constantsIn?: string;
	/** The directory or file name, as the code spells it. */
	names?: string;
	build?: () => string;
	/** Why a location the pack does not build still earns a row. */
	note?: string;
}

const STORES: readonly StoreRow[] = [
	{ row: "~/.pi/agent/plans/<repo-key>/", module: "extensions/plan/plans.ts", names: "plans" },
	{ row: "<agent-dir>/plans/", module: "extensions/plan/plans.ts", names: "plans" },
	{ row: ".pi/worktrees/", module: "extensions/worktree/config.ts", names: "worktrees", build: () => WORKTREE.dir },
	{ row: ".pi/subagents/", module: "extensions/subagent/transcripts.ts", names: "subagents" },
	{ row: "<agent-dir>/subagents/", module: "extensions/subagent/transcripts.ts", names: "subagents" },
	{
		row: ".pi/memory.md",
		module: "extensions/memory/store.ts",
		names: "memory.md",
		build: () => projectMemoryPath("/tmp/project"),
	},
	{ row: "<agent-dir>/memory.md", module: "extensions/memory/store.ts", names: "memory.md" },
	{
		row: ".pi/bytefly.json",
		module: "lib/config.ts",
		names: "bytefly.json",
		build: () => SHARED_CONFIG_FILE,
	},
	{
		row: "<agent-dir>/bytefly.json",
		module: "lib/config.ts",
		names: "bytefly.json",
		build: () => SHARED_CONFIG_FILE,
	},
	{
		row: "<agent-dir>/board/<repo-key>/",
		module: "lib/board/store.ts",
		names: "board",
		build: () => boardDirFor("/tmp/agent", "key"),
	},
	{
		row: "<agent-dir>/session-bus/<repo-key>/",
		module: "extensions/session-bus/runtime.ts",
		constantsIn: "lib/session-roster.ts",
		names: "session-bus",
		build: () => BUS_DIR_NAME,
	},
	{
		row: "<agent-dir>/bytefly/update.json",
		module: "extensions/bytefly/update/cache.ts",
		names: "update.json",
		build: () => updateCachePath("/tmp/agent"),
	},
	{
		row: "<agent-dir>/wechat/",
		module: "extensions/wechat/state/credentials.ts",
		names: "wechat",
		build: () => wechatDir(),
	},
	{
		row: "<agent-dir>/jobs/<project>/",
		module: "extensions/job/registry.ts",
		names: "jobs",
		build: () => registryDirFor("/tmp/project", "/tmp/agent/jobs/project"),
	},
	{
		row: "refs/pi/rewind",
		module: "extensions/rewind/config/config.ts",
		names: "refs/pi/rewind",
		build: () => REWIND.refNamespace,
	},
	{
		row: "<agent-dir>/settings.json",
		note: "Pi's own settings file: the panel edits it through the host's setters, so the pack names no path here",
	},
];

/**
 * Modules that read the agent directory without owning a place in it.
 *
 * The list is the ratchet: a module that starts anchoring paths on the agent
 * directory has to be declared here or given a store row, so a new store cannot
 * ship with no place in the reference.
 */
const READS_AGENT_DIR = new Map<string, string>([
	["extensions/bytefly/doctor/runtime.ts", "probes what the health report lists"],
	["extensions/bytefly/panel/commands.ts", "opens the settings screen over Pi's own file"],
	["extensions/bytefly/panel/settings-runtime.ts", "reads and writes Pi's own settings"],
	["extensions/bytefly/picker/discovery.ts", "finds installed packages in the agent directory"],
	["extensions/bytefly/picker/resources.ts", "reads a package's own metadata"],
	["extensions/bytefly/picker/toggle.ts", "writes Pi's own settings through the host"],
	["extensions/bytefly/update/check.ts", "asks the package manager what is installed"],
	["extensions/bytefly/update/register.ts", "wires the update check to the cache"],
	["extensions/subagent/agents.ts", "reads the agent definitions Pi ships"],
	["extensions/wechat/commands/commands.ts", "opens the bridge's own directory for its report"],
	["extensions/wechat/index.ts", "hands the agent directory to the bridge"],
	["lib/board/session.ts", "derives the bus directory a card's owner is read from"],
	["lib/requirements.ts", "checks the state files doctor reports on"],
]);

describe("the files table is every place the pack writes", () => {
	/** The location a row names, as the backticked first cell spells it. */
	function documentedLocations(): string[] {
		const locations: string[] = [];
		for (const row of tableRows(sectionOf("Files on disk"))) {
			const location = backticked(row[0] ?? "")[0];
			if (location !== undefined) locations.push(location);
		}
		return locations;
	}

	test("gives every location a declaration, and every declaration a row", () => {
		const documented = documentedLocations();
		// A section with no rows would make both directions vacuous.
		expect(documented.length).toBeGreaterThan(0);
		expect(documented.sort(), "a declared store with no row").toEqual(STORES.map((store) => store.row).sort());
		// A declaration with neither a module nor a reason is one nobody reviewed.
		const bare = STORES.filter((store) => store.module === undefined && store.note === undefined);
		expect(
			bare.map((store) => store.row),
			"a declared location with no module and no reason",
		).toEqual([]);
	});

	test("keeps each store where its own module puts it", async () => {
		const problems: string[] = [];
		for (const store of STORES) {
			if (store.module === undefined) continue;
			const sources = [store.module, ...(store.constantsIn === undefined ? [] : [store.constantsIn])];
			const missing = sources.filter((file) => !existsSync(join(root, file)));
			if (missing.length > 0) {
				problems.push(`${store.row}: ${missing.join(", ")} does not exist`);
				continue;
			}
			if (
				store.names !== undefined &&
				!sources.some((file) => readFileSync(join(root, file), "utf-8").includes(store.names ?? ""))
			) {
				problems.push(`${store.row}: ${sources.join(", ")} no longer names ${store.names}`);
			}
			// The builders run in a temp agent directory, so what one reads from it cannot
			// depend on the machine running the test.
			if (store.build !== undefined) {
				const built = await withAgentDir(() => store.build?.() ?? "");
				if (!built.includes(store.names ?? "")) problems.push(`${store.row}: the builder returns ${built}`);
			}
		}
		expect(problems, "docs/user-guide/reference.md's files table").toEqual([]);
	});

	test("declares every module that anchors on the agent directory", () => {
		const stores = new Set(
			STORES.flatMap((store) => [store.module, store.constantsIn].filter((file) => file !== undefined)),
		);
		const declared = new Set([...stores, ...READS_AGENT_DIR.keys()]);
		const anchored = [...walkFiles(join(root, "extensions")), ...walkFiles(join(root, "lib"))]
			.filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
			.filter((file) => /getAgentDir|CONFIG_DIR_NAME/.test(readFileSync(file, "utf-8")))
			// A declared path is posix, so a Windows separator would read as undeclared.
			.map((file) => posix(relative(root, file)))
			.filter((file) => !declared.has(file))
			.sort();
		expect(anchored, "a module that anchors on the agent directory with no store row and no READS entry").toEqual([]);
	});
});
