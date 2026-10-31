/**
 * Name the test behind an expired `waitFor`, so a `--parallel` red is diagnosable
 * from its log.
 *
 * The helper used to throw only how long it waited, which a rotating failure
 * leaves unattached to anything: the reporter's tail is a budget with no test
 * named in it, and a re-run that passes proves nothing. The stack still knows the
 * call site, so this module reads it and names the enclosing `describe`/`test`
 * titles from the file on disk.
 *
 * The `typescript` import is inside the failure path: `waitFor` runs in nearly
 * every suite, a passing run never formats a report, and the parser is large.
 * Reading the wall clock stays in `./process.ts`; this module only formats what
 * it is handed, which is also what makes it testable without waiting.
 */

import { readFileSync } from "node:fs";
import { isAbsolute, join, relative as relativePath } from "node:path";
import type { CallExpression, Node } from "typescript";
import { posix } from "./files.ts";

/** What an expired wait knows about itself. */
export interface WaitTimeout {
	/** The budget the caller asked for, as given. */
	budgetMs: number;
	/** Real time spent polling before the deadline passed. */
	elapsedMs: number;
	/** The predicate's own source, for two waits in one test that differ by it. */
	predicate: string;
	/** `Error().stack` captured where the wait expired. */
	stack: string;
}

/** One source location a stack frame names. */
export interface Site {
	path: string;
	line: number;
	column: number;
}

/** A stack frame's `path:line:column`, as V8 and JSC both print it. */
const FRAME = /\(?([^\s()]+):(\d+):(\d+)\)?$/;

/** This module and `waitFor` itself: frames a caller never means. */
const OWN_FILES = [join("test", "helpers", "wait-site.ts"), join("test", "helpers", "process.ts")];

/** The calls that carry a suite or test title. */
const TITLE_CALLEES = new Set(["test", "it", "describe"]);

/** The repository root, which reported paths are relative to. */
const root = join(import.meta.dir, "..", "..");

/** A test file, whose titles are worth looking up; a helper's are not. */
function isTestFile(path: string): boolean {
	return path.endsWith(".test.ts");
}

/** A frame inside this helper or `waitFor`, which no report should point at. */
function isOwn(path: string): boolean {
	return OWN_FILES.some((own) => path.endsWith(own));
}

/** Every absolute frame that is not this helper's own, nearest first. */
export function stackFrames(stack: string): Site[] {
	const sites: Site[] = [];
	for (const text of stack.split("\n")) {
		const match = FRAME.exec(text.trim());
		if (match === null) continue;
		const [, path, line, column] = match;
		if (path === undefined || line === undefined || column === undefined) continue;
		if (!isAbsolute(path) || isOwn(path)) continue;
		sites.push({ path, line: Number(line), column: Number(column) });
	}
	return sites;
}

/** Where the report is built: the first test frame, or else the first caller outside this helper. */
export function callSite(stack: string): Site | undefined {
	const frames = stackFrames(stack);
	return frames.find((frame) => isTestFile(frame.path)) ?? frames[0];
}

/** The innermost `describe`/`test` titles whose span holds `line`, outermost first. */
export async function titlesAt(text: string, line: number): Promise<string[]> {
	const ts = await import("typescript");
	const file = ts.createSourceFile("wait-site.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	const offset = offsetOfLine(text, line);
	const found: Array<{ start: number; title: string }> = [];
	const visit = (node: Node): void => {
		if (ts.isCallExpression(node)) {
			const title = titleOf(node, ts);
			const start = node.getStart(file);
			if (title !== undefined && start <= offset && offset <= node.getEnd()) found.push({ start, title });
		}
		ts.forEachChild(node, visit);
	};
	visit(file);
	return found.sort((left, right) => left.start - right.start).map((entry) => entry.title);
}

/**
 * The one-line message an expired wait throws: how long it spent, against what
 * budget, where it waited, and on which predicate.
 */
export async function waitTimeoutMessage(
	timeout: WaitTimeout,
	read: (path: string) => string = (path) => readFileSync(path, "utf-8"),
): Promise<string> {
	const site = callSite(timeout.stack);
	const where = site === undefined ? "an unknown call site" : await describeSite(site, read);
	const spent = `${timeout.elapsedMs}ms of a ${timeout.budgetMs}ms budget`;
	return `waitFor timed out after ${spent} — ${where}, predicate: ${flatten(timeout.predicate)}`;
}

/** A site as `"describe > test" (path:line)`, or the bare path when no title encloses it. */
async function describeSite(site: Site, read: (path: string) => string): Promise<string> {
	const at = `${posix(relativePath(root, site.path))}:${site.line}`;
	if (!isTestFile(site.path)) return at;
	const text = readOrUndefined(read, site.path);
	if (text === undefined) return at;
	const titles = await titlesAt(text, site.line);
	if (titles.length === 0) return `${at} (no enclosing test found)`;
	return `"${titles.join(" > ")}" (${at})`;
}

/** The file's text, or nothing when it cannot be read: a report never throws on its own account. */
function readOrUndefined(read: (path: string) => string, path: string): string | undefined {
	try {
		return read(path);
	} catch {
		return undefined;
	}
}

/** The source text of one predicate, on one line and short. */
function flatten(predicate: string): string {
	const collapsed = predicate.replace(/\s+/g, " ").trim();
	return collapsed.length > 160 ? `${collapsed.slice(0, 157)}...` : collapsed;
}

/** The character offset a 1-based line starts at. */
function offsetOfLine(text: string, line: number): number {
	let offset = 0;
	for (let current = 1; current < line; current += 1) {
		const next = text.indexOf("\n", offset);
		if (next === -1) return text.length;
		offset = next + 1;
	}
	return offset;
}

/** The title a `test(...)`, `it(...)`, or `describe(...)` call states, if any. */
function titleOf(node: CallExpression, ts: typeof import("typescript")): string | undefined {
	const callee = node.expression;
	if (!ts.isIdentifier(callee) || !TITLE_CALLEES.has(callee.text)) return undefined;
	const [first] = node.arguments;
	if (first === undefined) return undefined;
	if (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first)) return first.text;
	return undefined;
}
