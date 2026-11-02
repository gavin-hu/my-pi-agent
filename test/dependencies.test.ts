/**
 * The dependency budget: a runtime dependency must not load when an extension
 * registers.
 *
 * The package ships eight parser and image libraries as ordinary `dependencies`,
 * and the extension entrypoint is what Pi calls on every start. A dependency
 * imported at module scope is therefore paid on every session, whether or not
 * the feature is used; the house pattern is a dynamic `import()` inside the
 * function that needs it (`extract/xlsx.ts`, `lib/pdf.ts`). This walks each
 * entrypoint's **static** import graph and fails on a `dependencies` package,
 * with the chain that reaches it. A dynamic `import()` ends the walk, because
 * that is exactly the deferral the rule asks for.
 *
 * A genuine exception names its reason in `REGISTRATION_LOAD`; the map is empty
 * today, which is the honest state after the fixes this check found.
 *
 * The other half of a deferral is the contract: a module that reaches another through
 * `import()` may not re-declare a type that module exports. A facade cannot import a
 * value without loading it, so it restates — `review-lazy.ts` carried copies of
 * `review.ts`'s decision types until they drifted — while a *type* import is erased and
 * costs the registration path nothing. `restatedTypes` holds that half.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
	createSourceFile,
	forEachChild,
	isCallExpression,
	isInterfaceDeclaration,
	isStringLiteral,
	isTypeAliasDeclaration,
	ScriptTarget,
	SyntaxKind,
	type Node,
} from "typescript";
import { tempDir } from "./helpers/env.ts";
import { entrypoints, packageOf, resolveFile, staticGraph, staticSpecifiers } from "./helpers/graph.ts";

const REPO = join(import.meta.dir, "..");

/** Every extension entry on disk, sorted by name. */
const ENTRIES = entrypoints(join(REPO, "extensions"));

/** The extension an entry belongs to: `extensions/<name>/index.ts`. */
function extensionOf(entry: string): string {
	const parts = entry.split(/[\\/]/);
	return parts[parts.length - 2] ?? "";
}

interface PackageJson {
	dependencies?: Record<string, string>;
}

const PACKAGE = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")) as PackageJson;
const DEPENDENCIES = new Set(Object.keys(PACKAGE.dependencies ?? {}));

/**
 * A dependency allowed to load at registration, with the reason it must.
 *
 * The door is here rather than an exclude list in the scan: a reason is the price
 * of entry, so a new exception is a deliberate, reviewable sentence.
 */
const REGISTRATION_LOAD: Readonly<Record<string, string>> = {};

/**
 * The local modules one file defers through a literal `import()`.
 *
 * A deferral is the fix the rule above asks for, and it is also why a facade restates
 * what it cannot statically import: `review-lazy.ts` declared `review.ts`'s types twice
 * over. A computed specifier, or a thunk passed in from elsewhere, has no edge here.
 */
function deferredTargets(file: string): string[] {
	const source = createSourceFile(file, readFileSync(file, "utf8"), ScriptTarget.Latest, true);
	const found: string[] = [];
	const visit = (node: Node): void => {
		if (isCallExpression(node) && node.expression.kind === SyntaxKind.ImportKeyword) {
			const [specifier] = node.arguments;
			if (specifier && isStringLiteral(specifier)) {
				const target = resolveFile(file, specifier.text);
				if (target !== null) found.push(target);
			}
		}
		forEachChild(node, visit);
	};
	forEachChild(source, visit);
	return found;
}

/** The names a module exports as a type: an `interface`, or a `type` alias. */
function exportedTypes(file: string): string[] {
	const source = createSourceFile(file, readFileSync(file, "utf8"), ScriptTarget.Latest, true);
	const found: string[] = [];
	for (const statement of source.statements) {
		if (!isInterfaceDeclaration(statement) && !isTypeAliasDeclaration(statement)) continue;
		const exported = statement.modifiers?.some((modifier) => modifier.kind === SyntaxKind.ExportKeyword);
		if (exported !== true || statement.name === undefined) continue;
		found.push(statement.name.text);
	}
	return found;
}

/** How many deferral edges the tree has, so a walker that stopped resolving cannot pass. */
export function deferralEdges(files: readonly string[]): number {
	return files.reduce((total, file) => total + deferredTargets(file).length, 0);
}

/**
 * Rule 5: a module that defers another may not re-declare a type that module exports.
 *
 * A facade cannot import a value without loading it, so it restates — `review-lazy.ts`
 * carried copies of `review.ts`'s decision types, and they had already drifted apart. A
 * *type* import is erased, so naming the contract costs nothing and the copy is the only
 * thing that can go wrong.
 */
export function restatedTypes(files: readonly string[]): string[] {
	const types = new Map(files.map((file) => [file, exportedTypes(file)]));
	const violations: string[] = [];
	for (const file of files) {
		const mine = types.get(file) ?? [];
		if (mine.length === 0) continue;
		for (const target of deferredTargets(file)) {
			const theirs = new Set(types.get(target) ?? []);
			for (const name of mine) {
				if (!theirs.has(name)) continue;
				violations.push(
					`${repoRelative(file)}:${name} re-declares ${repoRelative(target)}:${name}; name it with an import type instead`,
				);
			}
		}
	}
	return [...new Set(violations)].sort();
}

/** A readable chain from the entrypoint to the module that made the import. */
function chainOf(parents: ReadonlyMap<string, string>, file: string): string {
	const walked = [file];
	let current = parents.get(file);
	while (current !== undefined) {
		walked.unshift(current);
		current = parents.get(current);
	}
	return walked.map((step) => relative(REPO, step)).join(" → ");
}

/** Each dependency one entrypoint loads at registration, with the chain that reaches it. */
function registrationLoads(entry: string): string[] {
	const parents = new Map<string, string>();
	const queue = [entry];
	const found: string[] = [];
	while (queue.length > 0) {
		const file = queue.shift() as string;
		for (const specifier of staticSpecifiers(file)) {
			const pkg = packageOf(specifier);
			if (pkg !== null && DEPENDENCIES.has(pkg) && !(pkg in REGISTRATION_LOAD)) {
				found.push(`${chainOf(parents, file)} imports "${pkg}"`);
				continue;
			}
			if (pkg !== null) continue;
			const target = resolveFile(file, specifier);
			if (target !== null && !parents.has(target)) {
				parents.set(target, file);
				queue.push(target);
			}
		}
	}
	return found;
}

describe("dependency budget", () => {
	test("no runtime dependency loads when an extension registers", () => {
		const loads = [...new Set(ENTRIES.flatMap(registrationLoads))].sort();
		expect(
			loads,
			"load the package inside the function that needs it (the extract/xlsx.ts pattern), or name a reason in REGISTRATION_LOAD",
		).toEqual([]);
	});

	test("the scan tells a static import from a dynamic one", () => {
		// The guard is only as good as this distinction: a dynamic import is the fix,
		// so counting it as a load would make every correct deferral fail.
		const dir = tempDir("dep-scan-");
		const file = join(dir, "sample.ts");
		writeFileSync(
			file,
			[
				'import value from "static-default";',
				'import { named } from "static-named";',
				'import type { Shape } from "type-only";',
				'import { type Only } from "type-named";',
				'import mixed, { type Also } from "mixed";',
				'import "side-effect";',
				'export * from "reexported";',
				'export type { Gone } from "type-reexport";',
				'const lazy = await import("dynamic");',
				"void lazy; void value; void named; void mixed;",
			].join("\n"),
		);
		expect(staticSpecifiers(file).sort()).toEqual([
			"mixed",
			"reexported",
			"side-effect",
			"static-default",
			"static-named",
		]);
	});
});

/**
 * A surface that loads on first use, with the sentence that says when.
 *
 * The entry modules are what Pi calls on every start, so a static import here is
 * the regression: the feature is registered, but its page, server, or screen is
 * not needed until a command or a TUI branch asks for it.
 */
/**
 * The surfaces a rule keeps out, rather than a list that keeps growing.
 *
 * A full-screen surface lives under `view/` — the `wechat` doc's "`view/` draws a
 * full-screen surface" is the same rule — and the served-page kit (`lib/http/`,
 * `mount.ts` excepted) is only reachable from one. Filing a screen under `view/`
 * is therefore what makes it lazy; there is no row to remember.
 */
const DEFERRED_BY_RULE: readonly RegExp[] = [
	/^extensions\/[^/]+\/view\/[^/]+\.ts$/,
	/^lib\/http\/(?!mount\.ts$)[^/]+\.ts$/,
];

/** Whether a repo-relative module is one the rules keep off the registration path. */
function deferredByRule(path: string): boolean {
	return DEFERRED_BY_RULE.some((rule) => rule.test(path));
}

/** Why a rule-matched module is deferred, for the failure message. */
function ruleOf(path: string): string {
	return path.startsWith("lib/http/")
		? "the served-page kit loads when a page is served, never at registration"
		: "a full-screen surface loads in the TUI branch that opens it";
}

/**
 * The deferrals a rule cannot express, each with the sentence that says when it loads.
 *
 * A row here is an exception to `DEFERRED_BY_RULE`'s filing rule: a module that is
 * not a screen but still must not be paid at start.
 */
const DEFERRED_FROM_REGISTRATION: Readonly<Record<string, string>> = {
	"extensions/wechat/bridge.ts": "the bridge loads when an account is stored",
	"extensions/plan/web.ts": "the browser review loads on /plan review, /plan share, or the plan tool's exit action",
	"extensions/plan/review.ts": "the review gate and its TUI screen load on the first /plan review or plan exit",
	"extensions/plan/git-bash.ts": "the read-only git check loads when plan mode vets a bash call",
	"extensions/plan/path-guard.ts": "the path backstop loads when plan mode vets a tool call",
	"extensions/board/page.ts": "the board page loads on the first /board",
	"extensions/subagent/background.ts": "the background runtime loads on the first background run or /agents",
	"extensions/subagent/commands.ts": "the /agents command body loads when the command first runs",
	"extensions/subagent/ui.ts": "the footer chip loads with the background runtime it reports",
	"extensions/file-browse/transport/server.ts": "the browse server loads when /browse opens a page",
	"extensions/file-browse/config/config.ts": "the browse config loads when /browse opens a page",
	"extensions/file-browse/files/paths.ts": "the browse path guard loads when /browse resolves or serves a path",
	"extensions/file-browse/git/git.ts": "the browse status and diff load when /browse opens a page",
	"extensions/worktree/screen.ts": "the worktree screen loads in the TUI branch of /worktree",
	"extensions/bytefly/panel/tui.ts": "the panel screen loads in the TUI branch of /bytefly",
	"extensions/bytefly/panel/kit.ts": "the panel's listing, prices, and theme names load when /bytefly opens a surface",
	"extensions/bytefly/panel/format.ts": "the panel's listing text loads with panel/kit.ts",
	"extensions/bytefly/panel/join.ts": "the panel's model loads with panel/kit.ts",
	"extensions/bytefly/panel/prices.ts": "the price report loads on /bytefly prices",
	"extensions/bytefly/panel/themes.ts": "the shipped theme names load when /bytefly builds a settings view",
	"extensions/bytefly/picker/resources.ts":
		"the resource helpers load with the picker, when /bytefly resolves a listing",
	"extensions/bytefly/panel/settings-runtime.ts":
		"the settings runtime loads when /bytefly opens settings or the panel",
	"extensions/bytefly/picker/discovery.ts": "resource discovery loads when /bytefly lists or opens the panel",
	"extensions/bytefly/picker/runtime.ts": "the picker runtime loads when /bytefly opens its panel or a listing",
	"extensions/bytefly/panel/skills.ts": "the skill lookup loads when /bytefly lists skills or opens the panel",
};

/**
 * What each entry may statically evaluate, keyed by extension name.
 *
 * Like `LONG_MODULES`, the bar may only fall: a feature that needs more modules
 * has to justify the raise here, and a deferral that lands lowers it. The budget
 * is per entry rather than one total because Pi imports each extension with its
 * own module cache — a shared `lib/` module is paid once *per importing entry* —
 * so a total lets one entry balloon while another's deferral pays for it. The
 * total is their sum, 737.
 *
 * The heights moved as the tree did: the board's `bytefly.json` section became
 * one module (`board/config.ts`, read by `board` and by `team` through the store)
 * and the signer rule another (`board/lead.ts`); the page's seat (`board/seat.ts`)
 * became `lib/`, which the settings screen loads too. Folding `plan` into one
 * action tool adds one to `plan` and defers none — `tools/refusal.ts` is the one
 * rejected-call shape five actions share — and `worktree`'s folded tool draws
 * bytefly's generic fallback, exactly as its four tools did. `job`'s 1017-line
 * runtime became three modules of one responsibility, only the last of which
 * brings `lib/child.ts` with it: the three are the split, and every one of them
 * is what the old single module already evaluated, spread differently.
 * `worktree`'s one raise is `lib/events.ts`: the channel `file-browse` follows moved
 * out of the publishing module, so both sides compile against one name.
 */
const ENTRY_BUDGET: Readonly<Record<string, number>> = {
	bytefly: 86,
	board: 58,
	plan: 55,
	team: 48,
	job: 43,
	"session-bus": 43,
	subagent: 31,
	"web-access": 39,
	worktree: 36,
	goal: 34,
	watch: 32,
	todo: 30,
	wechat: 30,
	check: 29,
	"file-read": 29,
	rewind: 28,
	memory: 27,
	question: 18,
	serve: 11,
	context: 8,
	"file-open": 5,
	"file-browse": 2,
};

/** A repo-relative path with forward slashes, the form the maps use. */
function repoRelative(file: string): string {
	return relative(REPO, file).replaceAll("\\", "/");
}

/** Every `.ts` module under `extensions/` and `lib/`, for the rule and map checks. */
function everySourceFile(): string[] {
	const found: string[] = [];
	const walk = (dir: string): void => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) walk(path);
			else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) found.push(path);
		}
	};
	for (const dir of ["extensions", "lib"]) walk(join(REPO, dir));
	return found;
}

/** Every local module one entrypoint loads statically, its entry included. */

describe("registration module budget", () => {
	test("the deferred surfaces do not load when an extension registers", () => {
		const offenders: string[] = [];
		for (const entry of ENTRIES) {
			const graph = staticGraph(entry);
			const reached = new Set([...graph].map(repoRelative));
			for (const path of reached) {
				if (deferredByRule(path)) offenders.push(`${repoRelative(entry)} statically imports ${path}; ${ruleOf(path)}`);
			}
			for (const [path, when] of Object.entries(DEFERRED_FROM_REGISTRATION)) {
				if (!reached.has(path)) continue;
				offenders.push(`${repoRelative(entry)} statically imports ${path}; ${when}`);
			}
		}
		expect(
			offenders,
			"load the module inside the command, handler, or TUI branch that needs it; a static import pays it on every start",
		).toEqual([]);
	});

	test("the deferral map carries no stale entry", () => {
		const stale = Object.keys(DEFERRED_FROM_REGISTRATION).filter((path) => !existsSync(join(REPO, path)));
		expect(stale, "drop the row, or restore the module it names").toEqual([]);
	});

	test("every rule still names a module on disk", () => {
		// A rule that matches nothing has quietly stopped applying, the same failure
		// mode `LONG_MODULES`' stale-entry test covers.
		const files = everySourceFile().map(repoRelative);
		const dead = DEFERRED_BY_RULE.filter((rule) => !files.some((file) => rule.test(file)));
		expect(dead.map(String), "a rule that matches nothing has stopped applying; fix it or drop it").toEqual([]);
	});

	test("every entry's registration graph stays inside its budget", () => {
		const offenders = ENTRIES.filter((entry) => staticGraph(entry).size > (ENTRY_BUDGET[extensionOf(entry)] ?? 0)).map(
			(entry) => {
				const name = extensionOf(entry);
				return `${name}: ${staticGraph(entry).size} static modules, budget ${ENTRY_BUDGET[name] ?? 0}; defer a surface or raise the row`;
			},
		);
		expect(offenders, "static module evaluations per entry; each row in ENTRY_BUDGET may only fall").toEqual([]);
	});

	test("every entry has a budget, and every budget names an entry", () => {
		const names = ENTRIES.map(extensionOf);
		const missing = names.filter((name) => !(name in ENTRY_BUDGET)).map((name) => `${name}: no row in ENTRY_BUDGET`);
		const stale = Object.keys(ENTRY_BUDGET)
			.filter((name) => !names.includes(name))
			.map((name) => `${name}: row names no extension on disk`);
		expect([...missing, ...stale], "a new extension enters the budget; a deleted one leaves it").toEqual([]);
	});
});

describe("deferred contracts", () => {
	test("a module that defers to another restates none of its types", () => {
		const files = everySourceFile();
		// A walker that stopped resolving `import()` would leave both checks below vacuous.
		expect(deferralEdges(files), "the tree defers tens of modules").toBeGreaterThan(20);
		expect(
			restatedTypes(files),
			"import the type from the module the facade defers to; a type import is erased, so it costs the registration path nothing",
		).toEqual([]);
	});

	test("the check tells a restated type from an imported one", () => {
		const dir = tempDir("deferral-");
		const impl = join(dir, "impl.ts");
		const facade = join(dir, "facade.ts");
		writeFileSync(impl, "export interface Choice { action: string }\nexport type Decision = { ok: boolean };\n");
		// The facade restates one type and names the other, which is the whole rule.
		writeFileSync(
			facade,
			[
				'import type { Choice } from "./impl.ts";',
				"export type Decision = { ok: boolean };",
				'export const load = (): Promise<unknown> => import("./impl.ts");',
				"export type Loaded = Choice | Decision;",
			].join("\n"),
		);

		const violations = restatedTypes([impl, facade]);
		expect(violations).toHaveLength(1);
		expect(violations[0]).toContain("facade.ts:Decision re-declares");
		expect(violations[0]).toContain("impl.ts:Decision");
		expect(deferralEdges([impl, facade])).toBe(1);

		// The fix is what the real tree does: the facade names the type and declares none.
		writeFileSync(
			facade,
			[
				'import type { Choice, Decision } from "./impl.ts";',
				'export const load = (): Promise<unknown> => import("./impl.ts");',
				"export type Loaded = Choice | Decision;",
			].join("\n"),
		);
		expect(restatedTypes([impl, facade])).toEqual([]);
	});
});
