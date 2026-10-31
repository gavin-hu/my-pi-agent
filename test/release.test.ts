/**
 * Release consistency guard.
 *
 * The release flow (see `docs/development.md#release`) is mechanical: bump
 * `package.json`, move the `[Unreleased]` entries under a dated `## [X.Y.Z]`
 * heading, tag `main`, and push the tag with `main`. Nothing else checks that
 * those three agree, so a missed bump or a mistyped tag would ship silently.
 * This test ties them together.
 *
 * The same flow bumps the install pin the user guide offers as the
 * copy-paste way to hold a release, so that page is checked against the package
 * version too: a pin is only useful while it names a version that exists.
 *
 * The changelog's own shape is part of the same contract: one
 * `Added`/`Changed`/`Fixed` set per release window, in Keep a Changelog's names
 * and order, each with at least one bullet. A second `### Added` in one window
 * used to land from two sessions merging into `[Unreleased]` in the same release
 * cycle, which reads as two releases sharing a heading.
 *
 * The bullets are held to one per mechanism in the window a release is cut from:
 * two landings of one change is the normal shape of a fast session, the earlier
 * bullet is the one left describing behaviour that no longer exists, and a
 * sentence carried from the first landing into the second is what that reads as.
 *
 * The tarball itself is checked too: the pi.dev gallery renders a README
 * Markdown image through the npm CDN, so an image `files` does not publish is a
 * 404 on the listing page, and `pi.image` is the one preview the service reads
 * from the manifest, so it has to be the absolute raw URL it requires.
 *
 * The tag half needs tags in the clone; CI checks out with `fetch-depth: 0` so
 * they are present. A shallow clone without tags skips only that half.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "bun:test";
import { posix, walkFiles } from "./helpers/files.ts";

const repo = join(import.meta.dir, "..");

interface Version {
	major: number;
	minor: number;
	patch: number;
}

/** Parse `X.Y.Z`, with or without a leading `v`, or undefined for anything else. */
function parseVersion(text: string): Version | undefined {
	const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(text.trim());
	if (!match) return undefined;
	return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function compare(a: Version, b: Version): number {
	return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/** The greatest version, or undefined when the list is empty. */
function newest(versions: Version[]): Version | undefined {
	return versions.reduce<Version | undefined>(
		(best, version) => (best === undefined || compare(version, best) > 0 ? version : best),
		undefined,
	);
}

function format(version: Version): string {
	return `${version.major}.${version.minor}.${version.patch}`;
}

/** Released versions named by dated `## [X.Y.Z] - YYYY-MM-DD` headings. */
function changelogVersions(text: string): Version[] {
	const versions: Version[] = [];
	for (const line of text.split("\n")) {
		const match = /^## \[(\d+\.\d+\.\d+)\] - \d{4}-\d{2}-\d{2}\s*$/.exec(line);
		if (!match) continue;
		const version = parseVersion(match[1]);
		if (version) versions.push(version);
	}
	return versions;
}

/**
 * Versions named by `vX.Y.Z` tags, or undefined when git cannot list them (no
 * repository, or a shallow clone that fetched no tags).
 */
function tagVersions(): Version[] | undefined {
	let output: string;
	try {
		output = execFileSync("git", ["tag", "--list"], { cwd: repo, encoding: "utf-8" });
	} catch {
		return undefined;
	}
	const versions: Version[] = [];
	for (const line of output.split("\n")) {
		const version = parseVersion(line);
		if (version) versions.push(version);
	}
	return versions;
}

const packageJson = JSON.parse(readFileSync(join(repo, "package.json"), "utf-8")) as { version?: unknown };
const packageVersion = String(packageJson.version);
const newestChangelog = newest(changelogVersions(readFileSync(join(repo, "CHANGELOG.md"), "utf-8")));
const newestTag = newest(tagVersions() ?? []);

/** A `git:github.com/gavin-hu/my-pi-agent@vX.Y.Z` install pin. */
const PIN = /github\.com\/gavin-hu\/my-pi-agent@(v\d+\.\d+\.\d+)/g;

/**
 * The docs that offer a copy-paste pin: the two entry READMEs and every page
 * under `docs/`. `CHANGELOG.md` is history, not an instruction, so it stays out.
 */
function pinnedDocs(): string[] {
	return [join(repo, "README.md"), join(repo, "README.zh-CN.md")].concat(
		walkFiles(join(repo, "docs")).filter((file) => file.endsWith(".md")),
	);
}

/** Every pin the docs offer, as `path: vX.Y.Z`. */
function docPins(): string[] {
	const pins: string[] = [];
	for (const file of pinnedDocs()) {
		const text = readFileSync(file, "utf-8");
		for (const match of text.matchAll(PIN)) pins.push(`${posix(relative(repo, file))}: ${match[1]}`);
	}
	return pins.sort();
}

describe("release consistency", () => {
	test("package.json declares a semver version", () => {
		expect(parseVersion(packageVersion), `package.json version "${packageVersion}" is not X.Y.Z`).toBeDefined();
	});

	test("the newest changelog heading is the package version", () => {
		expect(newestChangelog, "CHANGELOG.md has no dated ## [X.Y.Z] heading").toBeDefined();
		if (newestChangelog === undefined) return;
		expect(format(newestChangelog)).toBe(packageVersion);
	});

	test("the newest git tag is the package version", () => {
		if (newestTag === undefined) {
			// A shallow clone without tags cannot check this; CI fetches them.
			return;
		}
		expect(format(newestTag)).toBe(packageVersion);
	});

	test("every install pin names the package version", () => {
		const stale = docPins().filter((pin) => pin.split(": ")[1] !== `v${packageVersion}`);
		expect(stale, `bump these to v${packageVersion} with the package version`).toEqual([]);
	});

	test("offers at least one pin to check", () => {
		// A regex that stopped matching would make the test above vacuously pass.
		expect(docPins().length).toBeGreaterThan(0);
	});
});

const manifest = JSON.parse(readFileSync(join(repo, "package.json"), "utf-8")) as {
	files?: string[];
	pi?: { image?: string };
};

/** What `files` publishes, without the negations that narrow it. */
const published = (manifest.files ?? []).filter((entry) => !entry.startsWith("!"));

/** The two entry READMEs, which the gallery renders at the published version. */
const ENTRY_READMES = ["README.md", "README.zh-CN.md"];

/**
 * Every relative Markdown image target in the entry READMEs, as `file: target`.
 *
 * These are the images the gallery keeps: it rewrites a `![…](path)` to the npm
 * CDN and drops a raw `<img>` tag, so a preview written as HTML is GitHub's
 * alone and one written as Markdown has to exist in the tarball.
 */
function rewrittenImages(): string[] {
	const images: string[] = [];
	for (const name of ENTRY_READMES) {
		for (const match of readFileSync(join(repo, name), "utf-8").matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) {
			if (/^(?:https?:|\/\/)/i.test(match[1])) continue;
			images.push(`${name}: ${match[1]}`);
		}
	}
	return images;
}

describe("the published tarball", () => {
	test("publishes every README image the gallery rewrites to the npm CDN", () => {
		const unpublished = rewrittenImages().filter((image) => {
			const target = image.slice(image.indexOf(": ") + 2);
			return !published.some((entry) => new Bun.Glob(entry).match(target));
		});
		expect(unpublished, "add it to package.json files, or the gallery renders a 404").toEqual([]);
	});

	test("points pi.image at an absolute raw screenshot that exists", () => {
		const image = manifest.pi?.image ?? "";
		const prefix = "https://raw.githubusercontent.com/gavin-hu/my-pi-agent/main/";
		expect(image.startsWith(prefix), "the preview service requires an absolute raw.githubusercontent.com URL").toBe(
			true,
		);
		expect(existsSync(join(repo, image.slice(prefix.length)))).toBe(true);
	});

	test("has an image to publish", () => {
		// A regex that stopped matching would make the case above vacuously pass.
		expect(rewrittenImages().length).toBeGreaterThan(0);
	});
});

/**
 * The publish path, asserted as data.
 *
 * Publishing runs in `.github/workflows/publish.yml`, not on a maintainer's
 * machine, so the invariants that make that safe — a dispatch, a confirmation, a
 * protected environment, an OIDC token, checks on the tagged tree, and
 * `--provenance` — are read out of the workflow here. A YAML edit that quietly
 * drops one of them fails the suite instead of shipping an unsigned tarball.
 */

interface WorkflowStep {
	uses?: string;
	name?: string;
	run?: string;
	with?: Record<string, unknown>;
	env?: Record<string, string>;
}

interface WorkflowJob {
	environment?: string;
	permissions?: Record<string, string>;
	steps?: WorkflowStep[];
}

interface Workflow {
	on?: Record<string, unknown>;
	permissions?: Record<string, string>;
	jobs?: Record<string, WorkflowJob>;
}

function publishWorkflow(): { text: string; workflow: Workflow } {
	const text = readFileSync(join(repo, ".github", "workflows", "publish.yml"), "utf-8");
	return { text, workflow: Bun.YAML.parse(text) as Workflow };
}

describe("the publish workflow", () => {
	const { text, workflow } = publishWorkflow();
	const job = workflow.jobs?.publish ?? {};
	const steps = job.steps ?? [];
	/** The steps that run a shell command, in order. */
	const commands = steps.map((step) => step.run ?? "").filter((run) => run !== "");

	test("publishes only from an explicit dispatch, never from a push", () => {
		// A tag push would publish without asking anyone, so the dispatch is the
		// only trigger there is.
		expect(Object.keys(workflow.on ?? {})).toEqual(["workflow_dispatch"]);
	});

	test("requires a version and a confirmation that repeats it", () => {
		const inputs = (workflow.on?.workflow_dispatch as { inputs?: Record<string, { required?: boolean }> }).inputs ?? {};
		expect(Object.keys(inputs).sort()).toEqual(["confirm", "version"]);
		expect(inputs.version?.required).toBe(true);
		expect(inputs.confirm?.required).toBe(true);
		const confirm = commands.find((run) => run.includes("$CONFIRM")) ?? "";
		expect(confirm).toContain('"$VERSION" != "$CONFIRM"');
	});

	test("runs in the protected environment whose review is the approval", () => {
		expect(job.environment).toBe("npm");
		// The trusted publisher names the same environment, so the approval a human
		// gives here is the one npm authorised.
		expect(text).toContain("Trusted publishing");
	});

	test("asks for the OIDC token and nothing else writable", () => {
		expect(job.permissions).toEqual({ contents: "read", "id-token": "write" });
		const writable: string[] = [];
		for (const [name, value] of Object.entries(job.permissions ?? {})) if (value === "write") writable.push(name);
		expect(writable).toEqual(["id-token"]);
		expect(workflow.permissions?.contents).toBe("read");
	});

	test("checks out the tag with its history and tags", () => {
		const checkout = steps.find((step) => step.uses?.startsWith("actions/checkout"));
		expect(checkout?.with?.ref).toBe("v${{ inputs.version }}");
		expect(checkout?.with?.["fetch-depth"]).toBe(0);
		expect(checkout?.with?.["fetch-tags"]).toBe(true);
	});

	test("proves the tag is on main and the tree is that version", () => {
		expect(commands.some((run) => run.includes("merge-base --is-ancestor"))).toBe(true);
		expect(commands.some((run) => run.includes("require('./package.json').version"))).toBe(true);
	});

	test("runs the checks before it publishes", () => {
		const check = commands.findIndex((run) => run.includes("bun run check"));
		const publish = commands.findIndex((run) => run.includes("npm publish"));
		expect(check).toBeGreaterThanOrEqual(0);
		expect(publish).toBeGreaterThan(check);
	});

	test("publishes with provenance and no stored token", () => {
		const publish = commands.find((run) => run.includes("npm publish")) ?? "";
		expect(publish).toContain("--provenance");
		expect(publish).toContain("https://registry.npmjs.org/");
		// Trusted publishing: an OIDC token instead of a long-lived credential.
		expect(text).not.toContain("NODE_AUTH_TOKEN");
		expect(text).not.toContain("NPM_TOKEN");
		expect(text).not.toContain("secrets.");
	});

	test("leaves the registry credential to the OIDC exchange", () => {
		// `registry-url` makes `setup-node` write an `.npmrc` holding a placeholder
		// `_authToken`. npm sends that token instead of exchanging the OIDC one and
		// npmjs answers E404 — a scan of this file cannot see it, because the file is
		// written at run time, so the input itself is the thing to forbid.
		expect(text).not.toContain("registry-url:");
		const setupNode = steps.find((step) => step.uses?.startsWith("actions/setup-node"));
		expect(setupNode).toBeDefined();
		expect(setupNode?.with).not.toHaveProperty("registry-url");
		expect(setupNode?.with).not.toHaveProperty("token");
	});

	test("refuses to publish a tarball without provenance from anywhere else", () => {
		// `publishConfig.provenance` makes a local `npm publish` fail, so the workflow
		// above is the only path that works rather than only the documented one.
		const publishConfig = (
			JSON.parse(readFileSync(join(repo, "package.json"), "utf-8")) as {
				publishConfig?: { provenance?: boolean };
			}
		).publishConfig;
		expect(publishConfig?.provenance).toBe(true);
	});
});

describe("the release guide", () => {
	const guide = readFileSync(join(repo, "docs", "development.md"), "utf-8");
	const agents = readFileSync(join(repo, "AGENTS.md"), "utf-8");

	test("names the workflow and provenance", () => {
		expect(guide).toContain("publish.yml");
		expect(guide).toContain("--provenance");
	});

	test("no longer offers a local npm publish", () => {
		// The old step was `npm publish --registry ...` on the maintainer's machine.
		expect(guide).not.toMatch(/^\s*npm publish /m);
	});

	test("says the agent publishes through the workflow", () => {
		expect(agents).toContain("publish.yml");
	});
});

interface ChangelogBullet {
	/** 1-based line of the `- ` that opens it, for the failure message. */
	line: number;
	/** The bullet's prose, with its wrapped lines joined. */
	text: string;
}

/**
 * One `## [version]` window and the `###` subsections under it.
 *
 * A window runs to the next `## [` heading, so `[Unreleased]` is a window like
 * any release: it is the one every change is written into first.
 */
interface ChangelogWindow {
	/** The bracket text: a version, or `Unreleased`. */
	version: string;
	/** 1-based line of the `##` heading, for the failure message. */
	line: number;
	subsections: Array<{ name: string; line: number; bullets: ChangelogBullet[] }>;
}

/** Keep a Changelog's subsection names, in the order they are written. */
const CHANGELOG_SECTIONS = ["Added", "Changed", "Deprecated", "Removed", "Fixed", "Security"] as const;

/** Split the changelog into release windows with their subsections. */
function changelogWindows(markdown: string): ChangelogWindow[] {
	const windows: ChangelogWindow[] = [];
	let current: ChangelogWindow | undefined;
	let bullet: ChangelogBullet | undefined;
	for (const [index, line] of markdown.split("\n").entries()) {
		const lineNumber = index + 1;
		const heading = /^## \[([^\]]+)\]/.exec(line);
		if (heading) {
			current = { version: heading[1] as string, line: lineNumber, subsections: [] };
			windows.push(current);
			bullet = undefined;
			continue;
		}
		const subsection = /^### (.+?)\s*$/.exec(line);
		if (subsection && current) {
			current.subsections.push({ name: subsection[1] as string, line: lineNumber, bullets: [] });
			bullet = undefined;
			continue;
		}
		const section = current?.subsections[current.subsections.length - 1];
		if (section === undefined) continue;
		if (line.startsWith("- ")) {
			const opened: ChangelogBullet = { line: lineNumber, text: line.slice(2) };
			section.bullets.push(opened);
			bullet = opened;
		} else if (bullet !== undefined && /^\s{2,}\S/.test(line)) {
			bullet.text += ` ${line.trim()}`;
		} else {
			bullet = undefined;
		}
	}
	return windows;
}

/**
 * Consecutive words two `[Unreleased]` bullets must share before they read as one
 * mechanism told twice. Eight is where this file's own history stops colliding: at
 * six and seven, closers like "no tool parameter or config key changed" fire between
 * bullets that never met.
 */
const MECHANISM_RUN = 8;

/** A bullet's words, in order: markdown markers and punctuation are not words. */
function wordsOf(text: string): string[] {
	return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** The extension or module a bullet opens on — `` `board`: … `` — if it names one. */
function scopeOf(text: string): string | undefined {
	return /^`([\w/.@+-]+)`/.exec(text.trim())?.[1];
}

/**
 * Bullets that tell one mechanism's story twice, as `lines A and B both say "…"`.
 *
 * Prose cannot be judged, but a sentence carried from one landing into the next can, and
 * that is the shape a second landing takes. Runs are indexed as the window is read, so the
 * earlier bullet owns one and a later bullet of the same scope that repeats it is the
 * duplicate. A bullet that names no scope is never compared: this reads a carried sentence,
 * not whether two descriptions mean the same thing.
 */
function repeatedMechanisms(bullets: readonly ChangelogBullet[]): string[] {
	const owner = new Map<string, ChangelogBullet>();
	const problems: string[] = [];
	for (const bullet of bullets) {
		const scope = scopeOf(bullet.text);
		if (scope === undefined) continue;
		const words = wordsOf(bullet.text);
		let twin: { first: ChangelogBullet; run: string } | undefined;
		for (let at = 0; at + MECHANISM_RUN <= words.length; at += 1) {
			const run = words.slice(at, at + MECHANISM_RUN).join(" ");
			const first = owner.get(run);
			if (first === undefined) owner.set(run, bullet);
			else if (twin === undefined && scopeOf(first.text) === scope) twin = { first, run };
		}
		if (twin !== undefined) problems.push(`lines ${twin.first.line} and ${bullet.line} both say "${twin.run}"`);
	}
	return problems;
}

describe("changelog shape", () => {
	const windows = changelogWindows(readFileSync(join(repo, "CHANGELOG.md"), "utf-8"));

	test("finds every window", () => {
		// A parser that stopped matching would make the checks below vacuous.
		expect(windows.length).toBeGreaterThan(10);
		expect(windows[0]?.version).toBe("Unreleased");
	});

	test("holds one subsection set per release window", () => {
		const duplicates: string[] = [];
		for (const window of windows) {
			const seen = new Map<string, number>();
			for (const section of window.subsections) {
				const first = seen.get(section.name);
				if (first === undefined) seen.set(section.name, section.line);
				else duplicates.push(`${window.version}: ### ${section.name} at lines ${first} and ${section.line}`);
			}
		}
		expect(duplicates, "merge the second block into the first of its name").toEqual([]);
	});

	test("uses Keep a Changelog's subsection names, in its order", () => {
		const problems: string[] = [];
		for (const window of windows) {
			let lastRank = -1;
			for (const section of window.subsections) {
				const rank = CHANGELOG_SECTIONS.indexOf(section.name as (typeof CHANGELOG_SECTIONS)[number]);
				if (rank === -1) {
					problems.push(`${window.version}: ### ${section.name} is not a Keep a Changelog section`);
					continue;
				}
				if (rank < lastRank) problems.push(`${window.version}: ### ${section.name} is out of order`);
				lastRank = rank;
			}
		}
		expect(problems).toEqual([]);
	});

	test("gives every subsection at least one bullet", () => {
		const empty: string[] = [];
		for (const window of windows) {
			for (const section of window.subsections) {
				if (section.bullets.length === 0) empty.push(`${window.version}: ### ${section.name} (line ${section.line})`);
			}
		}
		expect(empty).toEqual([]);
	});

	test("holds one bullet per mechanism in the window a release is cut from", () => {
		// A released window is frozen history; `[Unreleased]` is what a release is cut from, so
		// the bullets in it are the ones that can still be folded before a reader sees them.
		// A release commit moves them under their dated heading and leaves this window empty,
		// which is the commit `publish.yml` checks out: nothing to fold is not a failure, and
		// a non-empty result there would have refused every publish.
		const bullets = windows[0]?.subsections.flatMap((section) => section.bullets) ?? [];
		expect(
			repeatedMechanisms(bullets),
			"one mechanism, one bullet: fold the pair, or reword one so no sentence is shared",
		).toEqual([]);
	});
});

/** A bullet as the shape parser would hand it back, for the cases below. */
function fixtureBullet(line: number, text: string): ChangelogBullet {
	return { line, text };
}

describe("the mechanism check", () => {
	test("fails two bullets of one scope that carry one sentence", () => {
		// The bold marker, the em dash, and the punctuation belong to the prose, not the words:
		// a carried sentence still matches once they are dropped.
		const problems = repeatedMechanisms([
			fixtureBullet(3, "`board`: **the owners a bus has no record of is one line** — in the round."),
			fixtureBullet(9, "`board`: the owners a bus has no record of is one line, on the Team tab."),
		]);
		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain("lines 3 and 9");
	});

	test("passes a sentence one word short of the run", () => {
		const problems = repeatedMechanisms([
			fixtureBullet(3, "`board`: the round folds owners a bus down."),
			fixtureBullet(9, "`board`: the round folds owners a bus apart."),
		]);
		expect(problems).toEqual([]);
	});

	test("passes one sentence shared between two scopes", () => {
		const problems = repeatedMechanisms([
			fixtureBullet(3, "`board`: the owners a bus has no record of is one line."),
			fixtureBullet(9, "`team`: the owners a bus has no record of is one line."),
		]);
		expect(problems).toEqual([]);
	});

	test("passes a bullet that names no scope, because it is not compared", () => {
		const problems = repeatedMechanisms([
			fixtureBullet(3, "the owners a bus has no record of is one line, in the round."),
			fixtureBullet(9, "the owners a bus has no record of is one line, on the tab."),
		]);
		expect(problems).toEqual([]);
	});
});
