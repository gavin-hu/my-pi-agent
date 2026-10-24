/**
 * Codebase inventory, for the `refactor` skill.
 *
 * The skill's judgement is the model's; the measuring is not. The audit used to ask
 * for "file and function sizes, nesting depth, parameter counts, export counts,
 * fan-in and fan-out" in prose, which no one can do honestly by hand past three files.
 * This prints those facts for one scope, so a candidate's evidence is a number with a
 * source instead of an impression.
 *
 * It prints facts, never a verdict and never a score: a numeric score would be this
 * script inventing the threshold the skill tells the model not to invent. The
 * "outliers" list is a rule, not a ranking — a file is there because it is above the
 * 90th percentile in lines, fan-in, or churn, or among the largest with no test — and
 * every column is printed so the reader can see which rule put it there.
 *
 * What it cannot measure, it says: a language it cannot read is `skipped` by
 * extension, a specifier it cannot resolve is counted, and a shallow clone has no
 * churn history rather than a churn of zero.
 *
 * It ships inside the skill and resolves against the skill's own directory, so it
 * imports nothing from the package's `lib/`: an installed copy has `skills/` and
 * nothing else.
 *
 * Usage: `bun <skill>/scripts/inventory.ts [path ...] [--churn-days N] [--limit N]`
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";

/** Extensions this script measures. Everything else is reported as `skipped`. */
export const SOURCE_LANGUAGES = ["ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "go", "rs"] as const;

/** Directories a walk outside a repository never descends into. */
export const SKIP_DIRS = [
	".git",
	"node_modules",
	"dist",
	"build",
	"out",
	"target",
	"vendor",
	".venv",
	"venv",
	"__pycache__",
	".next",
	"coverage",
];

/** Defaults the report states, so the audit's budget is visible rather than implied. */
export const DEFAULT_CHURN_DAYS = 90;
export const DEFAULT_LIMIT = 8;

/** One source file, measured. `path` is relative to the scope root, forward slashes. */
export interface FileFacts {
	path: string;
	language: string;
	/** Physical lines. */
	lines: number;
	/** Lines that are neither blank nor a comment. */
	codeLines: number;
	exports: number;
	/** Specifiers as written, before resolution. */
	imports: string[];
	/** TODO and FIXME markers, which are drift the store reports rather than fixes. */
	markers: number;
}

/** What one file's history says: how often it changed, and how much of it. */
export interface Churn {
	commits: number;
	insertions: number;
	deletions: number;
}

/** How the scope was measured: sizes, edges, history, and tests. */
export interface Report {
	languages: { name: string; count: number }[];
	skipped: { name: string; count: number }[];
	sizes: { median: number; p90: number; max: { path: string; lines: number } };
	fanIn: { max: { path: string; count: number }; external: number; unresolved: number };
	churn: {
		available: boolean;
		window: number;
		charged: number;
		median: number;
		p90: number;
		max?: { path: string; commits: number };
	};
	tests: { sourceFiles: number; coLocated: number; largestUntested: string[] };
	/** Above the 90th percentile in one column, or among the largest with no test. */
	outliers: { path: string; lines: number; exports: number; fanIn: number; commits: number; test: string }[];
}

/** Options a caller may override; the report prints both defaults. */
export interface Options {
	churnDays?: number;
	limit?: number;
}

/** The extension without its dot, lowercased; the language key every table uses. */
export function languageOf(path: string): string {
	const name = path.split("/").pop() ?? path;
	const dot = name.lastIndexOf(".");
	return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/** Whether this script measures the language, by extension alone. */
function measured(language: string): boolean {
	return (SOURCE_LANGUAGES as readonly string[]).includes(language);
}

/** A comment line in any of the measured languages; `*` continues a block. */
const COMMENT = /^\s*(?:\/\/|\/\*|\*|#)/;
/** An exported declaration, per language family. */
const EXPORTS: Record<string, RegExp> = {
	es: /^\s*(?:export\s|(?:module\.)?exports[.\s=])/,
	py: /^(?:def|class)\s+\w/,
	go: /^(?:func\s+[A-Z]|type\s+[A-Z])/,
	rs: /^\s*pub\s+(?:fn|struct|enum|trait|mod|const|static|type)\b/,
};
const MARKER = /\b(?:TODO|FIXME|XXX)\b/;

/** The export/import family a language belongs to, which is what the scanners key on. */
function familyOf(language: string): "es" | "py" | "go" | "rs" | undefined {
	if (["ts", "tsx", "js", "jsx", "mjs", "cjs"].includes(language)) return "es";
	if (language === "py") return "py";
	if (language === "go") return "go";
	if (language === "rs") return "rs";
	return undefined;
}

/** Every import specifier on one line, for the line's family. */
function specifiersOf(line: string, family: string): string[] {
	if (family === "es") {
		return [
			...line.matchAll(/(?:from|require\(|import\()\s*["']([^"']+)["']/g),
			...line.matchAll(/^\s*import\s+["']([^"']+)["']/g),
		].map((match) => match[1]);
	}
	if (family === "py") {
		const from = /^\s*from\s+([\w.]+)\s+import\b/.exec(line);
		if (from !== null) return [from[1]];
		const plain = /^\s*import\s+([\w.,\s]+)$/.exec(line);
		return plain === null ? [] : plain[1].split(",").map((part) => part.trim().split(/\s+/)[0]);
	}
	if (family === "rs") {
		const use = /^\s*use\s+([\w:]+)/.exec(line);
		return use === null ? [] : [use[1]];
	}
	return [];
}

/** Measure one file's text. A language this script cannot read still gets a row, so the
 * report can name what it skipped instead of dropping it silently. */
export function scanFile(path: string, text: string): FileFacts {
	const language = languageOf(path);
	const family = familyOf(language);
	const lines = text.split("\n");
	const facts: FileFacts = { path, language, lines: lines.length, codeLines: 0, exports: 0, imports: [], markers: 0 };
	if (lines[lines.length - 1] === "") facts.lines--;
	if (family === undefined) return facts;

	let inGoImport = false;
	for (const line of lines) {
		const blank = line.trim() === "";
		if (!blank && !COMMENT.test(line)) facts.codeLines++;
		if (MARKER.test(line)) facts.markers++;
		if (EXPORTS[family].test(line)) facts.exports++;

		if (family === "go") {
			if (/^\s*import\s*\(/.test(line)) {
				inGoImport = true;
				continue;
			}
			if (inGoImport && /^\s*\)/.test(line)) {
				inGoImport = false;
				continue;
			}
			if (inGoImport) {
				const quoted = /"([^"]+)"/.exec(line);
				if (quoted !== null) facts.imports.push(quoted[1]);
				continue;
			}
			const single = /^\s*import\s+(?:[\w.]+\s+)?"([^"]+)"/.exec(line);
			if (single !== null) facts.imports.push(single[1]);
			continue;
		}
		facts.imports.push(...specifiersOf(line, family));
	}
	return facts;
}

/** Extensions a relative specifier may omit, per family. */
const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

/** Candidate files a specifier could mean, most specific first. */
function candidatesOf(from: string, specifier: string): string[] {
	const base = posix.join(posix.dirname(from), specifier);
	if (specifier.startsWith(".") || specifier.startsWith("/")) {
		const stripped = base.replace(/\.(?:js|jsx|mjs|cjs)$/, "");
		return [
			base,
			...EXTENSIONS.map((extension) => `${stripped}${extension}`),
			...EXTENSIONS.map((extension) => posix.join(base, `index${extension}`)),
			posix.join(base, "index.ts"),
			`${base}.py`,
			posix.join(base, "__init__.py"),
		];
	}
	return [];
}

/**
 * In-edges from relative imports that resolve to a file in the scope, plus what could
 * not be measured: `external` package specifiers and `unresolved` relative ones.
 */
export function resolveImports(
	files: readonly FileFacts[],
	knownPaths?: Iterable<string>,
): {
	fanIn: Map<string, number>;
	external: number;
	unresolved: number;
} {
	const known = new Set(knownPaths ?? files.map((file) => file.path));
	const fanIn = new Map<string, number>();
	let external = 0;
	let unresolved = 0;

	for (const file of files) {
		for (const specifier of file.imports) {
			if (!specifier.startsWith(".")) {
				external++;
				continue;
			}
			const target = candidatesOf(file.path, specifier).find((candidate) => known.has(candidate));
			if (target === undefined) {
				unresolved++;
				continue;
			}
			fanIn.set(target, (fanIn.get(target) ?? 0) + 1);
		}
	}
	return { fanIn, external, unresolved };
}

/** Test files a source file's convention implies, in the order the convention is tried. */
function testCandidatesOf(path: string): string[] {
	const directory = posix.dirname(path);
	const base = posix.basename(path).replace(/\.[^.]+$/, "");
	const up = posix.join(directory, "..");
	return [
		posix.join(directory, `${base}.test.ts`),
		posix.join(directory, `${base}.test.tsx`),
		posix.join(directory, `${base}.test.js`),
		posix.join(directory, `${base}.spec.ts`),
		posix.join(directory, `${base}.spec.js`),
		posix.join(directory, `${base}_test.go`),
		posix.join(directory, `${base}_test.rs`),
		posix.join(directory, `test_${base}.py`),
		posix.join(directory, `${base}_test.py`),
		posix.join(directory, "tests", `test_${base}.py`),
		posix.join(up, "test", `${base}.test.ts`),
		posix.join(up, "tests", `${base}_test.go`),
	];
}

/** Whether a path is itself a test, by the same conventions proximity looks for. */
export function isTestFile(path: string): boolean {
	const name = path.split("/").pop() ?? path;
	return /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(name) || /_test\.(?:go|rs|py)$/.test(name) || /^test_.*\.py$/.test(name);
}

/** The test file each source file finds by convention, or none. */
export function testProximity(files: readonly FileFacts[]): Map<string, string> {
	const known = new Set(files.map((file) => file.path));
	const found = new Map<string, string>();
	for (const file of files) {
		const test = testCandidatesOf(file.path).find((candidate) => known.has(candidate));
		if (test !== undefined) found.set(file.path, test);
	}
	return found;
}

/** A rename's destination, so history aggregates on the path a reader will open. */
function numstatPath(path: string): string {
	const arrow = path.indexOf(" => ");
	if (arrow === -1) return path;
	const prefix = path.slice(0, path.lastIndexOf("/", arrow) + 1) || "";
	const destination = path.slice(arrow + 4);
	return `${prefix}${destination.replace(/}$/, "")}`.replace(/[{}]/g, "");
}

/**
 * `git log --numstat` output into per-file churn. Any line that is not a numstat row is
 * a commit boundary, so the caller's `--format` needs no shared constant; a binary
 * change prints `-` for its counts, so it counts as a commit and no lines.
 */
export function parseNumstat(text: string): Map<string, Churn> {
	const churn = new Map<string, Churn>();
	const touched = new Set<string>();
	const close = (): void => {
		for (const path of touched) churn.get(path)!.commits++;
		touched.clear();
	};
	for (const line of text.split("\n")) {
		if (line.trim() === "") continue;
		const columns = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
		if (columns === null) {
			close();
			continue;
		}
		const path = numstatPath(columns[3]);
		const entry = churn.get(path) ?? { commits: 0, insertions: 0, deletions: 0 };
		if (columns[1] !== "-") entry.insertions += Number(columns[1]);
		if (columns[2] !== "-") entry.deletions += Number(columns[2]);
		churn.set(path, entry);
		touched.add(path);
	}
	close();
	return churn;
}

/** The value at the given percentile, nearest-rank, over a sorted copy. */
export function percentile(values: readonly number[], rank: number): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((left, right) => left - right);
	const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((rank / 100) * sorted.length) - 1));
	return sorted[index];
}

/** The top `limit` entries by count, with a stable tie-break on path. */
function head(entries: readonly { path: string; count: number }[], limit: number): { path: string; count: number }[] {
	return [...entries]
		.sort((left, right) => right.count - left.count || left.path.localeCompare(right.path))
		.slice(0, limit);
}

/** What `summarize` reads: the scope, the graph universe, the history, and the budget. */
export interface Input {
	/** In scope, measured or not — an unmeasured language is named in `skipped`. */
	files: readonly FileFacts[];
	/** Repo-wide, for the import graph, so an edge leaving the scope still resolves. */
	universe?: readonly FileFacts[];
	/** Every file the project lists, so a specifier to a non-source neighbour resolves. */
	knownPaths?: readonly string[];
	churn?: Map<string, Churn>;
	options?: Options;
	/** False when no history was read, which is not the same as a churn of zero. */
	history?: boolean;
}

/**
 * Summarize a scope: distribution, the maxima, the churn window, test proximity, and
 * the outlier rule. A test file is measured but never a candidate: its size is code
 * volume, and "it has no test" would be a tautology.
 */
export function summarize(input: Input): Report {
	const { files, universe = files, knownPaths, churn = new Map<string, Churn>(), history = true } = input;
	const options = input.options ?? {};
	const limit = options.limit ?? DEFAULT_LIMIT;
	const churnDays = options.churnDays ?? DEFAULT_CHURN_DAYS;
	const measuredFiles = files.filter((file) => measured(file.language));
	const candidates = measuredFiles.filter((file) => !isTestFile(file.path));
	// Fan-in is repo-wide, because a file's dependents do not live in the scope; the
	// external and unresolved counts are the scope's own, because they are its edges.
	const { fanIn } = resolveImports(
		universe.filter((file) => measured(file.language)),
		knownPaths,
	);
	const { external, unresolved } = resolveImports(measuredFiles, knownPaths);
	const tests = testProximity(files);
	const fanInOf = (path: string): number => fanIn.get(path) ?? 0;
	const commitsOf = (path: string): number => churn.get(path)?.commits ?? 0;

	const languages = [...new Set(measuredFiles.map((file) => file.language))]
		.map((name) => ({ name, count: measuredFiles.filter((file) => file.language === name).length }))
		.sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
	const skipped = [...new Set(files.filter((file) => !measured(file.language)).map((file) => file.language))]
		.map((name) => ({ name, count: files.filter((file) => file.language === name).length }))
		.sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));

	const lines = measuredFiles.map((file) => file.lines);
	const largest = [...measuredFiles].sort(
		(left, right) => right.lines - left.lines || left.path.localeCompare(right.path),
	)[0];
	const busiest = [...measuredFiles].sort(
		(left, right) => fanInOf(right.path) - fanInOf(left.path) || left.path.localeCompare(right.path),
	)[0];
	const charged = [...churn.entries()].filter(([path]) => measuredFiles.some((file) => file.path === path));
	const busiestChurn = [...charged].sort((left, right) => right[1].commits - left[1].commits)[0];

	const linesBar = percentile(
		candidates.map((file) => file.lines),
		90,
	);
	const fanInBar = percentile(
		candidates.map((file) => fanInOf(file.path)),
		90,
	);
	const churnBar = percentile(
		candidates.map((file) => commitsOf(file.path)),
		90,
	);
	const largestUntested = head(
		candidates.filter((file) => !tests.has(file.path)).map((file) => ({ path: file.path, count: file.lines })),
		3,
	).map((entry) => entry.path);

	const outliers = candidates
		.filter((file) => file.lines >= linesBar || fanInOf(file.path) >= fanInBar || commitsOf(file.path) >= churnBar)
		.filter(() => linesBar > 0 || fanInBar > 0 || churnBar > 0)
		.sort((left, right) => right.lines - left.lines || left.path.localeCompare(right.path))
		.slice(0, limit)
		.map((file) => ({
			path: file.path,
			lines: file.lines,
			exports: file.exports,
			fanIn: fanInOf(file.path),
			commits: commitsOf(file.path),
			test: tests.has(file.path) ? "test" : "no test",
		}));

	return {
		languages,
		skipped,
		sizes: {
			median: percentile(lines, 50),
			p90: percentile(lines, 90),
			max: largest === undefined ? { path: "none", lines: 0 } : { path: largest.path, lines: largest.lines },
		},
		fanIn: {
			max: busiest === undefined ? { path: "none", count: 0 } : { path: busiest.path, count: fanInOf(busiest.path) },
			external,
			unresolved,
		},
		churn: {
			available: history,
			window: churnDays,
			charged: charged.length,
			median: percentile(
				charged.map(([, entry]) => entry.commits),
				50,
			),
			p90: percentile(
				charged.map(([, entry]) => entry.commits),
				90,
			),
			...(busiestChurn === undefined ? {} : { max: { path: busiestChurn[0], commits: busiestChurn[1].commits } }),
		},
		tests: {
			sourceFiles: candidates.length,
			coLocated: candidates.filter((file) => tests.has(file.path)).length,
			largestUntested,
		},
		outliers,
	};
}

/** A trim with an ellipsis, so one long path cannot wrap the report. */
function clip(text: string, width: number): string {
	return text.length > width ? `${text.slice(0, width - 1)}…` : text;
}

/** The report. Every line is a fact with its scope, in the order an audit uses them. */
export function formatReport(scope: string, files: readonly FileFacts[], report: Report, note?: string): string {
	const out: string[] = [];
	const skipped = report.skipped.map((entry) => `${entry.count} ${entry.name}`).join(" · ");
	out.push(`scope       ${scope} · ${files.length} files${skipped === "" ? "" : ` · skipped ${skipped}`}`);
	if (note !== undefined) out.push(`note        ${note}`);
	out.push(
		`languages   ${report.languages.map((entry) => `${entry.name} ${entry.count}`).join(" · ") || "none measured"}`,
	);
	out.push(
		`sizes       median ${report.sizes.median} lines · p90 ${report.sizes.p90} · max ${report.sizes.max.lines} ${report.sizes.max.path}`,
	);
	out.push(
		`fan-in      max ${report.fanIn.max.count} ${report.fanIn.max.path} · external ${report.fanIn.external} · unresolved ${report.fanIn.unresolved}`,
	);
	out.push(
		report.churn.available
			? `churn ${report.churn.window}d  charged ${report.churn.charged} ${report.churn.charged === 1 ? "file" : "files"} · median ${report.churn.median} · p90 ${report.churn.p90}${
					report.churn.max === undefined ? "" : ` · max ${report.churn.max.commits} ${report.churn.max.path}`
				}`
			: `churn ${report.churn.window}d  no history: a shallow clone or a directory outside git`,
	);
	out.push(
		`tests       co-located ${report.tests.coLocated}/${report.tests.sourceFiles} source files · largest without one ${
			report.tests.largestUntested[0] ?? "none"
		}`,
	);
	out.push("outliers    above p90 in lines, fan-in, or churn");
	for (const entry of report.outliers) {
		out.push(
			`  ${clip(entry.path, 60).padEnd(60)} ${String(entry.lines).padStart(6)} lines · ${String(entry.exports).padStart(3)} exports · fan-in ${entry.fanIn} · ${entry.commits} commits · ${entry.test}`,
		);
	}
	if (report.outliers.length === 0) out.push("  none");
	return `${out.join("\n")}\n`;
}

/** Every file under `root` in a directory outside git, with the tree's own noise skipped. */
function walk(root: string): string[] {
	const found: string[] = [];
	const visit = (current: string): void => {
		for (const name of readdirSync(current)) {
			const path = join(current, name);
			const stats = statSync(path);
			if (stats.isDirectory()) {
				if (!SKIP_DIRS.includes(name)) visit(path);
				continue;
			}
			found.push(relative(root, path).split(sep).join("/"));
		}
	};
	visit(root);
	return found;
}

/** Run one git command, returning its stdout or a reason it produced none. */
function git(args: readonly string[], cwd: string): { text?: string; error?: string } {
	const result = Bun.spawnSync({ cmd: ["git", ...args], cwd, stdout: "pipe", stderr: "pipe" });
	if (result.exitCode !== 0) return { error: result.stderr.toString().trim() || `git ${args[0]} failed` };
	return { text: result.stdout.toString() };
}

/** The paths under any of `targets`: a file by name, a directory by prefix, `.` for all. */
function within(path: string, targets: readonly string[]): boolean {
	if (targets.length === 0) return true;
	return targets.some((target) => target === "." || path === target || path.startsWith(`${target}/`));
}

/** Arguments: paths, a churn window, and a cap. A flag that needs a number says so. */
export function parseArgs(argv: readonly string[]): { targets: string[]; options: Options } {
	const targets: string[] = [];
	const options: Options = {};
	for (let index = 0; index < argv.length; index++) {
		const argument = argv[index];
		const name = argument.startsWith("--churn-days")
			? "churnDays"
			: argument.startsWith("--limit")
				? "limit"
				: undefined;
		if (name === undefined) {
			targets.push(argument.replace(/\/+$/, ""));
			continue;
		}
		const inline = argument.split("=")[1];
		const raw = inline ?? argv[++index];
		const value = Number(raw);
		if (!Number.isFinite(value) || value <= 0) throw new Error(`${argument.split("=")[0]} needs a positive number`);
		options[name] = Math.floor(value);
	}
	return { targets: targets.length === 0 ? ["."] : targets, options };
}

if (import.meta.main) {
	const { targets, options } = parseArgs(process.argv.slice(2));
	const cwd = process.cwd();
	const inside = git(["rev-parse", "--is-inside-work-tree"], cwd).text?.trim() === "true";
	const shallow = inside && git(["rev-parse", "--is-shallow-repository"], cwd).text?.trim() === "true";
	const listed = inside ? git(["ls-files", "--cached", "--others", "--exclude-standard"], cwd) : undefined;
	const note = inside
		? shallow
			? "shallow clone: churn history is partial"
			: undefined
		: "no git: ignore rules not applied, and no churn history";

	const paths = (listed?.text?.split("\n") ?? walk(cwd))
		.map((path) => path.trim())
		.filter((path) => path !== "" && existsSync(join(cwd, ...path.split("/"))));
	const read = (path: string): FileFacts => scanFile(path, readFileSync(join(cwd, ...path.split("/")), "utf-8"));

	// The graph is repo-wide, so an edge that leaves the scope still resolves; the
	// report itself is scoped, so a neighbour never becomes a candidate.
	const universe = paths.filter((path) => measured(languageOf(path))).map(read);
	const files = paths.filter((path) => within(path, targets)).map(read);
	const window = options.churnDays ?? DEFAULT_CHURN_DAYS;
	const log =
		inside && !shallow
			? git(["log", `--since=${window} days ago`, "--numstat", "--format=%H", "--", ...targets], cwd)
			: undefined;
	const churn = log?.text === undefined ? new Map<string, Churn>() : parseNumstat(log.text);

	const report = summarize({ files, universe, knownPaths: paths, churn, options, history: log?.text !== undefined });
	process.stdout.write(formatReport(targets.join(" "), files, report, note));
}
