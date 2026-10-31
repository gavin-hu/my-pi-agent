/**
 * Wait-budget guard: the deadlines a test states.
 *
 * `waitFor` (`helpers/process.ts`) polls a predicate and throws when the budget
 * runs out. Its default is 2000 ms, and a budget only bounds a *failure* — it
 * never makes a passing case faster. A literal below a second therefore buys
 * nothing and costs a red run on a loaded machine, which is what happened twice:
 * fifteen 200 ms waits in the job log-rotation suite and one 100 ms wait on a
 * timeout kill.
 *
 * The same rule covers a suite's hooks. `bun test` gives a `beforeAll` five seconds
 * unless the test script's `--timeout` says otherwise, so a suite that boots a
 * browser — a temp store, a seeded board, a loopback socket, and Chromium — is
 * dropped whole when it is run as `bun test <path>`, and every case under it goes
 * with it: one run of `bun test extensions/board extensions/team` lost all 30 cases
 * to "a hook timed out". A browser suite therefore states its hooks' budget, so
 * what it needs does not depend on how it was invoked.
 *
 * Rules are checked on the AST rather than the text, because a call's predicate
 * nests its own parentheses and a regex over it is guesswork. A named constant is
 * allowed: it keeps the decision visible at its declaration, which is how
 * `ROTATE_BUDGET_MS` is written. A literal is the copy-paste form this catches.
 *
 * The same file owns what the throw says: a `--parallel` timeout that names no
 * test is a re-run waiting to happen, so `helpers/wait-site.ts` reports the test,
 * its site, and the time it spent, and the cases below hold that message.
 */

import { readFileSync } from "node:fs";
import { join, relative as relativePath } from "node:path";
import { describe, expect, test } from "bun:test";
import ts from "typescript";
import { posix, walkFiles } from "./helpers/files.ts";
import { waitFor } from "./helpers/process.ts";
import { type WaitTimeout, waitTimeoutMessage } from "./helpers/wait-site.ts";

const repo = join(import.meta.dir, "..");

/**
 * The shortest budget a `waitFor` call may state as a literal. `waitFor`'s own
 * default is 2000 ms (`helpers/process.ts`); a second is the floor a loaded
 * parallel run can meet.
 */
export const MIN_BUDGET_MS = 1000;

/**
 * The shortest budget a browser suite's hooks may state.
 *
 * Bun's own hook default is 5000 ms. Above the page-paint budget every browser
 * suite already carries (10 s) as well, so a slow paint is reported by the wait that
 * paints, naming its page, rather than by the hook around it.
 */
export const MIN_HOOK_BUDGET_MS = 10_000;

/** The hooks whose budget a browser suite states. */
const HOOKS = new Set(["beforeAll", "beforeEach", "afterAll", "afterEach"]);

/** A source file to check, and the path its failures are reported under. */
export interface Source {
	path: string;
	text: string;
}

/** The directories whose `*.test.ts` files the guard covers. */
const TEST_DIRS = ["extensions", "lib", "scripts", "test"];

/** The message one offending call reports. */
function offence(path: string, line: number, budget: number): string {
	return `${path}:${line}: waitFor budget ${budget} ms is under the ${MIN_BUDGET_MS} ms floor; drop the argument for the 2000 ms default, or name the budget as a constant`;
}

/** The message one offending hook reports. */
function hookOffence(path: string, line: number, budget: number | undefined): string {
	const stated = budget === undefined ? "no budget" : `${budget} ms`;
	return `${path}:${line}: a hook that boots a browser states its budget (${stated}); stay above ${MIN_HOOK_BUDGET_MS} ms — the 30_000 ms the browser suites use — because bun's hook default is 5000 ms`;
}

/**
 * The suites that boot a browser, named rather than detected.
 *
 * A scan for the launcher cannot be trusted to be complete — a suite may import
 * `openBoardBrowser` under another name, or reach Chromium through a helper of its own — so
 * this is an exact set, the way `ROOT_TEST_FILES` is: a new browser suite is added here and
 * the rule below covers it, and a path that is no longer a test, or no longer boots a
 * browser, fails as stale.
 */
const BROWSER_SUITES = [
	"extensions/board/view/behaviour.test.ts",
	"extensions/board/view/repaint.test.ts",
	"extensions/plan/web-behaviour.test.ts",
];

/** The spellings a browser suite's boot is visible as, for the pin's own staleness check. */
const BOOT_CALLS = ["chromium.launch", "openBoardBrowser"];

/** Every `beforeAll`/`afterAll` in the file that states no usable budget. */
export function hookBudgetProblems(source: Source): string[] {
	const file = ts.createSourceFile(source.path, source.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	const found: string[] = [];
	const visit = (node: ts.Node): void => {
		if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && HOOKS.has(node.expression.text)) {
			const budget = node.arguments[1];
			const { line } = file.getLineAndCharacterOfPosition(node.expression.getStart(file));
			if (budget === undefined) {
				found.push(hookOffence(source.path, line + 1, undefined));
			} else if (ts.isNumericLiteral(budget)) {
				const value = Number(budget.text);
				if (Number.isFinite(value) && value < MIN_HOOK_BUDGET_MS) {
					found.push(hookOffence(source.path, line + 1, value));
				}
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(file);
	return found;
}

/** Every `waitFor(predicate, <literal>)` below the floor, as `path:line` messages. */
export function budgetProblems(source: Source): string[] {
	const file = ts.createSourceFile(source.path, source.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	const found: string[] = [];
	const visit = (node: ts.Node): void => {
		if (
			ts.isCallExpression(node) &&
			ts.isIdentifier(node.expression) &&
			node.expression.text === "waitFor" &&
			node.arguments.length >= 2
		) {
			const budget = node.arguments[1];
			if (budget !== undefined && ts.isNumericLiteral(budget)) {
				const value = Number(budget.text);
				if (Number.isFinite(value) && value < MIN_BUDGET_MS) {
					const { line } = file.getLineAndCharacterOfPosition(budget.getStart(file));
					found.push(offence(source.path, line + 1, value));
				}
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(file);
	return found;
}

/** Every `*.test.ts` the guard reads, as repo-relative posix paths. */
function testFiles(): string[] {
	return TEST_DIRS.flatMap((dir) => walkFiles(join(repo, dir)))
		.filter((file) => file.endsWith(".test.ts"))
		.map((file) => posix(relativePath(repo, file)))
		.sort();
}

describe("wait budgets", () => {
	test("no test waits on a literal budget under a second", () => {
		const files = testFiles();
		// A walk that found nothing would make the scan below vacuous.
		expect(files.length).toBeGreaterThan(0);
		const offenders = files.flatMap((path) => budgetProblems({ path, text: readFileSync(join(repo, path), "utf-8") }));
		expect(offenders).toEqual([]);
	});

	test("names a literal below the floor, with its line", () => {
		const problems = budgetProblems({
			path: "example.test.ts",
			text: 'test("x", async () => {\n\tawait waitFor(() => ready(), 200);\n});\n',
		});
		expect(problems).toEqual([offence("example.test.ts", 2, 200)]);
	});

	test("accepts the default, a named constant, and a budget at the floor", () => {
		for (const call of [
			"waitFor(() => ready())",
			"waitFor(() => ready(), ROTATE_BUDGET_MS)",
			`waitFor(() => ready(), ${MIN_BUDGET_MS})`,
			"waitFor(() => ready(), budget + 1)",
		]) {
			expect(budgetProblems({ path: "example.test.ts", text: `await ${call};\n` }), call).toEqual([]);
		}
	});

	test("ignores a call-shaped string, a comment, and another helper", () => {
		const text = [
			'const note = "waitFor(() => ready(), 5)";',
			"// waitFor(() => ready(), 5) in a comment",
			"await settle(20);",
			"await waitUntil(() => ready(), 20);",
		].join("\n");
		expect(budgetProblems({ path: "example.test.ts", text })).toEqual([]);
	});
});

describe("hook budgets", () => {
	/** One pinned suite, read from the tree. */
	function suite(path: string): Source {
		return { path, text: readFileSync(join(repo, path), "utf-8") };
	}

	test("the pinned browser suites still boot a browser", () => {
		// The pin is the rule's scope, so it has to stay true: a path that is no longer a test,
		// or whose source no longer shows a boot, is one the rule would silently stop covering.
		const files = testFiles();
		const missing = BROWSER_SUITES.filter((path) => !files.includes(path));
		expect(missing, "a pinned browser suite that is gone or renamed").toEqual([]);
		const quiet = BROWSER_SUITES.filter((path) => !BOOT_CALLS.some((call) => suite(path).text.includes(call)));
		expect(quiet, "a pinned browser suite that no longer shows its boot").toEqual([]);
	});

	test("every browser suite's hooks state a budget", () => {
		for (const path of BROWSER_SUITES) {
			// A suite with no hook left would make this vacuous, so it must still have one.
			expect(suite(path).text, path).toContain("beforeAll(");
			expect(hookBudgetProblems(suite(path)), path).toEqual([]);
		}
	});

	test("names a hook that states no budget, with its line", () => {
		const text = ["beforeAll(async () => {", "\tawait boot();", "});"].join("\n");
		expect(hookBudgetProblems({ path: "suite.test.ts", text })).toEqual([hookOffence("suite.test.ts", 1, undefined)]);
	});

	test("names a hook whose budget is under the floor", () => {
		const text = ["beforeAll(async () => {}, 5000);", "afterAll(async () => {}, 9000);"].join("\n");
		expect(hookBudgetProblems({ path: "suite.test.ts", text })).toEqual([
			hookOffence("suite.test.ts", 1, 5000),
			hookOffence("suite.test.ts", 2, 9000),
		]);
	});

	test("accepts a budget at the floor, a named constant, and a computed one", () => {
		for (const hook of [
			`beforeAll(async () => {}, ${MIN_HOOK_BUDGET_MS})`,
			"beforeAll(async () => {}, BOOT_MS)",
			"beforeAll(async () => {}, budgetFor())",
			"afterAll(async () => {}, 30_000)",
			"afterEach(async () => {}, 30_000)",
		]) {
			expect(
				hookBudgetProblems({ path: "suite.test.ts", text: `openBoardBrowser({ seed });\n${hook};\n` }),
				hook,
			).toEqual([]);
		}
	});
});

/** A stack in the shape Bun prints, one frame per `path:line:column` given. */
function stackOf(...frames: string[]): string {
	return ["Error: waitFor timeout", ...frames.map((frame) => `    at async <anonymous> (${frame})`)].join("\n");
}

/** A test file whose titles a stack can point into. */
const PAGE_SUITE = [
	'describe("a board page", () => {',
	'\ttest("closes on its grace", async () => {',
	"\t\tawait waitFor(() => notifications.length > 0);",
	"\t});",
	"});",
].join("\n");

/** A timeout with the real budget, ready for a fabricated stack. */
function expired(stack: string): WaitTimeout {
	return { budgetMs: 2000, elapsedMs: 2004, predicate: "() => notifications.length > 0", stack };
}

/** Read the page suite for its own path, and nothing else. */
function readPageSuite(path: string): string {
	if (path !== pageTestFile) throw new Error(`unexpected read of ${path}`);
	return PAGE_SUITE;
}

const pageTestFile = join(repo, "extensions", "board", "page.test.ts");
const pageHelper = join(repo, "test", "helpers", "board-page.ts");

describe("a wait that ran out", () => {
	const cases: Array<{ what: string; timeout: WaitTimeout; read?: (path: string) => string; contains: string }> = [
		{
			what: "names the suite and test that waited, with the line it waited on",
			timeout: expired(stackOf(`${pageTestFile}:3:9`)),
			read: readPageSuite,
			contains: '"a board page > closes on its grace" (extensions/board/page.test.ts:3)',
		},
		{
			what: "keeps walking to the test when a helper issued the wait",
			timeout: expired(stackOf(`${pageHelper}:88:5`, `${pageTestFile}:3:9`)),
			read: readPageSuite,
			contains: '"a board page > closes on its grace" (extensions/board/page.test.ts:3)',
		},
		{
			what: "falls back to the site when no test frame appears",
			timeout: expired(stackOf(`${pageHelper}:88:5`)),
			contains: "test/helpers/board-page.ts:88, predicate:",
		},
		{
			what: "says so when a test file line sits outside every title",
			timeout: expired(stackOf(`${pageTestFile}:1:1`)),
			read: () => 'import { test } from "bun:test";\n',
			contains: "extensions/board/page.test.ts:1 (no enclosing test found), predicate:",
		},
		{
			what: "names no site at all when the stack carries none",
			timeout: expired("Error: waitFor timeout\n    at processTicksAndRejections (node:internal/process:1:1)"),
			contains: "— an unknown call site, predicate:",
		},
	];

	for (const { what, timeout, read, contains } of cases) {
		test(what, async () => {
			const message = await waitTimeoutMessage(timeout, read);
			expect(message).toContain(contains);
			expect(message).toContain("waitFor timed out after 2004ms of a 2000ms budget");
		});
	}

	test("names its own test, file, and budget when a real wait expires", async () => {
		const ready = () => false;
		const message = await waitFor(ready, MIN_BUDGET_MS).then(
			() => "the wait resolved",
			(error: unknown) => (error instanceof Error ? error.message : String(error)),
		);
		expect(message).toContain('"a wait that ran out > names its own test, file, and budget when a real wait expires"');
		expect(message).toMatch(/\(test\/wait-budget\.test\.ts:\d+\)/);
		expect(message).toMatch(/after \d+ms of a 1000ms budget/);
		expect(message).toContain("predicate: ");
	});

	test("keeps a multi-line predicate on one line, and short", async () => {
		const predicate = `() => ${Array.from({ length: 40 }, (_, index) => `ready(${index})`).join(" && ")}`;
		const message = await waitTimeoutMessage({ ...expired(stackOf(`${pageTestFile}:3:9`)), predicate }, readPageSuite);
		expect(message.split("\n")).toHaveLength(1);
		expect(message).toContain("predicate: () => ready(0) && ready(1)");
		expect(message).toContain("...");
		expect(message.length).toBeLessThan(predicate.length);
	});
});
