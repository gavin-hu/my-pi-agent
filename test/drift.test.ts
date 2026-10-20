/**
 * Drift guard: the ways this package grows a refactor, caught where it starts.
 *
 * Every sweep in the history is one of three things, and each is cheap to see at
 * the moment it begins and expensive to undo a release later:
 *
 * - the same helper written a second time in another extension, which is how
 *   `lib/` came to exist (`refactor(lib,job,watch): share one live-output kit`
 *   replaced four private copies);
 * - one module accreting past the point where a split is small
 *   (`refactor(wechat): split the bridge into focused modules`);
 * - a shared module nobody can find, because the index in `lib/README.md` and
 *   the modules on disk drifted apart.
 *
 * Bodies, not names: many exported names repeat across extensions and nearly all
 * of them are the per-extension convention (`TOOL_NAME`, `registerTools`,
 * `loadConfig`), while a repeated body is a copy. The module line bar's ratchet
 * (a named module's own height, which may only fall) lives in
 * `test/structure.test.ts`, beside the other source conventions.
 *
 * Where the first gate stops, deliberately: it reads **braced** bodies, so a
 * single-expression arrow is not a block it compares; it drops comments and
 * counts braces only where they are code, so a `{` in a message or a doc comment
 * cannot end a block early — but a brace inside a *regex* literal still counts.
 *
 * `docs/development.md#drift-rules` states the backlog these lists carry.
 */

import { readFileSync } from "node:fs";
import { join, posix as posixPath } from "node:path";
import { describe, expect, test } from "bun:test";
import { allowsAt } from "./helpers/comments.ts";
import { walkFiles } from "./helpers/files.ts";

const repo = posixPath.join(import.meta.dir, "..").replaceAll("\\", "/");
const extensionsDir = join(repo, "extensions");
const libDir = join(repo, "lib");

/** A path relative to the repo, in posix form, so a failure names the same file on every OS. */
const relative = (file: string): string => file.slice(repo.length + 1).replaceAll("\\", "/");

/** The owner a source file belongs to: the extension name, or `lib`. */
function ownerOf(file: string): string {
	const path = relative(file);
	return path.startsWith("extensions/") ? path.split("/")[1] : "lib";
}

/** Every non-test TypeScript module the package ships. */
function sourceFiles(): string[] {
	return [extensionsDir, libDir]
		.flatMap((dir) => walkFiles(dir))
		.filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"));
}

/** A source module with its own trailing newline removed, so a line count is a count of lines. */
function sourceLines(file: string): string[] {
	const lines = readFileSync(file, "utf-8").split("\n");
	if (lines.at(-1) === "") lines.pop();
	return lines;
}

/** Every module's height, measured once: three gates read the same numbers. */
let sizesCache: Map<string, number> | undefined;

function sizes(): Map<string, number> {
	sizesCache ??= new Map(sourceFiles().map((file) => [relative(file), sourceLines(file).length]));
	return sizesCache;
}

/**
 * One line with its comments removed, the literals kept, and the braces counted
 * only where they are code.
 *
 * A `{` in prose or in a message is not the end of a block, while the literal
 * text has to stay: two predicates that compare different strings are two
 * predicates. The state carries across lines, so a block comment or a template
 * literal that spans them is read as one.
 */
interface LineState {
	inBlock: boolean;
	quote: string | undefined;
}

interface ScannedLine {
	text: string;
	opens: number;
	closes: number;
}

function scanLine(line: string, state: LineState): ScannedLine {
	let text = "";
	let opens = 0;
	let closes = 0;
	for (let index = 0; index < line.length; index++) {
		const character = line[index] ?? "";
		const next = line[index + 1];
		if (state.inBlock) {
			if (character === "*" && next === "/") {
				state.inBlock = false;
				index++;
			}
			continue;
		}
		if (state.quote !== undefined) {
			text += character;
			if (character === "\\") {
				text += next ?? "";
				index++;
				continue;
			}
			if (character === state.quote) state.quote = undefined;
			continue;
		}
		if (character === "/" && next === "/") break;
		if (character === "/" && next === "*") {
			state.inBlock = true;
			index++;
			continue;
		}
		if (character === "'" || character === '"' || character === "`") {
			state.quote = character;
			text += character;
			continue;
		}
		if (character === "{") opens++;
		if (character === "}") closes++;
		text += character;
	}
	return { text, opens, closes };
}

describe("the same helper in two extensions", () => {
	/**
	 * A declaration header: `function name`, `const name = (`, and the annotated
	 * arrow this tree uses for extractors (`const name: DocExtractor = async (`).
	 * Indentation is allowed so a nested declaration is compared too.
	 */
	const HEADER = [
		/^\s*(?:export )?(?:default )?(?:async )?function\*? (\w+)/,
		/^\s*(?:export )?const (\w+)\s*(?::[^=]+)?=\s*(?:async )?(?:\(|\w+\s*=>)/,
	];

	/**
	 * A copy accepted for now, with the reason, keyed `path:name`. The list may
	 * only shrink: an entry goes when the helper moves to `lib/`, which means
	 * deleting it and lowering `ACCEPTED_COUNT`.
	 */
	const ACCEPTED: Record<string, string> = {
		"extensions/bytefly/notify/config.ts:bool": "config coercion, three copies; belongs in lib/config.ts",
		"extensions/file-browse/config.ts:bool": "config coercion, three copies; belongs in lib/config.ts",
		"extensions/worktree/config.ts:booleanOr": "config coercion, three copies; belongs in lib/config.ts",
		"extensions/goal/clarify-parse.ts:clean": "one-line string coercion; belongs in lib/format.ts",
		"extensions/question/answers.ts:asLine": "one-line string coercion; belongs in lib/format.ts",
		"extensions/rewind/config.ts:stringList": "config list coercion, two copies; belongs in lib/config.ts",
		"extensions/worktree/config.ts:stringList": "config list coercion, two copies; belongs in lib/config.ts",
		"extensions/job/format.ts:statusGlyph": "job and watch status kits; extract together, not one at a time",
		"extensions/watch/format.ts:statusGlyph": "job and watch status kits; extract together, not one at a time",
		"extensions/job/schema.ts:optionalString": "job and watch schema coercions; extract together",
		"extensions/watch/schema.ts:optionalString": "job and watch schema coercions; extract together",
		"extensions/job/format.ts:clipLabel": "one-line wrapper over the shared labelLine in lib/tui/columns.ts",
		"extensions/watch/format.ts:clipLabel": "one-line wrapper over the shared labelLine in lib/tui/columns.ts",
		"extensions/memory/errors.ts:messageOf":
			"error-to-text; the same line is inlined in lib/config.ts and lib/requirements.ts",
		"extensions/wechat/errors.ts:messageOf":
			"error-to-text; the same line is inlined in lib/config.ts and lib/requirements.ts",
		"extensions/rewind/review.ts:errorText":
			"error-to-text; the same line is inlined in lib/config.ts and lib/requirements.ts",
		"extensions/web-access/search/search.ts:describe":
			"error-to-text; the same line is inlined in lib/config.ts and lib/requirements.ts",
		"extensions/job/commands.ts:stopTimer": "timer teardown in three command modules; extract with the runtime kit",
		"extensions/memory/commands.ts:stopTimer": "timer teardown in three command modules; extract with the runtime kit",
		"extensions/watch/commands.ts:stopTimer": "timer teardown in three command modules; extract with the runtime kit",
		"extensions/job/runtime.ts:stopClock": "timer teardown in the job and watch runtimes; extract together",
		"extensions/watch/runtime.ts:stopClock": "timer teardown in the job and watch runtimes; extract together",
		"extensions/bytefly/panel/settings-runtime.ts:emit": "listener fan-out written twice; belongs beside lib/rails.ts",
		"extensions/todo/runtime.ts:notify": "listener fan-out written twice; belongs beside lib/rails.ts",
	};

	/**
	 * The accepted list's size, written down so adding an entry is a deliberate
	 * edit here too. Lower it when a copy moves to `lib/`; never raise it.
	 */
	const ACCEPTED_COUNT = 24;

	/** A body shorter than this is a coincidence waiting to happen, not a copy. */
	const MIN_BODY = 20;

	/** How far past a header the opening brace may sit: a signature can wrap. */
	const HEADER_SPAN = 12;

	interface Block {
		rel: string;
		owner: string;
		name: string;
		body: string;
		line: number;
	}

	/** One tree scan for every gate below. */
	let blocksCache: Block[] | undefined;

	function blocks(): Block[] {
		blocksCache ??= scanBlocks();
		return blocksCache;
	}

	/** Whether the line opens a declaration of its own, so a scan must not cross it. */
	function startsDeclaration(text: string): boolean {
		return HEADER.some((pattern) => pattern.test(text));
	}

	/**
	 * The braced block a declaration opens on `line`, as text with comments and
	 * string contents removed. Undefined when the body is not braced: a
	 * single-expression arrow, or a statement that ends before any brace opens.
	 */
	function bracedBody(lines: string[], line: number): { body: string; end: number } | undefined {
		let depth = 0;
		let opened = false;
		const kept: string[] = [];
		const state: LineState = { inBlock: false, quote: undefined };
		for (let index = line; index < lines.length && index < line + HEADER_SPAN; index++) {
			const scanned = scanLine(lines[index] ?? "", state);
			// The signature is not the body: two copies that differ only in their
			// parameter types are one copy, so the header contributes only what
			// follows its opening brace.
			if (index > line) kept.push(scanned.text);
			else if (scanned.opens > 0) kept.push(scanned.text.slice(scanned.text.indexOf("{") + 1));
			depth += scanned.opens - scanned.closes;
			opened ||= scanned.opens > 0;
			if (opened && depth <= 0) return { body: kept.join(" ").replace(/\s+/g, " ").trim(), end: index };
			if (!opened && index > line && (scanned.text.trim().endsWith(";") || startsDeclaration(scanned.text))) {
				return undefined;
			}
		}
		return undefined;
	}

	/** Every declaration the reader can see, whose body is braced. */
	function scanBlocks(): Block[] {
		const found: Block[] = [];
		for (const file of sourceFiles()) {
			const lines = sourceLines(file);
			const rel = relative(file);
			for (let index = 0; index < lines.length; index++) {
				let match: RegExpExecArray | null = null;
				for (const pattern of HEADER) {
					match = pattern.exec(lines[index] ?? "");
					if (match !== null) break;
				}
				if (match === null) continue;
				const braced = bracedBody(lines, index);
				if (braced === undefined) continue;
				if (braced.body.length >= MIN_BODY) {
					found.push({ rel, owner: ownerOf(file), name: match[1] ?? "", body: braced.body, line: index + 1 });
				}
				index = braced.end;
			}
		}
		return found;
	}

	/** Bodies that two different owners both declare: each group is one copy. */
	function copies(): Block[][] {
		const groups = new Map<string, Block[]>();
		for (const block of blocks()) {
			const group = groups.get(block.body) ?? [];
			group.push(block);
			groups.set(block.body, group);
		}
		return [...groups.values()].filter(
			(group) => group.length > 1 && new Set(group.map((block) => block.owner)).size > 1,
		);
	}

	/** Whether this declaration opts out with an `allow:dup` comment on or above it. */
	function optsOut(block: Block): boolean {
		if (ACCEPTED[`${block.rel}:${block.name}`] !== undefined) return true;
		return allowsAt(sourceLines(join(repo, block.rel)), block.line - 1, "allow:dup");
	}

	/** One member of a copy, and the reason it was accepted when it was. */
	function label(block: Block): string {
		const reason = ACCEPTED[`${block.rel}:${block.name}`];
		return reason === undefined ? `${block.rel}:${block.name}` : `${block.rel}:${block.name} (accepted: ${reason})`;
	}

	test("finds the declarations it is meant to compare", () => {
		// A parser that silently matches nothing would pass this suite and guard
		// nothing, so the count is pinned to an order of magnitude.
		expect(blocks().length).toBeGreaterThan(500);
	});

	test("reads the annotated arrow shape this tree uses for extractors", () => {
		// `export const extractPdfText: DocExtractor = async (file) => {` is where a
		// second copy would hide most easily, so the reader must see that shape.
		const names = new Set(blocks().map((block) => block.name));
		expect(names.has("extractPdfText"), "the annotated arrow is invisible to the reader").toBe(true);
		expect(names.has("extractDocxText"), "the annotated arrow is invisible to the reader").toBe(true);
	});

	test("no function body appears in two owners", () => {
		const offenders = copies()
			.filter((group) => !group.every((block) => optsOut(block)))
			.map(
				(group) =>
					`${group.map((block) => label(block)).join(", ")}: the same body twice; move both to lib/ and import it, or state the exception with an allow:dup comment`,
			);
		expect(offenders).toEqual([]);
	});

	test("the accepted list has no entry that is no longer a copy", () => {
		const copied = new Set(copies().flatMap((group) => group.map((block) => `${block.rel}:${block.name}`)));
		const stale = Object.keys(ACCEPTED).filter((key) => !copied.has(key));
		expect(stale, "delete the entry and lower ACCEPTED_COUNT: the copy it accepts is gone").toEqual([]);
	});

	test("the accepted list has no room to grow", () => {
		expect(Object.keys(ACCEPTED).length, "a new copy is extracted, not accepted").toBe(ACCEPTED_COUNT);
	});
});

describe("the shared surface index", () => {
	test("every lib module has a row in lib/README.md", () => {
		const rows = readFileSync(join(libDir, "README.md"), "utf-8")
			.split("\n")
			.filter((line) => line.startsWith("|"));
		const missing = [...sizes().keys()]
			// A barrel is a re-export list, not a module of its own.
			.filter((rel) => rel.startsWith("lib/") && !rel.endsWith("/index.ts"))
			.filter((rel) => {
				const module = rel.slice("lib/".length);
				return !rows.some((row) => row.includes(`](./${module})`));
			})
			.map((rel) => `${rel}: no table row in lib/README.md; a helper nobody can find gets written again`);
		expect(missing).toEqual([]);
	});
});

describe("the agent contract", () => {
	/**
	 * `AGENTS.md` is the entry point: it holds the rules and their gates, and the
	 * detail lives in the docs it links to. This is the ceiling that keeps a new
	 * paragraph from turning it back into a second manual — lower it when the file
	 * shrinks.
	 */
	const CEILING = 2400;

	test("AGENTS.md stays inside its word budget", () => {
		const words = readFileSync(join(repo, "AGENTS.md"), "utf-8").split(/\s+/).filter(Boolean).length;
		expect(words, "move the detail into docs/development.md and link to it").toBeLessThanOrEqual(CEILING);
	});
});
