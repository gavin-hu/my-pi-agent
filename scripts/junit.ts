/**
 * What a red gate leaves behind: bun's own JUnit report, and the lines that name its failures.
 *
 * `bun test --reporter=junit --reporter-outfile=<path>` writes the report *and* prints the
 * console output it always printed, so the human report is untouched and the machine-readable
 * one is a second artifact rather than a replacement. The XML is bun's contract, which is why
 * this reads it instead of parsing the prose a run prints: a suite header, a `(fail)` line, and
 * an error block are layout, and the layout is what changes.
 *
 * The scan is bounded to what a digest needs — the run's totals and the cases carrying a
 * `<failure>` — rather than being a general XML parser: a report has no nesting to speak of,
 * and a parser that answers everything would be more code to trust for less.
 *
 * One red has no report at all: a suite that cannot be *loaded* fails before it has a case to
 * record, so bun writes no file for it (a run of only broken imports writes nothing). That is
 * the case the digest names rather than passing over in silence.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Where the gate writes the report, relative to the repository root, under the ignored state dir. */
export const REPORT_FILE = join(".pi", "cache", "test-report.xml");

/** How many failing cases a digest lists before it counts the rest. */
export const MAX_LISTED = 20;

/** The report for the tree at `root`. */
export function reportPath(root: string): string {
	return join(root, REPORT_FILE);
}

/** One case that failed, as the report records it. */
export interface FailingCase {
	file: string;
	line?: number;
	/** The `describe` chain, outermost first, when the case is in one. */
	suite?: string;
	name: string;
	/** How long the case took, in seconds, when the report says. */
	seconds?: number;
}

/** What one run's report says. */
export interface TestReport {
	tests: number;
	failures: number;
	skipped: number;
	/** Wall time the run reported, in seconds. */
	seconds?: number;
	failing: FailingCase[];
}

/** The entities a report escapes, in the order they must be undone (`&amp;` last). */
const ENTITIES: ReadonlyArray<readonly [string, string]> = [
	["&#10;", "\n"],
	["&lt;", "<"],
	["&gt;", ">"],
	["&quot;", '"'],
	["&apos;", "'"],
	["&amp;", "&"],
];

/** An attribute value, with the entities bun writes undone. */
function unescape(value: string): string {
	let text = value;
	for (const [entity, character] of ENTITIES) text = text.replaceAll(entity, character);
	return text;
}

/** One tag's attributes, as `name → value`. */
function attributes(source: string): Map<string, string> {
	const found = new Map<string, string>();
	for (const match of source.matchAll(/([\w:-]+)="([^"]*)"/g)) found.set(match[1], unescape(match[2]));
	return found;
}

/** A number attribute, or undefined when it is missing or not one. */
function numberOf(found: Map<string, string>, name: string): number | undefined {
	const raw = found.get(name);
	if (raw === undefined || raw.trim() === "") return undefined;
	const value = Number(raw);
	return Number.isFinite(value) ? value : undefined;
}

/**
 * Read one report, or `undefined` when there is no file or it is not one.
 *
 * A missing file is the ordinary case of a run whose tests never started, and a file that does
 * not begin with a `testsuites` element is not a report at all: both answer `undefined`, which
 * the digest turns into a sentence rather than an empty page.
 */
export function readReport(path: string): TestReport | undefined {
	let text: string;
	try {
		text = readFileSync(path, "utf-8");
	} catch {
		return undefined;
	}
	const run = /<testsuites\b([^>]*)>/.exec(text);
	if (run === null) return undefined;
	const totals = attributes(run[1]);
	const failing: FailingCase[] = [];
	// The opening tags are walked in document order, so a case that names no file can be read as
	// the suite's — and a case's body is taken up to its closing tag, because a lazy scan that
	// pairs them itself lets one self-closing case swallow the next one's children, which would
	// name the case before a red as a red.
	const opening = /<(testcase|testsuite)\b([^>]*)>/g;
	let suiteFile: string | undefined;
	for (let match = opening.exec(text); match !== null; match = opening.exec(text)) {
		const [whole, kind, raw] = match;
		if (kind === "testsuite") {
			suiteFile = attributes(raw).get("file") ?? suiteFile;
			continue;
		}
		// A self-closing case has no body, so it cannot be the one that failed.
		if (raw.trimEnd().endsWith("/")) continue;
		const start = match.index + whole.length;
		const close = text.indexOf("</testcase>", start);
		if (close === -1) break;
		const body = text.slice(start, close);
		opening.lastIndex = close + "</testcase>".length;
		if (!body.includes("<failure")) continue;
		const attrs = attributes(raw);
		const file = attrs.get("file") ?? suiteFile;
		const name = attrs.get("name");
		if (file === undefined || name === undefined) continue;
		const line = numberOf(attrs, "line");
		const seconds = numberOf(attrs, "time");
		const suite = attrs.get("classname");
		failing.push({
			file,
			name,
			...(line === undefined ? {} : { line }),
			...(seconds === undefined ? {} : { seconds }),
			...(suite === undefined || suite === "" ? {} : { suite }),
		});
	}
	const tests = numberOf(totals, "tests");
	if (tests === undefined) return undefined;
	return {
		tests,
		failures: numberOf(totals, "failures") ?? failing.length,
		skipped: numberOf(totals, "skipped") ?? 0,
		...(numberOf(totals, "time") === undefined ? {} : { seconds: numberOf(totals, "time") }),
		failing,
	};
}

/** A duration as a reader compares two of them: seconds to two places. */
function duration(seconds: number | undefined): string {
	return seconds === undefined ? "" : ` (${seconds.toFixed(2)}s)`;
}

/** One failing case as a line: where it is, and what it is called. */
function failureLine(failure: FailingCase): string {
	const where = failure.line === undefined ? failure.file : `${failure.file}:${failure.line}`;
	const name = failure.suite === undefined ? failure.name : `${failure.suite} > ${failure.name}`;
	return `    ${where} — ${name}${duration(failure.seconds)}`;
}

/**
 * What a red run says about its failures: the report's place, then each case, one per line.
 *
 * `path` is printed in full so the next reader — a person, or a model looking for the file
 * rather than the line — needs no guess, and the count of what the report does not hold is
 * stated rather than dropped: bun writes no report for a suite that failed to load.
 */
export function reportDigest(path: string): string {
	const report = readReport(path);
	if (report === undefined) {
		return `test report — none written: a suite that could not be loaded keeps its error above (${path})`;
	}
	const counted = `${report.failing.length} of ${report.tests} in ${report.seconds?.toFixed(2) ?? "?"}s`;
	const skipped = report.skipped === 0 ? "" : `, ${report.skipped} skipped`;
	const lines = [`test report — ${path}`, `  failures (${counted}${skipped}):`];
	lines.push(...report.failing.slice(0, MAX_LISTED).map(failureLine));
	const rest = report.failing.length - MAX_LISTED;
	if (rest > 0) lines.push(`    … ${rest} more in the report`);
	return lines.join("\n");
}
