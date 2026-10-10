import { describe, expect, test } from "bun:test";
import { nextGlobalPackages, nextProjectPackages, nextProjectTopLevelList, nextTopLevelList } from "./toggle.ts";
import { makeItem } from "../../test/helpers/fixtures/extension-picker.ts";

describe("nextTopLevelList", () => {
	test("replaces an existing pattern of either sign and appends the new one", () => {
		expect(nextTopLevelList(["extensions/a.ts", "-extensions/a.ts"], "extensions/a.ts", true)).toEqual([
			"+extensions/a.ts",
		]);
	});

	test("appends a disable pattern", () => {
		expect(nextTopLevelList(["extensions/b.ts"], "extensions/a.ts", false)).toEqual([
			"extensions/b.ts",
			"-extensions/a.ts",
		]);
	});
});

describe("nextGlobalPackages", () => {
	test("converts a string package to object form and filters the extension", () => {
		expect(nextGlobalPackages(["npm:pkg"], "npm:pkg", "b.ts", false)).toEqual([
			{ source: "npm:pkg", extensions: ["-b.ts"] },
		]);
	});

	test("leaves an unknown package list unchanged", () => {
		expect(nextGlobalPackages(["npm:other"], "npm:pkg", "b.ts", true)).toEqual(["npm:other"]);
	});
});

describe("nextProjectTopLevelList", () => {
	const projectItem = makeItem({
		path: "/proj/.pi/extensions/x.ts",
		metadata: { source: "auto", origin: "top-level", scope: "project", baseDir: "/proj/.pi/extensions" },
	});

	test("addresses a project resource by its project-relative pattern", () => {
		expect(nextProjectTopLevelList([], projectItem, true, "/proj", "/agent")).toEqual(["+x.ts"]);
	});

	test("names an inherited personal resource before overriding it", () => {
		const inherited = makeItem({
			path: "/agent/extensions/y.ts",
			metadata: { source: "auto", origin: "top-level", scope: "user", baseDir: "/agent/extensions" },
		});
		expect(nextProjectTopLevelList([], inherited, false, "/proj", "/agent")).toEqual([
			"/agent/extensions/y.ts",
			"-/agent/extensions/y.ts",
		]);
	});
});

describe("nextProjectPackages", () => {
	test("creates a delta package entry with autoload disabled", () => {
		const item = makeItem({
			path: "/agent/pkg/extensions/z.ts",
			metadata: { source: "npm:pkg", origin: "package", scope: "user", baseDir: "/agent/pkg/extensions" },
		});
		expect(nextProjectPackages([], item, false, "/proj", "/agent")).toEqual([
			{ source: "npm:pkg", autoload: false, extensions: ["-z.ts"] },
		]);
	});
});
