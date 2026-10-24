/**
 * Changelog state, for the `changelog` skill.
 *
 * The skill's judgement is the model's; the counting is not. This prints what a
 * changelog can be asked mechanically — the file, the last tag, the commits since it,
 * the `[Unreleased]` categories, the empty and duplicate headings, the scope prefixes
 * in use, and the link references — so an audit starts from facts instead of a
 * hand-run `git log` whose flags and column are remembered differently each time.
 *
 * It ships inside the skill and resolves against the skill's own directory, so it
 * imports nothing from the package's `lib/`: an installed copy has `skills/` and
 * nothing else.
 *
 * Usage: `bun <skill>/scripts/state.ts [dir]`
 */

import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/** One `###` category under `[Unreleased]`, as the file spells it. */
export interface Category {
	/** The heading text, exactly as written: `Fixed`, not `Fix`. */
	name: string;
	/** 1-based line of the heading. */
	line: number;
	/** Top-level bullets between this heading and the next one. */
	bullets: number;
}

/** What the file's text alone says; `gitFacts` adds the part that needs a repository. */
export interface State {
	/** Whether the first paragraphs name Keep a Changelog and Semantic Versioning. */
	keepAChangelog: boolean;
	/** The `[Unreleased]` section, when the file keeps one. */
	unreleased?: { line: number; categories: Category[]; bullets: number };
	/** Every dated `## [X.Y.Z]` heading, newest first, which is the order released sections appear in. */
	dated: { version: string; line: number }[];
	/** A heading text used twice inside one section, with every line it occurs on. */
	duplicates: { name: string; lines: number[] }[];
	/** Scope prefixes and how often each appears, most used first. */
	scopes: { name: string; count: number }[];
	/** The link references the file defines, lowercased, and the dated sections that lack one. */
	refs: { unreleased: boolean; dated: number; missing: string[] };
}

/** What the repository adds: the tag the window starts at, and what is in the window. */
export interface GitFacts {
	/** The newest tag, when the repository has one. */
	tag?: string;
	/** Subject lines of the non-merge commits since the tag, newest first. */
	commits: string[];
	/** Why a fact is absent, in words the report can print: no repository, no tags. */
	note?: string;
}

/** Keep a Changelog's `## [Unreleased]`, and the un-bracketed spelling some files use. */
const UNRELEASED = /^\[?unreleased\]?$/i;
/** A dated section heading: `[0.17.0] - 2025-06-01`, `0.17.0`, or a project's own suffix. */
const DATED = /^\[?(\d+\.\d+\.\d+[^\s\]]*)\]?/;
const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE = /^\s*(?:```|~~~)/;
const BULLET = /^[-*+]\s+/;
/** A bullet's scope: backticked, bold, or a bare `area:` prefix. Not a path, and not prose. */
const SCOPE = /^[-*+]\s+(?:`([^`]+)`|\*\*([^*]+)\*\*|([A-Za-z][A-Za-z0-9./-]{0,24}))\s*:/;
const LINK_REF = /^\[([^\]]+)\]:\s*\S+/;

/** Report caps, so a long history stays one screen. */
export const MAX_COMMITS = 40;
export const MAX_SCOPES = 6;

interface Heading {
	level: number;
	text: string;
	line: number;
}

/** The changelog a project root holds, in the order projects name one. */
export const CHANGELOG_NAMES = [
	"CHANGELOG.md",
	"CHANGELOG",
	"CHANGES.md",
	"HISTORY.md",
	"NEWS.md",
	join("docs", "CHANGELOG.md"),
	join("docs", "changelog.md"),
];

/** The first changelog file in `dir`, as an absolute path, or undefined when it has none. */
export function findChangelog(dir: string): string | undefined {
	const root = resolve(dir);
	for (const name of CHANGELOG_NAMES) {
		const candidate = join(root, name);
		if (existsSync(candidate)) return candidate;
	}
	return undefined;
}

/** Every heading outside a fence, so a `## example` in a code block is not a section. */
function headingsOf(markdown: string): Heading[] {
	const headings: Heading[] = [];
	let fenced = false;
	markdown.split("\n").forEach((text, index) => {
		if (FENCE.test(text)) {
			fenced = !fenced;
			return;
		}
		if (fenced) return;
		const match = HEADING.exec(text);
		if (match !== null) headings.push({ level: match[1].length, text: match[2].trim(), line: index + 1 });
	});
	return headings;
}

/** The scope a bullet leads with, if it leads with one. */
function scopeOf(line: string): string | undefined {
	const match = SCOPE.exec(line);
	if (match === null) return undefined;
	return (match[1] ?? match[2] ?? match[3]).trim();
}

/** Bullet count and scopes over the given 1-based inclusive line window, outside fences. */
function scanBullets(lines: readonly string[], start: number, end: number): { bullets: number; scopes: string[] } {
	let bullets = 0;
	const scopes: string[] = [];
	let fenced = false;
	for (let line = start; line <= end && line <= lines.length; line++) {
		const text = lines[line - 1];
		if (FENCE.test(text)) {
			fenced = !fenced;
			continue;
		}
		if (fenced || !BULLET.test(text)) continue;
		bullets++;
		const scope = scopeOf(text);
		if (scope !== undefined) scopes.push(scope);
	}
	return { bullets, scopes };
}

/** Read the file's text into the facts the report prints. Pure, so a fixture can drive it. */
export function readState(markdown: string): State {
	const lines = markdown.split("\n");
	const headings = headingsOf(markdown);
	const preamble = lines.slice(0, 20).join("\n");

	const unreleasedAt = headings.findIndex((heading) => heading.level === 2 && UNRELEASED.test(heading.text));
	const dated = headings
		.filter((heading) => heading.level === 2)
		.flatMap((heading) => {
			const version = DATED.exec(heading.text)?.[1];
			return version === undefined ? [] : [{ version, line: heading.line }];
		});

	const scopes = new Map<string, number>();
	for (const scope of scanBullets(lines, 1, lines.length).scopes) {
		scopes.set(scope, (scopes.get(scope) ?? 0) + 1);
	}

	const duplicates = duplicateHeadings(headings);

	const refs = new Map<string, number>();
	for (const line of lines) {
		const name = LINK_REF.exec(line)?.[1];
		if (name !== undefined) refs.set(name.toLowerCase(), (refs.get(name.toLowerCase()) ?? 0) + 1);
	}

	let unreleased: State["unreleased"];
	if (unreleasedAt !== -1) {
		const heading = headings[unreleasedAt];
		const nextSection = headings.slice(unreleasedAt + 1).find((entry) => entry.level <= 2);
		const windowEnd = nextSection === undefined ? lines.length : nextSection.line - 1;
		const inner = headings.filter((entry) => entry.line > heading.line && entry.line <= windowEnd);
		const categories: Category[] = [];
		inner
			.filter((entry) => entry.level === 3)
			.forEach((entry, index) => {
				const next = inner.filter((item) => item.level === 3)[index + 1];
				const categoryEnd = next === undefined ? windowEnd : next.line - 1;
				categories.push({
					name: entry.text,
					line: entry.line,
					bullets: scanBullets(lines, entry.line + 1, categoryEnd).bullets,
				});
			});
		unreleased = {
			line: heading.line,
			categories,
			bullets: categories.reduce((total, category) => total + category.bullets, 0),
		};
	}

	return {
		keepAChangelog: /keep a changelog/i.test(preamble) && /semantic versioning/i.test(preamble),
		unreleased,
		dated,
		duplicates,
		scopes: [...scopes.entries()]
			.map(([name, count]) => ({ name, count }))
			.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
		refs: {
			unreleased: refs.has("unreleased"),
			dated: dated.length,
			missing: dated.filter((entry) => !refs.has(entry.version.toLowerCase())).map((entry) => entry.version),
		},
	};
}

/** A trim with an ellipsis, so one long line cannot wrap the report. */
function clip(text: string, width: number): string {
	return text.length > width ? `${text.slice(0, width - 1)}…` : text;
}

/**
 * A heading repeated inside one section, which is what a reader sees as one category
 * split in two. The same `### Fixed` under each release is the format working, not a
 * duplicate, so headings are grouped by the `##` section that contains them.
 */
function duplicateHeadings(headings: readonly Heading[]): { name: string; lines: number[] }[] {
	const groups = new Map<string, { name: string; lines: number[] }>();
	let section = "top";
	for (const heading of headings) {
		if (heading.level <= 2) section = heading.level === 2 ? heading.text.toLowerCase() : "top";
		const key = `${section}\u0000${heading.text.toLowerCase()}`;
		const group = groups.get(key) ?? { name: heading.text, lines: [] };
		group.lines.push(heading.line);
		groups.set(key, group);
	}
	return [...groups.values()].filter((group) => group.lines.length > 1);
}

/**
 * The report. Every line is a fact with its source, in the order an audit uses them:
 * the file, the window, the unreleased section, then what is wrong with the file, then
 * what the window contains.
 */
export function formatState(file: string, state: State, git: GitFacts): string {
	const out: string[] = [];
	const preamble = state.keepAChangelog ? "Keep a Changelog preamble" : "no Keep a Changelog preamble";
	out.push(`changelog   ${file} · ${preamble}`);

	const count = `${git.commits.length} commit${git.commits.length === 1 ? "" : "s"} since, merges skipped`;
	out.push(`last tag    ${git.tag === undefined ? (git.note ?? "no tags") : `${git.tag} · ${count}`}`);

	out.push(
		state.unreleased === undefined
			? "unreleased  missing: the file has no `[Unreleased]` section"
			: `unreleased  line ${state.unreleased.line} · ${state.unreleased.bullets} bullets`,
	);
	if (state.unreleased !== undefined) {
		const named = state.unreleased.categories.map((category) => `${category.name} ${category.bullets}`);
		out.push(`categories  ${named.length === 0 ? "none" : named.join(" · ")}   (file order)`);
		const empty = state.unreleased.categories.filter((category) => category.bullets === 0).map((item) => item.name);
		out.push(`empty       ${empty.length === 0 ? "none" : empty.join(" · ")}`);
	}
	out.push(
		state.duplicates.length === 0
			? "duplicate   none"
			: `duplicate   ${state.duplicates
					.slice(0, 4)
					.map((entry) => `${entry.name} at lines ${entry.lines.join(", ")}`)
					.join(" · ")}`,
	);
	const scopes = state.scopes.slice(0, MAX_SCOPES).map((entry) => `${entry.name} ${entry.count}`);
	const rest = state.scopes.length - MAX_SCOPES;
	out.push(
		`scopes      ${scopes.length === 0 ? "none" : `${scopes.join(" · ")}${rest > 0 ? ` · … ${rest} more` : ""}`}`,
	);
	out.push(
		`refs        [Unreleased] ${state.refs.unreleased ? "yes" : "no"} · dated refs ${state.refs.dated - state.refs.missing.length}/${state.refs.dated}${
			state.refs.missing.length === 0 ? "" : `, missing ${state.refs.missing.slice(0, 5).join(", ")}`
		}`,
	);

	if (git.commits.length > 0) {
		out.push(`commits since ${git.tag ?? "the beginning"}`);
		for (const commit of git.commits.slice(0, MAX_COMMITS)) out.push(`  ${clip(commit, 110)}`);
		const more = git.commits.length - MAX_COMMITS;
		if (more > 0) out.push(`  … ${more} more`);
	}
	return `${out.join("\n")}\n`;
}

/** Run one git command, returning its trimmed stdout or a reason it produced none. */
function git(args: readonly string[], cwd: string): { text?: string; error?: string } {
	const result = Bun.spawnSync({ cmd: ["git", ...args], cwd, stdout: "pipe", stderr: "pipe" });
	if (result.exitCode !== 0) return { error: result.stderr.toString().trim() || `git ${args[0]} failed` };
	return { text: result.stdout.toString().trim() };
}

/**
 * The tag to audit from, and the non-merge commits after it. A repository with no
 * tags has no window, and a directory outside git has neither; both are reported as a
 * note rather than an error, because the file half of the report is still useful.
 */
export function gitFacts(cwd: string): GitFacts {
	const inside = git(["rev-parse", "--is-inside-work-tree"], cwd);
	if (inside.text !== "true") return { commits: [], note: "not a git repository" };

	const described = git(["describe", "--tags", "--abbrev=0"], cwd);
	const tag = described.text === "" ? undefined : described.text;
	const range = tag === undefined ? ["HEAD"] : [`${tag}..HEAD`];
	const log = git(["log", "--no-merges", "--format=%h %s", ...range], cwd);
	const commits = (log.text ?? "").split("\n").filter((line) => line.trim() !== "");
	return { tag, commits, note: tag === undefined ? "no tags" : undefined };
}

if (import.meta.main) {
	const dir = resolve(process.argv[2] ?? ".");
	const changelog = findChangelog(dir);
	if (changelog === undefined) {
		console.error(`no changelog in ${dir}: looked for ${CHANGELOG_NAMES.join(", ")}`);
		process.exit(1);
	}
	const state = readState(readFileSync(changelog, "utf-8"));
	process.stdout.write(formatState(relative(dir, changelog), state, gitFacts(dir)));
}
