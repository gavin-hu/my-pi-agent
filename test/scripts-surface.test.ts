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
 * The last two cases cover the two places a retired name hides: a CI workflow (a
 * `run:` line is a command nobody re-reads) and a source string (the `--serial` hint
 * a failing wait prints), where a colon is what a package script name looks like.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { posix, walkFiles } from "./helpers/files.ts";
import { extensionsDir, libDir, relative, scriptsDir, testDir } from "./helpers/scan.ts";

const repo = posix(join(import.meta.dir, ".."));
/** Every declared script, so a failure can name the ones the docs forgot. */
const SCRIPTS: string[] = Object.keys(
	(JSON.parse(readFileSync(join(repo, "package.json"), "utf-8")) as { scripts: Record<string, string> }).scripts,
);

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
	test("the scripts table in docs/development.md lists every entry", () => {
		const rows = readFileSync(join(repo, "docs", "development.md"), "utf-8")
			.split("\n")
			.map((line) => /^\| `bun run ([A-Za-z0-9:_-]+)/.exec(line)?.[1])
			.filter((name) => name !== undefined);
		const undocumented = SCRIPTS.filter((name) => !rows.includes(name)).map(
			(name) => `package.json: \`${name}\` has no row in the scripts table; a command nobody can find is not a surface`,
		);
		const undeclared = rows
			.filter((name) => !SCRIPTS.includes(name))
			.map((name) => `docs/development.md: the table names \`${name}\`, which package.json does not declare`);
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
