/**
 * Drift guard for the scripts surface.
 *
 * The docs are how a contributor finds a dev command, so every `bun run <name>` this
 * project's docs name must be an entry in `package.json`, and the scripts table must
 * list every entry. Two exclusions, both facts rather than leniency: `skills/`
 * documents other projects' commands, and `CHANGELOG.md` records what a release
 * shipped, so a script renamed since would fail against its own history.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { posix, walkFiles } from "./helpers/files.ts";

const repo = posix(join(import.meta.dir, ".."));
const relative = (file: string): string => file.slice(repo.length + 1);

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
	const trees = ["docs", "extensions", "lib", "test", ".github"].map((dir) => join(repo, dir));
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
});
