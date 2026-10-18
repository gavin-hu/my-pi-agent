import { describe, expect, test } from "bun:test";
import {
	clearProjectPackages,
	clearProjectTopLevelList,
	nextGlobalPackages,
	nextProjectPackages,
	nextProjectTopLevelList,
	nextTopLevelList,
} from "./toggle.ts";
import { makeItem } from "../../../test/helpers/fixtures/picker.ts";

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

describe("clearProjectTopLevelList", () => {
	const inherited = makeItem({
		path: "/agent/extensions/y.ts",
		metadata: { source: "auto", origin: "top-level", scope: "user", baseDir: "/agent/extensions" },
	});
	const projectItem = makeItem({
		path: "/proj/.pi/extensions/x.ts",
		metadata: { source: "auto", origin: "top-level", scope: "project", baseDir: "/proj/.pi/extensions" },
	});

	test("removes the override a toggle wrote for an inherited resource", () => {
		const written = nextProjectTopLevelList([], inherited, false, "/proj", "/agent");
		expect(clearProjectTopLevelList(written, inherited, "/proj", "/agent")).toEqual([]);
	});

	test("removes a project resource's own override", () => {
		const written = nextProjectTopLevelList([], projectItem, true, "/proj", "/agent");
		expect(clearProjectTopLevelList(written, projectItem, "/proj", "/agent")).toEqual([]);
	});

	test("keeps another extension's override", () => {
		const written = nextProjectTopLevelList([], projectItem, true, "/proj", "/agent");
		expect(clearProjectTopLevelList([...written, "+other.ts"], projectItem, "/proj", "/agent")).toEqual(["+other.ts"]);
	});

	test("returns the same array when the item has no override", () => {
		const current = ["+other.ts"];
		expect(clearProjectTopLevelList(current, projectItem, "/proj", "/agent")).toBe(current);
	});
});

describe("clearProjectPackages", () => {
	const item = makeItem({
		path: "/agent/pkg/extensions/z.ts",
		metadata: { source: "npm:pkg", origin: "package", scope: "user", baseDir: "/agent/pkg/extensions" },
	});

	test("drops the entry a toggle created and left empty", () => {
		const written = nextProjectPackages([], item, false, "/proj", "/agent");
		expect(clearProjectPackages(written, item, "/proj", "/agent")).toEqual([]);
	});

	test("keeps the entry while another filter remains", () => {
		const written = nextProjectPackages(
			[{ source: "npm:pkg", autoload: false, extensions: ["-w.ts"] }],
			item,
			false,
			"/proj",
			"/agent",
		);
		expect(clearProjectPackages(written, item, "/proj", "/agent")).toEqual([
			{ source: "npm:pkg", autoload: false, extensions: ["-w.ts"] },
		]);
	});

	test("collapses a pre-existing entry back to its plain source", () => {
		expect(clearProjectPackages([{ source: "npm:pkg", extensions: ["-z.ts"] }], item, "/proj", "/agent")).toEqual([
			"npm:pkg",
		]);
	});

	test("returns the same array when the package carries no filter for the item", () => {
		const plain = ["npm:pkg"];
		expect(clearProjectPackages(plain, item, "/proj", "/agent")).toBe(plain);

		const other = [{ source: "npm:pkg", extensions: ["-other.ts"] }];
		expect(clearProjectPackages(other, item, "/proj", "/agent")).toBe(other);
	});
});
