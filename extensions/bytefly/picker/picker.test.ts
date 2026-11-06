import { describe, expect, test } from "bun:test";
import type { SettingsManager } from "@earendil-works/pi-coding-agent";
import { createResolver, discoverResources, type DiscoveryFactory, type ResolverManager } from "./discovery.ts";
import {
	buildEntries,
	firstSelectable,
	getDisplayName,
	getGroupLabel,
	getPackageResourcePattern,
	getPatternEntryTarget,
	getResourcePattern,
	isSelf,
	nextSelectable,
} from "./resources.ts";
import {
	clearProjectPackages,
	clearProjectTopLevelList,
	nextGlobalPackages,
	nextProjectPackages,
	nextProjectTopLevelList,
	nextTopLevelList,
} from "./toggle.ts";
import type { ResourceItem } from "./types.ts";
import {
	makeItem,
	makeStore,
	packageExtension,
	packageSkill,
	skillItem,
} from "../../../test/helpers/fixtures/picker.ts";

const item = (path: string) => makeItem({ path });
const packageItem = (path: string) =>
	makeItem({
		path,
		metadata: { source: "npm:pkg", origin: "package", scope: "user", baseDir: "/pkg/extensions" },
	});
/** One view's resolved resources, as the factory seam returns them. */
const resolved = (extensions: ResourceItem[] = [], skills: ResourceItem[] = []) => ({ extensions, skills });

describe("discoverResources", () => {
	test("resolves the global view then the project view when trusted", async () => {
		const calls: string[] = [];
		const factory: DiscoveryFactory = {
			global: () => ({
				store: makeStore().store,
				resolve: async () => {
					calls.push("global");
					return resolved([item("/global.ts")], [skillItem("global-skill")]);
				},
			}),
			project: () => ({
				store: makeStore().store,
				resolve: async () => {
					calls.push("project");
					return resolved([item("/project.ts")], [skillItem("project-skill")]);
				},
			}),
		};

		const discovery = await discoverResources({ cwd: "/proj", agentDir: "/agent", trusted: true, factory });

		expect(calls).toEqual(["global", "project"]);
		expect(discovery.extensions.global[0].path).toBe("/global.ts");
		expect(discovery.extensions.effective[0].path).toBe("/project.ts");
		expect(discovery.skills.global[0].path).toBe("/agent/skills/global-skill/SKILL.md");
		expect(discovery.skills.effective[0].path).toBe("/agent/skills/project-skill/SKILL.md");
		expect(discovery.stores.project).not.toBe(discovery.stores.global);
	});

	test("reuses the global view and store when the project is untrusted", async () => {
		const store = makeStore().store;
		const factory: DiscoveryFactory = {
			global: () => ({ store, resolve: async () => resolved([item("/global.ts")], [skillItem("pdf")]) }),
			project: () => {
				throw new Error("project view must not be built when untrusted");
			},
		};

		const discovery = await discoverResources({ cwd: "/proj", agentDir: "/agent", trusted: false, factory });

		expect(discovery.trusted).toBe(false);
		expect(discovery.extensions.effective).toBe(discovery.extensions.global);
		expect(discovery.skills.effective).toBe(discovery.skills.global);
		expect(discovery.stores.project).toBe(discovery.stores.global);
	});

	test("drops the picker host's own entrypoint from both extension views, and no skill", async () => {
		const factory: DiscoveryFactory = {
			global: () => ({
				store: makeStore().store,
				resolve: async () =>
					resolved([packageExtension("bytefly", true), packageExtension("todo", true)], [skillItem("pdf")]),
			}),
			project: () => ({
				store: makeStore().store,
				resolve: async () =>
					resolved([packageExtension("bytefly", true), packageExtension("todo", false)], [skillItem("pdf")]),
			}),
		};

		const discovery = await discoverResources({ cwd: "/proj", agentDir: "/agent", trusted: true, factory });

		expect(discovery.extensions.global.map((entry) => entry.path)).toEqual(["/pkg/extensions/todo/index.ts"]);
		expect(discovery.extensions.effective.map((entry) => entry.path)).toEqual(["/pkg/extensions/todo/index.ts"]);
		expect(discovery.skills.global.map((entry) => entry.path)).toEqual(["/agent/skills/pdf/SKILL.md"]);
	});
});

describe("createResolver", () => {
	test("passes a skip handler so missing sources are never installed", async () => {
		let action: string | undefined;
		const manager: ResolverManager = {
			resolve: async (onMissing) => {
				action = await onMissing?.("missing");
				return { extensions: [], skills: [] };
			},
		};
		const resolver = createResolver(undefined as unknown as SettingsManager, "/proj", "/agent", manager);

		await resolver.resolve();

		expect(action).toBe("skip");
	});
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
		expect(getDisplayName(makeItem({ path: "/agent/extensions/foo/index.ts" }))).toBe("foo/index.ts");
	});

	test("keeps a flat extension as its file name", () => {
		expect(getDisplayName(makeItem({ path: "/agent/extensions/a.ts" }))).toBe("a.ts");
	});

	test("names a skill by its folder, or by a standalone file's stem", () => {
		expect(getDisplayName(skillItem("pdf-tools"), "skills")).toBe("pdf-tools");
		expect(getDisplayName(makeItem({ path: "/agent/skills/standalone.md" }), "skills")).toBe("standalone");
	});

	test("groups and sorts skills under their own source heading", () => {
		const entries = buildEntries([skillItem("zulu"), packageSkill("alpha")], "/agent", "skills");
		const groups = entries.filter((entry) => entry.kind === "group");
		const rows = entries.filter((entry) => entry.kind === "item");

		expect(groups).toHaveLength(2);
		expect(rows.map((entry) => (entry.kind === "item" ? entry.label : ""))).toEqual(["alpha", "zulu"]);
	});

	test("recognises the picker host's own entrypoint", () => {
		expect(isSelf(makeItem({ path: "/pkg/extensions/bytefly/index.ts" }))).toBe(true);
		expect(isSelf(makeItem({ path: "/pkg/extensions/todo/index.ts" }))).toBe(false);
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
		const resource = makeItem({ path: "/agent/extensions/a.ts" });
		expect(getResourcePattern(resource, "/proj", "/agent")).toBe("extensions/a.ts");
	});

	test("names a package resource relative to the package base", () => {
		expect(getPackageResourcePattern(packageItem("/pkg/extensions/b.ts"))).toBe("b.ts");
	});
});

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
		expect(nextGlobalPackages(["npm:pkg"], "npm:pkg", "b.ts", false, "extensions")).toEqual([
			{ source: "npm:pkg", extensions: ["-b.ts"] },
		]);
	});

	test("filters a skill into the entry's skills list", () => {
		expect(nextGlobalPackages(["npm:pkg"], "npm:pkg", "skills/pdf/SKILL.md", false, "skills")).toEqual([
			{ source: "npm:pkg", skills: ["-skills/pdf/SKILL.md"] },
		]);
	});

	test("leaves an unknown package list unchanged", () => {
		expect(nextGlobalPackages(["npm:other"], "npm:pkg", "b.ts", true, "extensions")).toEqual(["npm:other"]);
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
		const packageResource = makeItem({
			path: "/agent/pkg/extensions/z.ts",
			metadata: { source: "npm:pkg", origin: "package", scope: "user", baseDir: "/agent/pkg/extensions" },
		});
		expect(nextProjectPackages([], packageResource, false, "/proj", "/agent", "extensions")).toEqual([
			{ source: "npm:pkg", autoload: false, extensions: ["-z.ts"] },
		]);
	});

	test("creates the same delta for a skill, in its own list", () => {
		const skillAt = makeItem({
			path: "/agent/pkg/skills/z/SKILL.md",
			metadata: { source: "npm:pkg", origin: "package", scope: "user", baseDir: "/agent/pkg" },
		});
		expect(nextProjectPackages([], skillAt, false, "/proj", "/agent", "skills")).toEqual([
			{ source: "npm:pkg", autoload: false, skills: ["-skills/z/SKILL.md"] },
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
	const packageResource: ResourceItem = makeItem({
		path: "/agent/pkg/extensions/z.ts",
		metadata: { source: "npm:pkg", origin: "package", scope: "user", baseDir: "/agent/pkg/extensions" },
	});

	test("drops the entry a toggle created and left empty", () => {
		const written = nextProjectPackages([], packageResource, false, "/proj", "/agent", "extensions");
		expect(clearProjectPackages(written, packageResource, "/proj", "/agent", "extensions")).toEqual([]);
	});

	test("keeps the entry while another filter remains", () => {
		const written = nextProjectPackages(
			[{ source: "npm:pkg", autoload: false, extensions: ["-w.ts"] }],
			packageResource,
			false,
			"/proj",
			"/agent",
			"extensions",
		);
		expect(clearProjectPackages(written, packageResource, "/proj", "/agent", "extensions")).toEqual([
			{ source: "npm:pkg", autoload: false, extensions: ["-w.ts"] },
		]);
	});

	test("collapses a pre-existing entry back to its plain source", () => {
		expect(
			clearProjectPackages(
				[{ source: "npm:pkg", extensions: ["-z.ts"] }],
				packageResource,
				"/proj",
				"/agent",
				"extensions",
			),
		).toEqual(["npm:pkg"]);
	});

	test("leaves another kind's filter alone", () => {
		const entry = { source: "npm:pkg", skills: ["-z.ts"] };
		expect(clearProjectPackages([entry], packageResource, "/proj", "/agent", "extensions")).toEqual([entry]);
	});

	test("returns the same array when the package carries no filter for the item", () => {
		const plain = ["npm:pkg"];
		expect(clearProjectPackages(plain, packageResource, "/proj", "/agent", "extensions")).toBe(plain);

		const other = [{ source: "npm:pkg", extensions: ["-other.ts"] }];
		expect(clearProjectPackages(other, packageResource, "/proj", "/agent", "extensions")).toBe(other);
	});
});
