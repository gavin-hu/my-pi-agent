/**
 * Drift guard for the scripts surface.
 *
 * The docs are how a contributor finds a dev command, so every `bun run <name>` this
 * project's docs name must be an entry in `package.json`, and the scripts table must
 * list every entry. Three exclusions, all facts rather than leniency: `skills/`
 * documents other projects' commands, `CHANGELOG.md` records what a release shipped
 * (so a script renamed since would fail against its own history), and a bare
 * `bun run build` in a fixture is a sample command rather than this package's.
 *
 * The next cases cover the places a retired name hides: a CI workflow (a `run:` line is
 * a command nobody re-reads) and a source string (the `--serial` hint a failing wait
 * prints), where a colon is what a package script name looks like.
 *
 * The last two are the shape of the surface itself, which is the other half of a
 * rename: a name is a verb or one member of a verb's family, and a value names the file
 * it runs. `screenshot:tools` used to run `tools:render`, so `package.json` could not
 * say what it did; a value that is not a path is that defect again.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { posix, walkFiles } from "./helpers/files.ts";
import { extensionsDir, libDir, relative, scriptsDir, testDir } from "./helpers/scan.ts";

const repo = posix(join(import.meta.dir, ".."));
/** Every declared script and what it runs, so a failure can name the ones the docs forgot. */
const DECLARED: Record<string, string> = (
	JSON.parse(readFileSync(join(repo, "package.json"), "utf-8")) as { scripts: Record<string, string> }
).scripts;

/** The names alone, which is what the docs are compared against. */
const SCRIPTS: string[] = Object.keys(DECLARED);

/**
 * The verbs this surface is spelled with, and what each one promises.
 *
 * A name is `<verb>` — the whole errand — or `<verb>:<target>`, one member of it, so a
 * command says what kind of work it is before it says what it is about. Adding a verb is a
 * deliberate edit to this table; that is the difference between a family and a ninth spelling.
 */
const KINDS: Record<string, string> = {
	check: "verify the tree — the whole gate, or one phase of it",
	format: "rewrite the tree's formatting, whose dry run is `check:format`",
	bench: "measure something, and write nothing",
	render: "draw on stdout or into a file",
	capture: "write an asset under `assets/`",
	report: "print a fact, and write nothing",
	sync: "make one copy match the thing it copies",
	migrate: "rewrite the machine's config, once",
};

/** The `scripts/` file a value runs, and the shape that captures which one it is. */
const SCRIPT_FILE = /^bun run (scripts\/[\w./-]+\.ts)(?: |$)/;

/** What a command may run: a file in this repository's `scripts/`, or a toolchain binary. */
const RUNS: readonly RegExp[] = [SCRIPT_FILE, /^tsc(?: |$)/, /^biome(?: |$)/];

/**
 * A `bun run <name>` in a doc. A file path is matched too, on purpose: a command the
 * docs spell as `bun run scripts/x.ts` bypasses the scripts surface this guard keeps.
 */
const BUN_RUN = /bun run ([A-Za-z0-9:_./-]+)/g;

/** Every doc that describes this project: the root, the doc trees, and the package's own. */
function docs(): string[] {
	const trees = ["docs", "extensions", "lib", "scripts", "test", ".github"].map((dir) => join(repo, dir));
	const rootDocs = readdirSync(repo)
		.filter((name) => name.endsWith(".md"))
		.map((name) => join(repo, name));
	return [...rootDocs, ...trees.flatMap((tree) => walkFiles(tree))]
		.filter((file) => file.endsWith(".md"))
		.filter((file) => !relative(file).endsWith("CHANGELOG.md"));
}

describe("the scripts surface", () => {
	test("the scripts table in scripts/README.md lists every entry", () => {
		const rows = readFileSync(join(repo, "scripts", "README.md"), "utf-8")
			.split("\n")
			.map((line) => /^\| `bun run ([A-Za-z0-9:_-]+)/.exec(line)?.[1])
			.filter((name) => name !== undefined);
		const undocumented = SCRIPTS.filter((name) => !rows.includes(name)).map(
			(name) => `package.json: \`${name}\` has no row in the scripts table; a command nobody can find is not a surface`,
		);
		const undeclared = rows
			.filter((name) => !SCRIPTS.includes(name))
			.map((name) => `scripts/README.md: the table names \`${name}\`, which package.json does not declare`);
		expect([...undocumented, ...undeclared]).toEqual([]);
	});

	test("every command the docs name is a declared script, never a file path", () => {
		const offenders: string[] = [];
		for (const file of docs()) {
			const text = readFileSync(file, "utf-8");
			for (const [, command] of text.matchAll(BUN_RUN)) {
				if (SCRIPTS.includes(command)) continue;
				const why = command.includes("/")
					? "is a file path; add or use a package script, so the command is discoverable and renameable"
					: "is not a script in package.json";
				offenders.push(`${relative(file)}: \`bun run ${command}\` ${why}`);
			}
		}
		expect(offenders).toEqual([]);
	});

	test("every command a workflow runs is a declared script", () => {
		const offenders: string[] = [];
		for (const file of walkFiles(join(repo, ".github")).filter((name) => name.endsWith(".yml"))) {
			for (const [, command] of readFileSync(file, "utf-8").matchAll(BUN_RUN)) {
				if (SCRIPTS.includes(command)) continue;
				offenders.push(`${relative(file)}: \`bun run ${command}\` is not a script in package.json`);
			}
		}
		expect(offenders, "CI runs a script a contributor cannot run").toEqual([]);
	});

	test("every name is a verb, or one member of a verb's family", () => {
		const verbs = Object.keys(KINDS).join(", ");
		const offenders: string[] = [];
		for (const name of SCRIPTS) {
			const [kind, target, ...rest] = name.split(":");
			if (rest.length > 0) {
				offenders.push(`package.json: \`${name}\` has two colons; a name is <verb> or <verb>:<target>`);
				continue;
			}
			if (KINDS[kind] === undefined) {
				offenders.push(`package.json: \`${name}\` starts with "${kind}", which is not one of ${verbs}`);
				continue;
			}
			if (target !== undefined && !/^[a-z][a-z-]*$/.test(target)) {
				offenders.push(`package.json: \`${name}\` has the target "${target}", which is not lowercase kebab`);
			}
		}
		expect(offenders).toEqual([]);
	});

	test("every value names the file it runs, never another script", () => {
		const offenders = Object.entries(DECLARED)
			.filter(([, value]) => !RUNS.some((pattern) => pattern.test(value)))
			.map(
				([name, value]) =>
					`package.json: \`${name}\` runs \`${value}\` — name the script file it runs, so the entry says what it does`,
			);
		expect(offenders).toEqual([]);
	});

	test("every file a value names is in the tree", () => {
		const offenders = Object.entries(DECLARED).flatMap(([name, value]) => {
			const target = SCRIPT_FILE.exec(value)?.[1];
			if (target === undefined) return [];
			const present = existsSync(join(repo, ...target.split("/")));
			return present ? [] : [`package.json: \`${name}\` runs \`${target}\`, which a rename left out of the tree`];
		});
		expect(offenders, "a command that runs nothing is a command nobody can run").toEqual([]);
	});

	test("a colon-named command in a source string is a declared script", () => {
		const offenders: string[] = [];
		for (const file of [extensionsDir, libDir, scriptsDir, testDir].flatMap((dir) => walkFiles(dir))) {
			if (!file.endsWith(".ts")) continue;
			for (const [, command] of readFileSync(file, "utf-8").matchAll(BUN_RUN)) {
				if (!command.includes(":") || SCRIPTS.includes(command)) continue;
				offenders.push(`${relative(file)}: \`bun run ${command}\` is not a script in package.json`);
			}
		}
		expect(offenders, "a hint that names a retired command sends the reader nowhere").toEqual([]);
	});
});
