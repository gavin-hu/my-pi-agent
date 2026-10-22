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
import { createPickerRuntime } from "./runtime.ts";
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
	makeDiscovery,
	makeItem,
	makeStore,
	packageExtension,
	skillItem,
} from "../../../test/helpers/fixtures/picker.ts";

const item = (path: string) => makeItem({ path });
const topLevel = (path: string) => makeItem({ path, metadata: { source: "auto", origin: "top-level", scope: "user" } });
const packageItem = (path: string) =>
	makeItem({
		path,
		metadata: { source: "npm:pkg", origin: "package", scope: "user", baseDir: "/pkg/extensions" },
	});
const packageSkill = (path: string) =>
	makeItem({
		path,
		metadata: { source: "npm:pkg", origin: "package", scope: "user", baseDir: "/pkg" },
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
		const entries = buildEntries([skillItem("zulu"), packageSkill("/pkg/skills/alpha/SKILL.md")], "/agent", "skills");
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

describe("runtime toggling", () => {
	test("writes a top-level global disable pattern and flips the item", async () => {
		const store = makeStore({ global: { extensions: [] } });
		const { discovery } = makeDiscovery({ extensions: [topLevel("/agent/extensions/a.ts")], globalStore: store });
		const runtime = createPickerRuntime({ discovery, cwd: "/proj", agentDir: "/agent" });

		const row = runtime.items("extensions")[0];
		await runtime.toggle("extensions", row);

		expect(store.calls.setExtensionPaths.at(-1)).toEqual(["-extensions/a.ts"]);
		expect(row.enabled).toBe(false);
		expect(runtime.isDirty()).toBe(true);
		expect(runtime.disabledCount("extensions")).toBe(1);
		expect(store.flushCount()).toBe(1);
	});

	test("writes a top-level skill pattern into the skills array", async () => {
		const store = makeStore({ global: { skills: [] } });
		const { discovery } = makeDiscovery({ skills: [skillItem("pdf")], globalStore: store });
		const runtime = createPickerRuntime({ discovery, cwd: "/proj", agentDir: "/agent" });

		const row = runtime.items("skills")[0];
		await runtime.toggle("skills", row);

		expect(store.calls.setSkillPaths.at(-1)).toEqual(["-skills/pdf/SKILL.md"]);
		expect(store.calls.setExtensionPaths).toEqual([]);
		expect(row.enabled).toBe(false);
		expect(runtime.disabledCount("skills")).toBe(1);
	});

	test("writes a package filter through setPackages", async () => {
		const store = makeStore({ packages: ["npm:pkg"] });
		const { discovery } = makeDiscovery({ extensions: [packageItem("/pkg/extensions/b.ts")], globalStore: store });
		const runtime = createPickerRuntime({ discovery, cwd: "/proj", agentDir: "/agent" });

		await runtime.toggle("extensions", runtime.items("extensions")[0]);

		expect(store.calls.setPackages.at(-1)).toEqual([{ source: "npm:pkg", extensions: ["-b.ts"] }]);
	});

	test("writes a package skill into the entry's skills filter", async () => {
		const store = makeStore({ packages: ["npm:pkg"] });
		const { discovery } = makeDiscovery({ skills: [packageSkill("/pkg/skills/pdf/SKILL.md")], globalStore: store });
		const runtime = createPickerRuntime({ discovery, cwd: "/proj", agentDir: "/agent" });

		await runtime.toggle("skills", runtime.items("skills")[0]);

		expect(store.calls.setPackages.at(-1)).toEqual([{ source: "npm:pkg", skills: ["-skills/pdf/SKILL.md"] }]);
	});

	test("surfaces a write failure instead of flipping the item", async () => {
		const store = makeStore({ global: { extensions: [] } });
		store.failFlush(new Error("disk full"));
		const errors: string[] = [];
		const { discovery } = makeDiscovery({ extensions: [topLevel("/agent/extensions/a.ts")], globalStore: store });
		const runtime = createPickerRuntime({
			discovery,
			cwd: "/proj",
			agentDir: "/agent",
			onError: (message) => errors.push(message),
		});

		const row = runtime.items("extensions")[0];
		await runtime.toggle("extensions", row);

		expect(errors).toEqual(["disk full"]);
		expect(row.enabled).toBe(true);
		expect(runtime.isDirty()).toBe(false);
	});
});

describe("runtime scope", () => {
	test("switches between global and project views when trusted", () => {
		const { discovery } = makeDiscovery({
			extensions: [topLevel("/agent/extensions/a.ts")],
			effectiveExtensions: [topLevel("/proj/extensions/p.ts")],
			trusted: true,
		});
		const runtime = createPickerRuntime({ discovery, cwd: "/proj", agentDir: "/agent" });

		expect(runtime.items("extensions")[0].path).toBe("/agent/extensions/a.ts");
		runtime.setScope("project");
		expect(runtime.items("extensions")[0].path).toBe("/proj/extensions/p.ts");
	});

	test("switches both kinds together, so one scope drives the screen", () => {
		const { discovery } = makeDiscovery({
			skills: [skillItem("global-skill")],
			effectiveSkills: [skillItem("project-skill")],
			trusted: true,
		});
		const runtime = createPickerRuntime({ discovery, cwd: "/proj", agentDir: "/agent" });

		expect(runtime.items("skills")[0].path).toContain("global-skill");
		runtime.setScope("project");
		expect(runtime.items("skills")[0].path).toContain("project-skill");
	});

	test("refuses the project scope when the project is untrusted", () => {
		const { discovery } = makeDiscovery({ extensions: [topLevel("/agent/extensions/a.ts")], trusted: false });
		const runtime = createPickerRuntime({ discovery, cwd: "/proj", agentDir: "/agent" });

		runtime.setScope("project");

		expect(runtime.scope()).toBe("global");
		expect(runtime.projectAvailable()).toBe(false);
	});
});

describe("runtime clearing a project override", () => {
	const inherited = topLevel("/agent/extensions/a.ts");

	test("removes the project override and restores the inherited state", async () => {
		const globalStore = makeStore({ global: { extensions: [] } });
		const projectStore = makeStore({ project: { extensions: [] } });
		const { discovery } = makeDiscovery({ extensions: [inherited], globalStore, projectStore, trusted: true });
		const runtime = createPickerRuntime({ discovery, cwd: "/proj", agentDir: "/agent" });

		runtime.setScope("project");
		const row = runtime.items("extensions")[0];
		await runtime.toggle("extensions", row);
		expect(row.enabled).toBe(false);
		expect(projectStore.calls.setProjectExtensionPaths.at(-1)).toEqual([
			"/agent/extensions/a.ts",
			"-/agent/extensions/a.ts",
		]);

		await runtime.clearOverride("extensions", row);

		expect(projectStore.calls.setProjectExtensionPaths.at(-1)).toEqual([]);
		expect(row.enabled).toBe(true);
		expect(runtime.isDirty()).toBe(true);
		expect(projectStore.flushCount()).toBe(2);
	});

	test("clears a skill's project override through the skills array", async () => {
		const globalSkill = skillItem("pdf");
		const projectStore = makeStore({ project: { skills: [] } });
		const { discovery } = makeDiscovery({ skills: [globalSkill], projectStore, trusted: true });
		const runtime = createPickerRuntime({ discovery, cwd: "/proj", agentDir: "/agent" });

		runtime.setScope("project");
		const row = runtime.items("skills")[0];
		await runtime.toggle("skills", row);
		expect(projectStore.calls.setProjectSkillPaths.at(-1)).toEqual([
			"/agent/skills/pdf/SKILL.md",
			"-/agent/skills/pdf/SKILL.md",
		]);

		await runtime.clearOverride("skills", row);

		expect(projectStore.calls.setProjectSkillPaths.at(-1)).toEqual([]);
		expect(row.enabled).toBe(true);
	});

	test("reports a row with no override and writes nothing", async () => {
		const errors: string[] = [];
		const projectStore = makeStore({ project: { extensions: [] } });
		const { discovery } = makeDiscovery({ extensions: [inherited], projectStore, trusted: true });
		const runtime = createPickerRuntime({
			discovery,
			cwd: "/proj",
			agentDir: "/agent",
			onError: (message) => errors.push(message),
		});

		runtime.setScope("project");
		await runtime.clearOverride("extensions", runtime.items("extensions")[0]);

		expect(errors).toEqual(["No project override for a.ts."]);
		expect(projectStore.calls.setProjectExtensionPaths).toEqual([]);
		expect(runtime.isDirty()).toBe(false);
	});

	test("refuses in Global scope, which has no layer to fall back to", async () => {
		const errors: string[] = [];
		const store = makeStore({ global: { extensions: ["-extensions/a.ts"] } });
		const { discovery } = makeDiscovery({ extensions: [topLevel("/agent/extensions/a.ts")], globalStore: store });
		const runtime = createPickerRuntime({
			discovery,
			cwd: "/proj",
			agentDir: "/agent",
			onError: (message) => errors.push(message),
		});

		await runtime.clearOverride("extensions", runtime.items("extensions")[0]);

		expect(errors).toEqual(["Overrides are cleared in Project scope; switch with Tab."]);
		expect(store.calls.setExtensionPaths).toEqual([]);
		expect(runtime.isDirty()).toBe(false);
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
		const packageSkill = makeItem({
			path: "/agent/pkg/skills/z/SKILL.md",
			metadata: { source: "npm:pkg", origin: "package", scope: "user", baseDir: "/agent/pkg" },
		});
		expect(nextProjectPackages([], packageSkill, false, "/proj", "/agent", "skills")).toEqual([
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
