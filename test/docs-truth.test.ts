/**
 * Contract guard for the command and flag names `docs/extensions.md` promises.
 *
 * The catalog is the package-level surface: a shipped command that never appears
 * there is invisible to a reader, and a catalog entry for a command that no
 * longer exists describes a tree that is gone. So the two sets must be equal, and
 * this test derives both itself — the catalog is the reviewed list, not a
 * snapshot beside it.
 *
 * The code side is scanned rather than loaded. Loading all sixteen extensions
 * through the fake runtime would prove registration wiring instead of names, and
 * it needs a per-extension harness (worktree's factory already takes a built-in
 * seam). The trade is that a name must be a string literal, which the third test
 * enforces so a constant-built name fails loudly instead of vanishing from the
 * scan.
 *
 * The doc side reads backticked spans whose first word is a command (`/todos`,
 * `/plan review [path]`, `/worktree*`) or a flag (`--plan`). The catalog also
 * names things this package does not register — Pi's own commands, the WeChat
 * peers' chat commands, and one file-browse page key — so `FOREIGN` lists them
 * with a reason each. That list is reviewed vocabulary, not a parking lot: a new
 * token there is a decision about what the catalog may say.
 *
 * The configuration half of the same contract lives in `config-docs.test.ts`,
 * and the registered tool set is pinned by `naming.test.ts`.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { walkFiles } from "./helpers/files.ts";

const root = join(import.meta.dir, "..");
const catalog = readFileSync(join(root, "docs", "extensions.md"), "utf-8");

/** A name passed to `pi.registerCommand` / `pi.registerFlag`. */
const REGISTRATION = /register(Command|Flag)\(\s*"([^"]+)"/g;
/** Any registration call, so a non-literal name can be caught. */
const REGISTRATION_CALL = /register(Command|Flag)\(/g;

/** A backticked command or flag token at the start of a span. */
const COMMAND_TOKEN = /^\/([a-z][a-z0-9-]*)\*?(?=$|[\s<[(])/;
const FLAG_TOKEN = /^--([a-z][a-z0-9-]*)/;

/**
 * Names the catalog uses that this package does not register, with the reason
 * each is allowed. Grouped by class so a new entry states which class it is.
 */
const FOREIGN: ReadonlyMap<string, string> = new Map([
	["resume", "Pi's own command, named where a session entry survives a resume"],
	["tree", "Pi's own command, named alongside /resume"],
	["settings", "Pi's own command, named where a theme is chosen"],
	["new", "a WeChat peer's chat command, handled by the bridge"],
	["stop", "a WeChat peer's chat command, handled by the bridge"],
	["status", "a WeChat peer's chat command, handled by the bridge"],
	["help", "a WeChat peer's chat command, handled by the bridge"],
	["diff", "a file-browse page key, not a Pi command"],
]);

/** The command and flag names the extension sources register. */
function registered(): { commands: Set<string>; flags: Set<string> } {
	const commands = new Set<string>();
	const flags = new Set<string>();
	const sources = walkFiles(join(root, "extensions")).filter((file) => file.endsWith(".ts"));
	for (const file of sources) {
		if (file.endsWith(".test.ts")) continue;
		const text = readFileSync(file, "utf-8");
		for (const match of text.matchAll(REGISTRATION)) {
			(match[1] === "Command" ? commands : flags).add(match[2]);
		}
	}
	return { commands, flags };
}

/** The command and flag names the catalog names. */
function documented(): { commands: Set<string>; flags: Set<string> } {
	const commands = new Set<string>();
	const flags = new Set<string>();
	for (const span of catalog.matchAll(/`([^`\n]+)`/g)) {
		const text = span[1].trim();
		const command = COMMAND_TOKEN.exec(text);
		if (command) commands.add(command[1]);
		const flag = FLAG_TOKEN.exec(text);
		if (flag) flags.add(flag[1]);
	}
	return { commands, flags };
}

const code = registered();
const docs = documented();

describe("catalog commands and flags", () => {
	test("names every registered command in the catalog", () => {
		const missing = [...code.commands].filter((name) => !docs.commands.has(name)).sort();
		expect(missing).toEqual([]);
	});

	test("names every registered flag in the catalog", () => {
		const missing = [...code.flags].filter((name) => !docs.flags.has(name)).sort();
		expect(missing).toEqual([]);
	});

	test("registers every command the catalog names", () => {
		const unknown = [...docs.commands].filter((name) => !code.commands.has(name) && !FOREIGN.has(name)).sort();
		expect(unknown).toEqual([]);
	});

	test("registers every flag the catalog names", () => {
		const unknown = [...docs.flags].filter((name) => !code.flags.has(name) && !FOREIGN.has(name)).sort();
		expect(unknown).toEqual([]);
	});

	test("registers every name as a string literal so the catalog can be checked", () => {
		const sources = walkFiles(join(root, "extensions")).filter(
			(file) => file.endsWith(".ts") && !file.endsWith(".test.ts"),
		);
		const offenders: string[] = [];
		for (const file of sources) {
			const text = readFileSync(file, "utf-8");
			const calls = [...text.matchAll(REGISTRATION_CALL)].length;
			const literals = [...text.matchAll(REGISTRATION)].length;
			if (calls !== literals) offenders.push(file.slice(root.length + 1));
		}
		expect(offenders).toEqual([]);
	});

	test("keeps the allowlist to names the catalog really uses", () => {
		// A stale allowance would let a removed command keep a documented name.
		const used = new Set([...docs.commands, ...docs.flags]);
		const stale = [...FOREIGN.keys()].filter((name) => !used.has(name)).sort();
		expect(stale).toEqual([]);
	});
});
