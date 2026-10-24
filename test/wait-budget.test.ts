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
 */

import { readFileSync } from "node:fs";
import { join, relative as relativePath } from "node:path";
import { describe, expect, test } from "bun:test";
import ts from "typescript";
import { posix, walkFiles } from "./helpers/files.ts";

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
