/**
 * Wait-budget guard: no test waits on `waitFor` for less than a second.
 *
 * `waitFor` (`helpers/process.ts`) polls a predicate and throws when the budget
 * runs out. Its default is 2000 ms, and a budget only bounds a *failure* — it
 * never makes a passing case faster. A literal below a second therefore buys
 * nothing and costs a red run on a loaded machine, which is what happened twice:
 * fifteen 200 ms waits in the job log-rotation suite and one 100 ms wait on a
 * timeout kill.
 *
 * The rule is checked on the AST rather than the text, because a call's predicate
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
