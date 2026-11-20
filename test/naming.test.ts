/**
 * Naming guard for the model-facing tools this package registers.
 *
 * The convention follows Claude Code's plan/worktree tools (EnterPlanMode,
 * ExitPlanMode, EnterWorktree, ExitWorktree, AskUserQuestion):
 *
 *   - lowercase snake_case;
 *   - a tool that dispatches on `action` is named for its domain, in one word
 *     (`todo`, `goal`, `job`, `subagent`, `board`, `plan`, `session`, `team`,
 *     `watch`) — and a domain whose name is two words keeps them
 *     (`code_review`), because the lifecycle is the artifact, not one verb's turn;
 *   - a tool that does one thing is verb-first (`send_wechat`, `run_doctor`,
 *     `open_path`, `read_doc`), with `web_search` and `web_fetch` keeping the
 *     spelling Claude Code gave them.
 *
 * Built-in overrides (`read`/`write`/`edit`/`bash`/`grep`/`find`/`ls`) are
 * deliberately excluded: they reuse the built-in names.
 *
 * The entry READMEs advertise the tool surface as a table, so the second half of
 * this file holds both lists to the same set: a renamed tool must not linger in
 * either, and a shipped tool must not be missing from one.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { REGISTERED } from "./helpers/registry.ts";

const NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

/**
 * Multi-word names that are a domain rather than one action: the two Claude Code
 * spellings, and `code_review`, whose four actions make one lifecycle — the
 * artifact a person produces — so a verb-first spelling would name a one-shot.
 */
const NOUN_FIRST_CARVE_OUTS = new Set(["web_search", "web_fetch", "code_review"]);

const LEADING_VERBS = new Set([
	"ask",
	"cancel",
	"enter",
	"exit",
	"open",
	"prune",
	"list",
	"write",
	"read",
	"get",
	"set",
	"clear",
	"send",
	"start",
	"stop",
	"kill",
	"wait",
	"run",
]);

const names = REGISTERED.map((entry) => entry.name);
const nameSet = new Set(names);

/** A backticked token shaped like a tool name rather than a `/command` or `--flag`. */
const TOOL_SHAPED = /^[a-z][a-z0-9_]*$/;

/**
 * Words in the tool column that this package does not register as tools, with
 * the reason each is allowed. Reviewed vocabulary: a new entry is a decision
 * about what the front door may say there.
 */
const NOT_TOOLS: ReadonlyMap<string, string> = new Map([
	["doctor", "the `/bytefly doctor` subcommand, named in the `/bytefly` row"],
	["settings", "the `/bytefly settings` subcommand, named in the `/bytefly` row"],
	["skills", "the `/bytefly skills` subcommand, named in the `/bytefly` row"],
	["update", "the `/bytefly update` subcommand, named in the `/bytefly` row"],
	["upgrade", "the `/bytefly upgrade` subcommand, named in the `/bytefly` row"],
]);

/** The tool-shaped tokens in the second column of each markdown table in `markdown`. */
export function toolColumn(markdown: string): string[] {
	const tokens: string[] = [];
	for (const line of markdown.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) continue;
		const cells = trimmed.split("|");
		// cells[0] is the empty run before the leading pipe, so the tool column is 2.
		const column = cells[2] ?? "";
		for (const span of column.matchAll(/`([^`\n]+)`/g)) {
			if (TOOL_SHAPED.test(span[1])) tokens.push(span[1]);
		}
	}
	return tokens;
}

const englishTools = toolColumn(readFileSync(join(import.meta.dir, "..", "README.md"), "utf-8"));
const chineseTools = toolColumn(readFileSync(join(import.meta.dir, "..", "README.zh-CN.md"), "utf-8"));

describe("extension tool naming", () => {
	test("every name is lowercase snake_case", () => {
		for (const { extension, name } of REGISTERED) {
			expect(NAME_PATTERN.test(name), `${extension}: ${name}`).toBe(true);
		}
	});

	test("names are unique", () => {
		expect(new Set(names).size).toBe(names.length);
	});

	test("multi-word names are verb-first (or documented noun-first carve-outs)", () => {
		for (const name of names) {
			if (!name.includes("_") || NOUN_FIRST_CARVE_OUTS.has(name)) continue;
			const leadingVerb = name.split("_")[0];
			expect(LEADING_VERBS.has(leadingVerb), `${name} should be verb-first`).toBe(true);
		}
	});

	test("the full registered set matches the reviewed snapshot", () => {
		expect([...names].sort()).toEqual([
			"board",
			"code_review",
			"goal",
			"job",
			"memory",
			"open_path",
			"plan",
			"question",
			"read_doc",
			"run_doctor",
			"send_wechat",
			"session",
			"subagent",
			"team",
			"todo",
			"watch",
			"web_fetch",
			"web_search",
			"worktree",
		]);
	});
});

describe("entry README tool names", () => {
	test("finds the tool column the README is expected to have", () => {
		// A parser that stopped matching would make the checks below vacuous.
		expect(englishTools.length).toBeGreaterThan(0);
	});

	test("names only registered tools in the front door", () => {
		const unknown = [...new Set(englishTools)].filter((name) => !nameSet.has(name) && !NOT_TOOLS.has(name)).sort();
		expect(unknown, "README.md names a tool this package does not register").toEqual([]);
	});

	test("advertises every registered tool in the front door", () => {
		const advertised = new Set(englishTools);
		const missing = names.filter((name) => !advertised.has(name)).sort();
		expect(missing, "README.md does not name a registered tool").toEqual([]);
	});

	test("names the same tools in both entry READMEs", () => {
		// Tool names are not translated, so a difference is a row that drifted.
		expect([...new Set(chineseTools)].sort()).toEqual([...new Set(englishTools)].sort());
	});

	test("keeps the non-tool allowlist to words the README really uses", () => {
		const used = new Set(englishTools);
		const stale = [...NOT_TOOLS.keys()].filter((name) => !used.has(name)).sort();
		expect(stale).toEqual([]);
	});
});
