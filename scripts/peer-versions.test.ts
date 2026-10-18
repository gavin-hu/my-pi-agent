import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { formatSummary, formatVersions, peerVersions } from "./peer-versions.ts";

let dir = "";

afterEach(() => {
	if (dir) rmSync(dir, { recursive: true, force: true });
});

/** A throwaway tree with the given peers installed at their versions. */
function tree(peers: Record<string, string | undefined>): string {
	dir = mkdtempSync(join(tmpdir(), "pi-peer-versions-"));
	writeFileSync(
		join(dir, "package.json"),
		JSON.stringify({ peerDependencies: Object.fromEntries(Object.keys(peers).map((name) => [name, "*"])) }),
	);
	for (const [name, version] of Object.entries(peers)) {
		if (version === undefined) continue;
		const packageDir = join(dir, "node_modules", name);
		mkdirSync(packageDir, { recursive: true });
		writeFileSync(join(packageDir, "package.json"), JSON.stringify({ name, version }));
	}
	return dir;
}

describe("peerVersions", () => {
	test("reads each declared peer's installed version, in name order", () => {
		tree({ typebox: "1.3.27", "@earendil-works/pi-tui": "1.4.0" });
		expect(peerVersions(dir)).toEqual([
			{ name: "@earendil-works/pi-tui", version: "1.4.0" },
			{ name: "typebox", version: "1.3.27" },
		]);
	});

	test("names a peer that is not installed instead of skipping it", () => {
		tree({ typebox: undefined });
		expect(() => peerVersions(dir)).toThrow(/typebox is not installed/);
	});
});

describe("formatting", () => {
	const versions = [
		{ name: "@earendil-works/pi-coding-agent", version: "1.4.0" },
		{ name: "typebox", version: "1.3.27" },
	];

	test("aligns one line per peer", () => {
		expect(formatVersions(versions)).toEqual([
			"@earendil-works/pi-coding-agent  1.4.0",
			"typebox                          1.3.27",
		]);
	});

	test("summarizes the same list as a markdown table", () => {
		const summary = formatSummary(versions);
		expect(summary).toContain("| Package | Version |");
		expect(summary).toContain("| `typebox` | 1.3.27 |");
		expect(summary.endsWith("\n")).toBe(true);
	});
});
