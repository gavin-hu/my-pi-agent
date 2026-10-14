/**
 * Release consistency guard.
 *
 * The release flow (see AGENTS.md) is mechanical: bump `package.json`, move the
 * `[Unreleased]` entries under a dated `## [X.Y.Z]` heading, tag `main`, and
 * push the tag. Nothing else checks that those three agree, so a missed bump or
 * a mistyped tag would ship silently. This test ties them together.
 *
 * The tag half needs tags in the clone; CI checks out with `fetch-depth: 0` so
 * they are present. A shallow clone without tags skips only that half.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

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
});
