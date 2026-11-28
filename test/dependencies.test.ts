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
import { posixPath } from "../lib/path.ts";
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
import {
	cachedSpecifiers,
	entrypoints,
	packageOf,
	resolveFile,
	staticGraph,
	staticSpecifiers,
} from "./helpers/graph.ts";

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
	test("a cached reader hands a shared module to the walk once, however many entries reach it", () => {
		// Every entry reaches the same shared modules, and each uncached read is a parse: one walk
		// of this tree spent 19,513 reads over 946 files.
		const dir = tempDir("graph-cache-");
		writeFileSync(join(dir, "shared.ts"), "export const shared = 1;\n");
		writeFileSync(join(dir, "one.ts"), 'import { shared } from "./shared.ts";\nvoid shared;\n');
		writeFileSync(join(dir, "two.ts"), 'import { shared } from "./shared.ts";\nvoid shared;\n');
		const reads: string[] = [];
		const read = cachedSpecifiers((file) => {
			reads.push(file);
			return staticSpecifiers(file);
		});
		expect(staticGraph(join(dir, "one.ts"), read).size).toBe(2);
		expect(staticGraph(join(dir, "two.ts"), read).size).toBe(2);
		const shared = reads.filter((file) => file.endsWith("shared.ts"));
		expect(shared, "a shared module is parsed once per reader").toHaveLength(1);
	});
});

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
 * The deferrals a rule cannot express, each with the sentence that says when it loads: the entry
 * modules are what Pi calls on every start, so a static import here is the regression — the feature
 * is registered, but its page, server, or screen is not needed until a command or a TUI branch asks
 * for it. A row here is an exception to `DEFERRED_BY_RULE`'s filing rule: a module that is not a
 * screen but still must not be paid at start.
 */
const DEFERRED_FROM_REGISTRATION: Readonly<Record<string, string>> = {
	"extensions/wechat/bridge.ts": "the bridge loads when a bound session starts it",
	"extensions/plan/web.ts": "the browser page loads on /plan list's Enter or the plan tool's exit action",
	"extensions/plan/review.ts": "the review gate and its TUI screen load on the first plan exit",
	"lib/git/read-command.ts": "the read-only git check loads when a mode vets a bash call",
	"extensions/plan/path-guard.ts": "the path backstop loads when plan mode vets a tool call",
	"extensions/board/page.ts": "the board page loads on the first /board",
	"lib/workflow/proven-remove.ts": "the proven removal loads with the first lock release or takeover",
	"extensions/session-bus/cursor.ts": "the record's cursor loads when the bus starts, never at registration",
	"extensions/session-bus/labels.ts": "the name a join settles loads with the join, never at registration",
	"extensions/session-bus/status.ts": "the rows load on the first status, board, or snapshot read",
	"extensions/subagent/background.ts": "the background runtime loads on the first background run or /agents",
	"extensions/subagent/commands.ts": "the /agents command body loads when the command first runs",
	"extensions/subagent/ui.ts": "the footer chip loads with the background runtime it reports",
	"extensions/file-browse/transport/server.ts": "the browse server loads when /browse opens a page",
	"extensions/file-browse/config/config.ts": "the browse config loads when /browse opens a page",
	"extensions/file-browse/files/paths.ts": "the browse path guard loads when /browse resolves or serves a path",
	"extensions/file-browse/git/git.ts": "the browse status and diff load when /browse opens a page",
	"extensions/code-review/config/config.ts": "the review config loads when /review opens a page",
	"extensions/code-review/git/diff.ts": "the review's snapshot reader loads when a page opens or a write checks it",
	"extensions/code-review/transport/router.ts": "the review's routes load with the page's mount",
	"extensions/code-review/transport/server.ts": "the review server loads on the first /review or code_review open",
	"extensions/code-review/review/store.ts": "the review's own record loads with the page that holds it",
	"extensions/code-review/review/session.ts": "the session's page lifecycle loads on its first open",
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
 * so a total lets one entry balloon while another's deferral pays for it — and a total
 * nothing asserts is a fact with nothing holding it, so the rows are the fact.
 *
 * `board` 62 -> 63, `team` 52 -> 53, `job` 45 -> 46 and `session-bus` 44 -> 45 for
 * `lib/session-files.ts`: the bus's layout, its one stored-name rule and its two publishes are the
 * file layer every bus reader shares, and they are reached through `lib/session-roster.ts`, which
 * each of those entries already loads — so the cost is one pure module in four graphs, not a new
 * graph. It cannot defer: a record, an inbox name and a claim are spelled by it before the first
 * read, and the board's tab counts a repository's mail through it with no bus running.
 *
 * That reason was wrong about three of the four, and #658 is the correction rather than a
 * deletion: nothing spells a path before the first read — every use is inside an async body — so
 * the layer now loads where a read needs it, and `board` 63 -> 62, `team` 53 -> 52 and
 * `job` 46 -> 45 pay it back. What could not defer was the *edge*, not the read: the roster's
 * constants, `workflow/session.ts`'s `BUS_DIR_NAME` and `session-mail.ts`'s four imports were each
 * a static import used only inside functions, and the one genuine blocker was `idOfFile`, a
 * synchronous rule over the bus's suffix — it moved to its only caller, `session-bus`'s
 * `mail-store.ts`, where the suffix is already imported. `session-bus` keeps 45: its
 * `createBusStore` and `createMailStore` are synchronous factories whose methods close over
 * `busPaths`, so deferring there means an async factory, which is a refactor of the writer for a
 * budget three other rows are about. The lesson for a later reader is the one this note exists
 * to carry: "reached through X" names one carrier, and a static import is a graph edge that can be
 * moved into a function without changing what any caller waits on.
 *
 * `plan` went 56 -> 57: the transcript's approved-plan preview draws the review
 * screen's task box through the kit's `checkbox` rather than keeping a second copy
 * of the two roles, and the row grammar brings its own margin with it.
 *
 * `session-bus` went 44 -> 45 for `send-request.ts`: the send a command makes has to be
 * answerable before any tool or session start, exactly as the join request does, so the
 * listener cannot defer behind a first call. It is the second surface a command context
 * needs, and the row holds both.
 *
 * `session-bus` 45 -> 46 for `claim-request.ts`, on the same terms: a path claim is asked for
 * by a turn start (`board`'s re-claim) and by a command, and neither has a nested tool call,
 * so the listener is registered with the join and the send ones rather than deferred.
 *
 * `subagent` went 33 -> 34: an aborted or timed-out run signals the process tree, so
 * `run.ts` asks `lib/spawn.ts` for a child in its own group and for the group kill, the
 * rule `job` and `watch` already share, instead of a second copy of `kill(-pid)` and
 * `taskkill /T` in the runner.
 *
 * `board` went 59 -> 60 and `team` 49 -> 50 for `lib/workflow/lock.ts`: the window a
 * card's write is checked and renamed in is one responsibility, and the module bar
 * keeps it out of `board/store.ts` — nor can it be deferred, because it is the path
 * every write takes rather than a surface a session may never open.
 *
 * `board` 61 -> 62 and `team` 51 -> 52 for `lib/pool.ts`: a pile read is one round trip
 * per card file, so `board/read.ts` fans the reads out on the bound `file-browse` and
 * `worktree` already share — which is the honest fix for a path every listing, every write
 * and every page frame takes, rather than a third worker loop or a deferral of a pure
 * module behind the first read. Same reason as the lock: not a surface a session may never
 * open.
 *
 * `wechat`'s row went 30 -> 31 for `state/binding.ts`: the session's binding is a
 * pure reader of the branch that the lifecycle events consult before any bridge
 * exists, so it cannot defer behind the account check it decides. It went 31 -> 32
 * for `text/remedy.ts`: every notice that reports a missing bridge names the step
 * that fixes it, and the command path asks which step that is before any bridge
 * is loaded, so the sentences cannot live behind the bridge or the screen.
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
 * out of the publishing module, so both sides compile against one name. The fourteen entries
 * that declare a string-enum parameter each pay one more for `lib/tool-schema.ts`, the type
 * Pi's typings dropped — `board` and `team` joined in #748, and built at load it cannot defer.
 * `lib/config.ts`'s JSON boundary became `lib/json.ts`. Fifteen entries that clamp a
 * number *and* load their own `bytefly.json` section now evaluate both modules —
 * bytefly, board, file-read, goal, job, memory, rewind, serve, subagent, team, todo,
 * watch, web-access, worktree and wechat — and fourteen of them raise their row, because
 * `wechat`'s 30 already held one of slack over its 29, so the total went 704 -> 718. That
 * is what the seam costs. What it buys is `session-bus`: the one entry that needs the
 * boundary and no document, which swaps `config.ts` for `json.ts` at the same count.
 * `board`'s and `team`'s rows go up one for `lib/workflow/kind.ts`: the card's kind and its two normalizers are read by the record's
 * parser and by every write that records a card, so they cannot defer behind the call that needs one, and moving them out of
 * `card.ts` is what keeps that module under the line bar. They go up one more for `lib/workflow/signs.ts`, by the same trade: the
 * sign rules moved out of `lead.ts` to bring that module under the bar, and the new module cannot defer — `config.ts` reads
 * `normalizeLead` before any surface draws, `steps.ts` reads `signMark` and `owesAnnouncement` on the write path, and
 * `rules.ts` reads `announced` to decide an operation.
 */
const ENTRY_BUDGET: Readonly<Record<string, number>> = {
	// 88 -> 89 (#864): `doctor/schema.ts` reads `RUN_DOCTOR_TOOL`, so the entry pays `lib/tool-names.ts` — the
	// constants module sibling entries already evaluate — and board pays nothing: `runtime.ts` is deferred.
	bytefly: 89,
	board: 64, // 64 <= 64 (#748)
	// The kit's block scan is the plan's one splitter as well as browse's, so the entry pays
	// one pure module where it used to carry a second scanner (58 = 57 + markdown-blocks), and
	// one more for lib/json: the temp name plan-files used to spell for itself is the owner's
	// now, so the entry pays the module rather than a second copy of its rule (59 = 58 + json).
	// feedback-write is the same trade one card later: feedback.ts was at its named height (642),
	// so the size ratchet moved the write helpers — marker placement and the owner's settlement
	// match — into their own module rather than let a named module grow (60 = 59 + feedback-write).
	// #719 measured that 60 rather than raise it again: 16 modules run at registration and 44 are
	// reached later, four of those edges from an async call and nothing else. #720 deferred all
	// four and the row fell to what the tree then measured — `repo-key` out of `plans.ts` (-4,
	// taking `git/index`, `git/runner` and `git/read` with it), `plan-files` (-2, with `json`),
	// `rails` (-1) and `review-lazy` (-1): 60 -> 52, so the `git` cluster loads when a plan is
	// first written or read instead of on every start. Two candidates price at zero and are not
	// edges to take: `tools/refusal.ts` and `tools/todo-seed.ts` are each kept by a second static
	// parent, which is why they were named and dropped rather than missed. Two stay walled, and
	// one is permanent: `feedback-write` behind synchronous `formatFeedback` (`feedback.ts:313`),
	// so that +1 cannot come back the way `json` did, and `tools/nested` behind synchronous
	// `planMerge` (`todo-seed.ts:37`). Re-derive any price with `staticGraph`
	// (`test/helpers/graph.ts`) over a reader that drops one specifier.
	plan: 53, // 53 <= 53 (#803)
	team: 54, // 54 <= 54 (#748)
	job: 46, // lib/stray-fields.ts: this dispatch is synchronous, so the guard cannot defer (see #896)
	"session-bus": 45,
	subagent: 34,
	"web-access": 41,
	// 38 -> 45 for the transcript block (#742): `worktree` was the last package tool drawing
	// through bytefly's generic fallback, so registering renderers for it is what puts the block
	// kit — `tui/tool`, `tui/chrome`, `tui/columns` and the indent and render-cache they reach —
	// in this graph, the same kit every other drawn tool already pays for. It cannot defer: Pi
	// takes `renderCall`/`renderResult` from the registration, so the functions exist at load, and
	// a hand-rolled row builder would be a second block grammar beside `lib/tui`.
	worktree: 45,
	goal: 36,
	watch: 36, // 34 -> 35 (#985) for `pattern.ts`, 35 -> 36 (#987) for `logs.ts`: both are splits the 600-line bar forced, and neither can defer — the check runs before `add` starts a watcher, and a running watcher's tail is synchronous by nature.
	todo: 32,
	wechat: 32,
	"file-read": 30,
	rewind: 29,
	memory: 27,
	question: 18,
	serve: 12,
	context: 8,
	"file-open": 3,
	// The registration path pays what Pi reads before any page exists: the tool and its
	// schema, the command, the notice assembly, and the reporter channel. The page,
	// the reader, the routes, and the session load on the first open; the row is the
	// graph this tree measured, and it may only fall.
	"code-review": 13,
	"file-browse": 2,
};

/** A repo-relative path, in the spelling the maps use. */
function repoRelative(file: string): string {
	return posixPath(relative(REPO, file));
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

	test("plan pays for nothing it only reaches from a call", () => {
		// The property, not the row: put any of #720's edges back as a static import and this
		// fails on the module itself, where reading `ENTRY_BUDGET` would still pass — a reverted
		// deferral with the row left lowered is exactly the drift a row alone cannot see. Each
		// path is named with the call that owns it now.
		const deferred: readonly (readonly [string, string])[] = [
			["lib/repo-key.ts", "`plans.ts`'s resolve, when a plan path is first needed"],
			["lib/git/index.ts", "the cluster repo-key loads with it"],
			["lib/git/runner.ts", "the cluster repo-key loads with it"],
			["lib/git/read.ts", "the cluster repo-key loads with it"],
			["extensions/plan/plan-files.ts", "the write, setSteps and saveFeedback calls"],
			["lib/json.ts", "the temp name plan-files keeps"],
			["lib/rails.ts", "the index command, which loads it with the dock"],
			["extensions/plan/review-lazy.ts", "the review screen, on exit"],
		];
		const graph = [...staticGraph(join(REPO, "extensions", "plan", "index.ts"))].map(repoRelative);
		const reached = deferred.filter(([path]) => graph.includes(path)).map(([path]) => path);
		expect(reached, "a deferral was reverted: load the module inside the call that needs it").toEqual([]);
	});

	test("the injected-context rule is loaded by the handler that needs it", () => {
		// The property, not a row: `lib/notice.ts` already sits in bytefly, job, session-bus and
		// watch, and the five extensions that only prune their own injected message must not pay
		// it at registration — a static import put back would still pass every row (#658).
		const viaHandler = ["goal", "todo", "plan", "memory", "board"];
		const notice = join(REPO, "lib", "notice.ts");
		const paying = ENTRIES.filter((entry) => viaHandler.includes(extensionOf(entry)) && staticGraph(entry).has(notice));
		expect(paying.map(extensionOf), "load the rule inside the context handler that calls it").toEqual([]);
		// The four entries that already paid it are the premise of no row moving.
		const loaders = ["bytefly", "job", "session-bus", "watch"];
		const missing = loaders.filter((name) => {
			const entry = ENTRIES.find((candidate) => extensionOf(candidate) === name);
			return entry === undefined || !staticGraph(entry).has(notice);
		});
		expect(missing, "the notice's own loaders are what make the zero-raise shape work").toEqual([]);
	});

	test("the bus's file layer reaches only the entry that owns it", () => {
		// The rows above say `board`, `team` and `job` no longer pay `lib/session-files.ts`; this
		// says why that is a property rather than a number. Every read of the bus happens inside
		// an async body, so the layer loads where a read needs it — a graph that still reaches it
		// is a static import somebody put back. `session-bus` is the exception and owns the writer:
		// its store and mail stores are synchronous factories whose methods close over `busPaths`,
		// so an async factory would be the price of its row falling.
		const carriers = ENTRIES.filter((entry) => !["session-bus"].includes(extensionOf(entry)));
		const reached = carriers.filter((entry) => staticGraph(entry).has(join(REPO, "lib", "session-files.ts")));
		expect(reached.map(extensionOf), "load the layer inside the read that spells a path").toEqual([]);
		const owner = ENTRIES.find((entry) => extensionOf(entry) === "session-bus");
		expect(owner, "the bus's own entry is the layer's owner").toBeDefined();
		expect(
			staticGraph(owner as string).has(join(REPO, "lib", "session-files.ts")),
			"session-bus keeps the layer: its factories are synchronous",
		).toBe(true);
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
