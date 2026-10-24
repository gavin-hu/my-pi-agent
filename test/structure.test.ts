/**
 * Structure and convention guard for the suite.
 *
 * Tests are grouped into capability suites beside the extension or `lib/`
 * subsystem they cover; `test/` holds only shared helpers, the suite manifest,
 * and the package-level contract tests. Besides test-file bans, the scan
 * enforces the TUI renderer conventions on extension/lib source. See
 * `test/README.md`.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, posix as posixPath } from "node:path";
import { describe, expect, test } from "bun:test";
import { REQUIREMENTS } from "../lib/requirements.ts";
import { SHARED_CONFIG_FILE } from "../lib/config.ts";
import { allowsAt } from "./helpers/comments.ts";
import { posix, walkFiles } from "./helpers/files.ts";
import { EXTENSION_SUITES, LIB_SUITES, SCRIPT_SUITES } from "./suite-manifest.ts";

/**
 * A path in posix form, from parts that may arrive with either separator.
 * The doc-link guard slices a path at `/` to find the linking doc's directory, so
 * the host's `join` returning backslashes on Windows would make every root doc's
 * links look broken.
 */
const docPath = (...parts: string[]): string => posix(posixPath.join(...parts));

const repo = posix(join(import.meta.dir, ".."));
const testDir = posix(join(import.meta.dir, "..", "test"));
const extensionsDir = posix(join(import.meta.dir, "..", "extensions"));
const libDir = posix(join(import.meta.dir, "..", "lib"));
const scriptsDir = posix(join(import.meta.dir, "..", "scripts"));

/** A file's text, read once per test run; tests write only under OS temp dirs. */
const textCache = new Map<string, string>();
function textOf(file: string): string {
	const cached = textCache.get(file);
	if (cached !== undefined) return cached;
	const text = readFileSync(file, "utf-8");
	textCache.set(file, text);
	return text;
}

/** A tree walk, run once per root; `existsSync`/`statSync` stay uncached. */
const walkCache = new Map<string, string[]>();
function filesIn(root: string): string[] {
	const cached = walkCache.get(root);
	if (cached !== undefined) return cached;
	const files = walkFiles(root);
	walkCache.set(root, files);
	return files;
}

function dirsOf(dir: string): string[] {
	return readdirSync(dir)
		.filter((name) => statSync(join(dir, name)).isDirectory())
		.sort();
}

const ROOT_TEST_FILES = new Set([
	"architecture-doc.test.ts",
	"project-docs-skill.test.ts",
	"config-docs.test.ts",
	"dependencies.test.ts",
	"docs-parity.test.ts",
	"drift.test.ts",
	"extension-docs.test.ts",
	"extension-load.test.ts",
	"naming.test.ts",
	"prompt-budget.test.ts",
	"refactor-skill.test.ts",
	"release.test.ts",
	"roadmap.test.ts",
	"scripts-surface.test.ts",
	"settings-coverage.test.ts",
	"shared-helpers.test.ts",
	"skill-bank.test.ts",
	"structure.test.ts",
	"theme.test.ts",
	"tool-render.test.ts",
]);

/**
 * Every directory whose capability suites the banned-pattern scan covers.
 * `extensions/` is enumerated so a new extension is covered automatically;
 * `lib/` is included explicitly.
 */
const SCANNED_DIRS: string[] = [...dirsOf(extensionsDir).map((name) => join(extensionsDir, name)), libDir];

/** The dirs whose plain source the banned-pattern scan covers: `scripts/` is dev tooling, and shipped nowhere. */
const SOURCE_DIRS: string[] = [...SCANNED_DIRS, scriptsDir];

/** Files whose violations are accepted with a stated reason. Keep this tiny. */
const EXEMPT_FILES = new Set<string>([]);

interface Ban {
	name: string;
	matches: (line: string) => boolean;
	reason: string;
}

const BANS: Ban[] = [
	{
		name: "mock.module",
		matches: (line) => /\bmock\.(module|restore)\s*\(/.test(line),
		reason: "use createFakePi or add a seam",
	},
	{
		name: "process.env write",
		matches: (line) =>
			/\bprocess\.env\s*(?:\.[A-Za-z_]\w*|\[\s*[^\]]+\s*\])\s*=(?!=)|\bdelete\s+process\.env\s*(?:\.[A-Za-z_]\w*|\[\s*[^\]]+\s*\])/.test(
				line,
			),
		reason: "use test/helpers/env.ts",
	},
	{
		name: "real timer",
		matches: (line) => /\bset(Timeout|Interval)\s*\(/.test(line),
		reason: "use settle() from test/helpers/process.ts",
	},
	{
		name: "wall clock",
		matches: (line) => /\bDate\.now\s*\(|\bnew\s+Date\s*\(/.test(line),
		reason: "inject makeClock() from test/helpers/clock.ts",
	},
	{
		name: "padding assertion",
		matches: (line) => /\b(?:toBe|toEqual|toContain|toMatch)\s*\(\s*[`"'][^`"'\n]* {3,}[^`"'\n]*[`"']/.test(line),
		reason: "assert fields/width/order, not column padding",
	},
	{
		name: "local theme double",
		matches: (line) => /\bfg\s*:/.test(line),
		reason: "use fakeTheme from test/helpers/fakes.ts",
	},
];

/**
 * The same bans, on extension, `lib/`, and `scripts/` **source** (not `.test.ts`):
 * the half of `AGENTS.md` "Code quality" a line scan can hold. The capture
 * scripts are unshipped dev tooling, which is why they are not in `SCANNED_DIRS`
 * with the renderer and boundary scans, but they are still read as code.
 */
const SOURCE_BANS: Ban[] = [
	{
		name: "todo",
		matches: (line) => /\b(?:TODO|FIXME|HACK|XXX)\b/.test(line),
		reason: "do it, or file it in ROADMAP.md",
	},
	{
		name: "suppression",
		matches: (line) => /@ts-(?:ignore|expect-error|nocheck)|biome-ignore|eslint-disable/.test(line),
		reason: "fix the type or the rule, or state the exception in a comment",
	},
	{
		name: "any",
		matches: (line) => /\bas\s+any\b|:\s*any\b|<any>|\bany\[\]/.test(line),
		reason: "use unknown at the boundary, or name the host type",
	},
	{
		// Prose comments are not code: these are the shapes a commented-out statement
		// takes, and `// for the duration of a call` is the case they must not match.
		name: "commented-code",
		matches: (line) =>
			/^\s*\/\/\s*(?:const|let|var|return|import|export|function|class|interface|enum|await)\b/.test(line) ||
			/^\s*\/\/\s*(?:if|for|while|switch)\s*\(/.test(line) ||
			/^\s*\/\/\s*\}/.test(line),
		reason: "delete it; git has the version that worked",
	},
];

/**
 * Lines in `file` that match one of `bans`, as `path:line: alert (reason)`.
 * A line may opt out of one ban with an `allow:<name>` comment on that line or
 * in the comment block directly above it, when the matched text is genuine
 * content (a whitespace-normalisation assertion, a host seam no shared type can
 * name) and not a shortcut.
 */
function scanBans(file: string, bans: Ban[] = BANS, exempt: Set<string> = EXEMPT_FILES): string[] {
	if (exempt.has(file)) return [];
	const relative = file.slice(repo.length + 1);
	const violations: string[] = [];
	const lines = textOf(file).split("\n");
	lines.forEach((line, index) => {
		for (const ban of bans) {
			if (allowsAt(lines, index, `allow:${ban.name}`)) continue;
			if (ban.matches(line)) violations.push(`${relative}:${index + 1}: ${ban.name} (${ban.reason})`);
		}
	});
	return violations;
}

/** Every suite path declared by the manifest, relative to the repository root. */
function declaredSuiteFiles(): string[] {
	return [
		...Object.entries(EXTENSION_SUITES).flatMap(([name, suites]) =>
			suites.map((suite) => `extensions/${name}/${suite}.test.ts`),
		),
		...LIB_SUITES.map((suite) => `lib/${suite}.test.ts`),
		...SCRIPT_SUITES.map((suite) => `scripts/${suite}.test.ts`),
	].sort();
}

/** Every test file the layout governs, relative to the repository root. */
function layoutTestFiles(): string[] {
	return [extensionsDir, libDir, posix(join(repo, "scripts"))]
		.flatMap((root) => filesIn(root))
		.filter((file) => file.endsWith(".test.ts"))
		.map((file) => file.slice(repo.length + 1))
		.sort();
}

describe("test layout", () => {
	test("test/ holds only helpers and package-level tests", () => {
		expect(dirsOf(testDir)).toEqual(["helpers"]);
		const rootTests = readdirSync(testDir).filter((name) => name.endsWith(".test.ts"));
		expect(new Set(rootTests)).toEqual(ROOT_TEST_FILES);
	});

	test("every extension has a declared suite", () => {
		const missing = dirsOf(extensionsDir).filter((name) => (EXTENSION_SUITES[name] ?? []).length === 0);
		expect(missing, "declare a capability suite in test/suite-manifest.ts").toEqual([]);
	});

	test("helper files live only under test/helpers", () => {
		const helperFiles = [extensionsDir, libDir, testDir]
			.flatMap((root) => filesIn(root))
			.filter((file) => file.endsWith("/helpers.ts") && !file.startsWith(`${testDir}/helpers`));
		expect(helperFiles).toEqual([]);
	});

	test("every test file is a declared suite", () => {
		const declared = new Set(declaredSuiteFiles());
		const offenders = layoutTestFiles().filter((file) => !declared.has(file));
		expect(offenders, "declare the suite in test/suite-manifest.ts").toEqual([]);
	});

	test("every declared suite exists", () => {
		const missing = declaredSuiteFiles().filter((file) => !existsSync(join(repo, file)));
		expect(missing, "create the declared suite, or remove it from the manifest").toEqual([]);
	});
});

describe("test conventions", () => {
	test("test files avoid the banned test patterns", () => {
		const offenders: string[] = [];
		for (const dir of SCANNED_DIRS) {
			for (const file of filesIn(dir)) {
				if (file.endsWith(".test.ts")) offenders.push(...scanBans(file));
			}
		}
		expect(offenders).toEqual([]);
	});
});

/** Extension/lib source files (not `.test.ts`). */
function sourceFiles(root: string): string[] {
	return filesIn(root).filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"));
}

/** The line bar from AGENTS.md "Code quality". */
const MAX_MODULE_LINES = 600;

/**
 * Source modules over the bar, each with the one responsibility that keeps it
 * whole and its own height. Listing a module here is a deliberate choice, so a
 * new oversized module fails until someone states why it stays; the height makes
 * the entry a ceiling rather than a licence, since one added line fails and only
 * a smaller file lowers it. An entry that drops below the bar is stale and fails
 * too, so the list cannot quietly grow.
 */
const LONG_MODULES: Record<string, { lines: number; why: string }> = {
	"extensions/file-browse/view/markdown.ts": {
		lines: 878,
		why: "one escape-first block and inline scan for README Markdown",
	},
	"extensions/job/runtime.ts": {
		lines: 957,
		why: "the session's job table, child handles, and repaint clock",
	},
	"extensions/wechat/bridge.ts": {
		lines: 704,
		why: "the bridge's composition root, connection lifecycle, and status snapshot",
	},
	"extensions/worktree/guard.ts": {
		lines: 612,
		why: "the five isolation guards over one shell-escape predicate",
	},
	"lib/highlight.ts": {
		lines: 1000,
		why: "one tokenizer per language over a shared escape-first scan",
	},
	"lib/requirements.ts": {
		lines: 809,
		why: "one prerequisite table plus the pure probe over its injected seams",
	},
};

/**
 * The named modules' total, written down so raising one height has to lower
 * another. It falls whenever a module shrinks; it never rises.
 */
const LONG_MODULE_TOTAL = 4960;

/** Lines in a module, counted the way `wc -l` does (a trailing newline does not count). */
function lineCount(file: string): number {
	return textOf(file).replace(/\n$/, "").split("\n").length;
}

/** A `renderCall(` / `renderResult(` definition at the start of a line. */
const RENDERER_DEF = /^\s*(?:async\s+)?render(?:Call|Result)\s*\(/m;
/** The raw expand keybinding id; import `EXPAND_KEYBINDING` from `lib/tui/glyphs.ts`. */
const RAW_EXPAND_KEY = /"app\.tools\.expand"/;
/** A literal expand key, which ignores a rebound keybinding. */
const LITERAL_EXPAND_KEY = /Ctrl\+O|ctrl\+o/;

describe("source conventions", () => {
	test("source avoids the banned patterns", () => {
		const offenders: string[] = [];
		for (const dir of SOURCE_DIRS) {
			for (const file of sourceFiles(dir)) offenders.push(...scanBans(file, SOURCE_BANS));
		}
		expect(offenders).toEqual([]);
	});

	test("a component that answers Pi's focus check can be assigned the flag", () => {
		// Pi's `isFocusable` is `"focused" in component`, and TUI then writes
		// `component.focused = true` when focus moves. A read-only accessor under that
		// name crashes the process on the way back to the editor, so declaring it means
		// declaring both halves — or naming the getter for what it actually returns.
		const offenders: string[] = [];
		for (const dir of SCANNED_DIRS) {
			for (const file of sourceFiles(dir)) {
				const text = textOf(file);
				if (!/\bget focused\s*\(/.test(text) || /\bset focused\s*\(/.test(text)) continue;
				offenders.push(
					`${file.slice(repo.length + 1)}: declares a getter-only \`focused\`; Pi assigns that flag, so add a setter or rename the getter`,
				);
			}
		}
		expect(offenders).toEqual([]);
	});

	test("a module over the line bar states the responsibility that keeps it whole", () => {
		const offenders: string[] = [];
		for (const root of [extensionsDir, libDir, scriptsDir]) {
			for (const file of sourceFiles(root)) {
				const relative = file.slice(repo.length + 1);
				const lines = lineCount(file);
				if (lines <= MAX_MODULE_LINES || LONG_MODULES[relative] !== undefined) continue;
				offenders.push(`${relative}: ${lines} lines; split it, or name it in LONG_MODULES with the one responsibility`);
			}
		}
		expect(offenders).toEqual([]);
	});

	test("a named module keeps its own height, never headroom", () => {
		// A height above the file would pass a few new lines through, which is the
		// growth this gate exists to stop.
		const slack = Object.entries(LONG_MODULES)
			.filter(([relative, entry]) => lineCount(join(repo, relative)) !== entry.lines)
			.map(
				([relative, entry]) =>
					`${relative}: named ${entry.lines}, file ${lineCount(join(repo, relative))}; set it to the file's height`,
			);
		expect(slack).toEqual([]);
	});

	test("LONG_MODULES carries no stale entry", () => {
		const stale = Object.keys(LONG_MODULES).filter((relative) => {
			const path = join(repo, relative);
			return !existsSync(path) || lineCount(path) <= MAX_MODULE_LINES;
		});
		expect(stale, "delete the entry: that module fits the bar again").toEqual([]);
	});

	test("the named modules cannot grow in total", () => {
		const total = Object.values(LONG_MODULES).reduce((sum, entry) => sum + entry.lines, 0);
		expect(total, "lower LONG_MODULE_TOTAL with the file: a split lowers it, nothing raises it").toBe(
			LONG_MODULE_TOTAL,
		);
	});

	test("tool renderers reuse context.lastComponent", () => {
		const offenders: string[] = [];
		for (const dir of SCANNED_DIRS) {
			for (const file of sourceFiles(dir)) {
				const text = textOf(file);
				if (RENDERER_DEF.test(text) && !text.includes("lastComponent")) {
					offenders.push(`${file.slice(repo.length + 1)}: renderer does not reuse context.lastComponent`);
				}
			}
		}
		expect(offenders).toEqual([]);
	});

	test("extensions bind the expand affordance to the shared keybinding id", () => {
		const offenders: string[] = [];
		for (const name of dirsOf(extensionsDir)) {
			for (const file of sourceFiles(join(extensionsDir, name))) {
				const relative = file.slice(repo.length + 1);
				textOf(file)
					.split("\n")
					.forEach((line, index) => {
						if (RAW_EXPAND_KEY.test(line)) {
							offenders.push(`${relative}:${index + 1}: import EXPAND_KEYBINDING from lib/tui/glyphs.ts`);
						}
						if (LITERAL_EXPAND_KEY.test(line)) {
							offenders.push(`${relative}:${index + 1}: use keyText(EXPAND_KEYBINDING), not a literal key`);
						}
					});
			}
		}
		expect(offenders).toEqual([]);
	});
});

describe("extension boundaries", () => {
	/** A specifier from a static import/export, a side-effect import, or a dynamic import. */
	const MODULE_SPEC = /(?:\bfrom\b|\bimport\s*\(?)\s*["']([^"']+)["']/;

	test("an extension never imports another extension's modules", () => {
		const names = dirsOf(extensionsDir);
		const offenders: string[] = [];
		for (const name of names) {
			for (const file of filesIn(join(extensionsDir, name))) {
				if (!file.endsWith(".ts")) continue;
				const relative = file.slice(repo.length + 1);
				const dir = file.slice(0, file.lastIndexOf("/"));
				textOf(file)
					.split("\n")
					.forEach((line, index) => {
						const spec = MODULE_SPEC.exec(line)?.[1];
						if (spec === undefined || !spec.startsWith(".")) return;
						const target = posix(join(dir, spec));
						const owner = names.find((other) => other !== name && target.startsWith(`${extensionsDir}/${other}/`));
						if (owner !== undefined) {
							offenders.push(`${relative}:${index + 1}: imports extensions/${owner} (${spec}); share it through lib/`);
						}
					});
			}
		}
		expect(offenders).toEqual([]);
	});
});

describe("lib value-only", () => {
	/**
	 * A module-scope `let` / `var`: unindented, so a `let` inside a function stays
	 * local to its closure, which is the only state `lib/` may hold.
	 */
	const MODULE_BINDING = /^(?:export\s+)?(?:let|var)\b/;
	/**
	 * The mutable containers state takes when it is not a `let`. `new Set(...)` is
	 * not here on purpose: a keyword table is data, and the one shape this bans is
	 * a container a module can add to while it lives.
	 */
	const MODULE_CONTAINER = /^(?:export\s+)?const\s+[A-Za-z_$][\w$]*[^=]*=\s*(?:new\s+(?:Map|WeakMap|Array)\b|\[\])/;

	test("lib/ keeps no module-level state", () => {
		// Pi loads each extension with its own module cache, so a module variable here
		// is one copy per extension, not one shared value. lib/README.md states it.
		const offenders: string[] = [];
		for (const file of sourceFiles(libDir)) {
			textOf(file)
				.split("\n")
				.forEach((line, index) => {
					if (MODULE_BINDING.test(line) || MODULE_CONTAINER.test(line)) {
						offenders.push(
							`${file.slice(repo.length + 1)}:${index + 1}: module-level state; carry it in the caller's closure`,
						);
					}
				});
		}
		expect(offenders).toEqual([]);
	});
});

describe("prerequisite declarations", () => {
	test("every extension declares its runtime prerequisites", () => {
		const undeclared = dirsOf(extensionsDir).filter((name) => REQUIREMENTS[name] === undefined);
		expect(undeclared, "add an entry to REQUIREMENTS in lib/requirements.ts").toEqual([]);
	});

	test("every declared config file is one the extension actually reads", () => {
		const offenders: string[] = [];
		for (const [name, spec] of Object.entries(REQUIREMENTS)) {
			const declared = spec.configFiles ?? [];
			if (declared.length === 0) continue;
			const sources = filesIn(join(extensionsDir, name)).filter((file) => file.endsWith("/config.ts"));
			for (const file of declared) {
				if (sources.length === 0) {
					offenders.push(`${name}: declares ${file} but has no config.ts`);
					continue;
				}
				const literal = sources.some((source) => textOf(source).includes(`"${file}"`));
				// The shared document is read through `loadConfigSection`, so a section
				// loader is the evidence, not the bare filename.
				const shared =
					file === SHARED_CONFIG_FILE && sources.some((source) => textOf(source).includes("loadConfigSection("));
				if (!literal && !shared) offenders.push(`${name}: no config.ts reads ${file}`);
			}
		}
		expect(offenders).toEqual([]);
	});
});

describe("doc links", () => {
	/** Every Markdown doc a user or contributor reads, from the root and the doc trees. */
	function docFiles(): string[] {
		const trees = ["docs", "extensions", "lib", "skills", "test", ".github"].map((dir) => docPath(repo, dir));
		const rootDocs = readdirSync(repo)
			.filter((name) => name.endsWith(".md"))
			.map((name) => docPath(repo, name));
		return [...rootDocs, ...trees.flatMap((tree) => filesIn(tree))].filter((file) => file.endsWith(".md")).sort();
	}

	const MARKDOWN_LINK = /\]\(([^)\s]+)\)/g;
	const HEADING = /^#{1,6}\s+(.+?)\s*$/;
	const FENCE = /^\s*(?:```|~~~)/;

	/** GitHub's heading anchor: link text kept, emphasis dropped, punctuation gone, spaces hyphenated. */
	function anchorOf(heading: string): string {
		return heading
			.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
			.replace(/[`*]/g, "")
			.toLowerCase()
			.replace(/[^\p{L}\p{N} _-]/gu, "")
			.trim()
			.replace(/ /g, "-");
	}

	/** The anchors a rendered page offers, including GitHub's `-1`, `-2` suffixes for repeats. */
	function anchorsOf(text: string): Set<string> {
		const anchors = new Set<string>();
		const seen = new Map<string, number>();
		let fenced = false;
		for (const line of text.split("\n")) {
			if (FENCE.test(line)) {
				fenced = !fenced;
				continue;
			}
			const heading = fenced ? null : HEADING.exec(line)?.[1];
			if (heading === undefined || heading === null) continue;
			const base = anchorOf(heading);
			const count = seen.get(base) ?? 0;
			seen.set(base, count + 1);
			anchors.add(count === 0 ? base : `${base}-${count}`);
		}
		return anchors;
	}

	test("a doc path keeps one separator style whatever the host's join does", () => {
		expect(docPath("D:\\a\\my-pi-agent", "docs", "..", "README.md")).toBe("D:/a/my-pi-agent/README.md");
	});

	test("hyphenates each space, so an em dash between words leaves two", () => {
		// GitHub replaces every space, it does not collapse a run of them.
		expect(anchorOf("`price` — cost calculation")).toBe("price--cost-calculation");
	});

	test("every relative doc link resolves, anchor included", () => {
		const offenders: string[] = [];
		for (const file of docFiles()) {
			const relative = file.slice(repo.length + 1);
			const dir = file.slice(0, file.lastIndexOf("/"));
			for (const [, link] of textOf(file).matchAll(MARKDOWN_LINK)) {
				if (!link.startsWith("./") && !link.startsWith("../") && !link.startsWith("#")) continue;
				const hash = link.indexOf("#");
				const target = hash === -1 ? link : link.slice(0, hash);
				const anchor = hash === -1 ? "" : link.slice(hash + 1);
				const path = target === "" ? file : docPath(dir, target);
				if (!existsSync(path)) {
					offenders.push(`${relative}: ${link} (no such path)`);
					continue;
				}
				if (anchor !== "" && (!statSync(path).isFile() || !anchorsOf(textOf(path)).has(anchor))) {
					offenders.push(`${relative}: ${link} (no such anchor)`);
				}
			}
		}
		expect(offenders).toEqual([]);
	});
});
