import { describe, expect, test } from "bun:test";
import {
	buildEntries,
	firstSelectable,
	formatListing,
	getDisplayName,
	getGroupLabel,
	getPackageResourcePattern,
	getPatternEntryTarget,
	getResourcePattern,
	nextSelectable,
} from "./resources.ts";
import { makeItem } from "../../test/helpers/fixtures/extension-picker.ts";
import type { ResourceItem } from "./types.ts";

const packageItem = (path: string): ResourceItem =>
	makeItem({
		path,
		metadata: { source: "npm:pkg", origin: "package", scope: "user", baseDir: "/pkg/extensions" },
	});

describe("buildEntries", () => {
	test("groups package resources before top-level and labels the source", () => {
		const entries = buildEntries(
			[makeItem({ path: "/agent/extensions/a.ts" }), packageItem("/pkg/extensions/b.ts")],
			"/agent",
		);
		const groups = entries.filter((entry) => entry.kind === "group");
		expect(groups.map((entry) => (entry.kind === "group" ? entry.label : ""))).toEqual([
			"npm:pkg (user)",
			getGroupLabel(makeItem().metadata, "/agent"),
		]);
	});

	test("renders an extension in a subfolder as folder/file.ts", () => {
		const item = makeItem({ path: "/agent/extensions/foo/index.ts" });
		expect(getDisplayName(item)).toBe("foo/index.ts");
	});

	test("keeps a flat extension as its file name", () => {
		expect(getDisplayName(makeItem({ path: "/agent/extensions/a.ts" }))).toBe("a.ts");
	});

	test("sorts items within a group by display name", () => {
		const entries = buildEntries(
			[makeItem({ path: "/agent/extensions/z.ts" }), makeItem({ path: "/agent/extensions/a.ts" })],
			"/agent",
		);
		const items = entries.filter((entry) => entry.kind === "item");
		expect(items.map((entry) => (entry.kind === "item" ? entry.label : ""))).toEqual(["a.ts", "z.ts"]);
	});

	test("navigation skips group headers", () => {
		const entries = buildEntries(
			[packageItem("/pkg/extensions/b.ts"), makeItem({ path: "/agent/extensions/a.ts" })],
			"/agent",
		);
		const first = firstSelectable(entries);
		const second = first === undefined ? undefined : nextSelectable(entries, first, 1);
		expect(entries[first ?? -1].kind).toBe("item");
		expect(entries[second ?? -1].kind).toBe("item");
		expect(nextSelectable(entries, second ?? 0, 1)).toBeUndefined();
	});
});

describe("pattern helpers", () => {
	test("strips the modifier from a settings entry", () => {
		expect(getPatternEntryTarget("+extensions/a.ts")).toBe("extensions/a.ts");
		expect(getPatternEntryTarget("-extensions/a.ts")).toBe("extensions/a.ts");
		expect(getPatternEntryTarget("!extensions/*.ts")).toBe("extensions/*.ts");
		expect(getPatternEntryTarget("extensions/a.ts")).toBe("extensions/a.ts");
	});

	test("names a top-level resource relative to its settings base", () => {
		const item = makeItem({ path: "/agent/extensions/a.ts" });
		expect(getResourcePattern(item, "/proj", "/agent")).toBe("extensions/a.ts");
	});

	test("names a package resource relative to the package base", () => {
		expect(getPackageResourcePattern(packageItem("/pkg/extensions/b.ts"))).toBe("b.ts");
	});
});

describe("formatListing", () => {
	test("marks enabled and disabled extensions", () => {
		const text = formatListing(
			[makeItem({ path: "/agent/extensions/one.ts" }), makeItem({ path: "/agent/extensions/two.ts", enabled: false })],
			"/agent",
		);
		expect(text).toContain("[x] one.ts");
		expect(text).toContain("[ ] two.ts");
	});

	test("reports an empty result", () => {
		expect(formatListing([], "/agent")).toBe("No extensions found.");
	});
});
