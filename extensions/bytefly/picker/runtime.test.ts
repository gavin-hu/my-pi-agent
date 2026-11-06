/**
 * The picker runtime: the write scope, the live view copies, the dirty flag, and
 * every write — which document each scope edits, and what a write that did not
 * land leaves behind.
 *
 * `picker.test.ts` holds what the runtime is handed: discovery, the resolver, the
 * rows, and the pure settings transforms.
 */

import { describe, expect, test } from "bun:test";
import { createPickerRuntime } from "./runtime.ts";
import {
	makeDiscovery,
	makeItem,
	makeStore,
	packageExtension,
	packageSkill,
	skillItem,
} from "../../../test/helpers/fixtures/picker.ts";

/** A top-level personal extension: what `makeItem` is with no overrides. */
const personal = (path: string) => makeItem({ path });

describe("runtime toggling", () => {
	test("writes a top-level global disable pattern and flips the item", async () => {
		const store = makeStore({ global: { extensions: [] } });
		const { discovery } = makeDiscovery({ extensions: [personal("/agent/extensions/a.ts")], globalStore: store });
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
		const { discovery } = makeDiscovery({ extensions: [packageExtension("b", true)], globalStore: store });
		const runtime = createPickerRuntime({ discovery, cwd: "/proj", agentDir: "/agent" });

		await runtime.toggle("extensions", runtime.items("extensions")[0]);

		expect(store.calls.setPackages.at(-1)).toEqual([{ source: "npm:pkg", extensions: ["-b/index.ts"] }]);
	});

	test("writes a package skill into the entry's skills filter", async () => {
		const store = makeStore({ packages: ["npm:pkg"] });
		const { discovery } = makeDiscovery({ skills: [packageSkill("pdf")], globalStore: store });
		const runtime = createPickerRuntime({ discovery, cwd: "/proj", agentDir: "/agent" });

		await runtime.toggle("skills", runtime.items("skills")[0]);

		expect(store.calls.setPackages.at(-1)).toEqual([{ source: "npm:pkg", skills: ["-skills/pdf/SKILL.md"] }]);
	});

	test("surfaces a rejected write instead of flipping the item", async () => {
		const store = makeStore({ global: { extensions: [] } });
		store.failFlush(new Error("disk full"));
		const errors: string[] = [];
		const { discovery } = makeDiscovery({ extensions: [personal("/agent/extensions/a.ts")], globalStore: store });
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

	test("reports the error Pi records for a failed write, naming its file", async () => {
		const store = makeStore({ global: { extensions: [] } });
		// Pi's flush resolves and queues the failure for `drainErrors`; the row is
		// only flipped when no error comes back.
		store.recordError(new Error("EACCES: permission denied"), "/agent/settings.json");
		const errors: string[] = [];
		const { discovery } = makeDiscovery({ extensions: [personal("/agent/extensions/a.ts")], globalStore: store });
		const runtime = createPickerRuntime({
			discovery,
			cwd: "/proj",
			agentDir: "/agent",
			onError: (message) => errors.push(message),
		});

		const row = runtime.items("extensions")[0];
		await runtime.toggle("extensions", row);

		expect(errors).toEqual(["/agent/settings.json: EACCES: permission denied"]);
		expect(row.enabled).toBe(true);
		expect(runtime.isDirty()).toBe(false);
	});

	test("refuses a toggle while the settings file cannot be read", async () => {
		const store = makeStore({ global: { extensions: [] }, loadErrors: ["Unexpected token '}'"] });
		const errors: string[] = [];
		const { discovery } = makeDiscovery({ extensions: [personal("/agent/extensions/a.ts")], globalStore: store });
		const runtime = createPickerRuntime({
			discovery,
			cwd: "/proj",
			agentDir: "/agent",
			onError: (message) => errors.push(message),
		});

		const row = runtime.items("extensions")[0];
		await runtime.toggle("extensions", row);

		expect(errors).toEqual(["Unexpected token '}'"]);
		expect(store.calls.setExtensionPaths).toEqual([]);
		expect(row.enabled).toBe(true);
		expect(runtime.isDirty()).toBe(false);
	});
});

describe("runtime scope", () => {
	test("switches between global and project views when trusted", () => {
		const { discovery } = makeDiscovery({
			extensions: [personal("/agent/extensions/a.ts")],
			effectiveExtensions: [personal("/proj/extensions/p.ts")],
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
		const { discovery } = makeDiscovery({ extensions: [personal("/agent/extensions/a.ts")], trusted: false });
		const runtime = createPickerRuntime({ discovery, cwd: "/proj", agentDir: "/agent" });

		runtime.setScope("project");

		expect(runtime.scope()).toBe("global");
		expect(runtime.projectAvailable()).toBe(false);
	});
});

describe("runtime clearing a project override", () => {
	const inherited = personal("/agent/extensions/a.ts");

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
		const { discovery } = makeDiscovery({ extensions: [inherited], globalStore: store });
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

describe("runtime writing the project's own package list", () => {
	/** A personal document holding packages the project file must never gain. */
	const personalStore = () => makeStore({ packages: ["npm:personal", "npm:todo-plus"] });

	test("writes the delta entry alone, not a copy of the personal list", async () => {
		const globalStore = personalStore();
		const { discovery, projectStore } = makeDiscovery({
			extensions: [packageExtension("todo", true)],
			globalStore,
			trusted: true,
		});
		const runtime = createPickerRuntime({ discovery, cwd: "/proj", agentDir: "/agent" });

		runtime.setScope("project");
		await runtime.toggle("extensions", runtime.items("extensions")[0]);

		expect(projectStore.calls.setProjectPackages.at(-1)).toEqual([
			{ source: "npm:pkg", autoload: false, extensions: ["-todo/index.ts"] },
		]);
		expect(globalStore.calls.setPackages).toEqual([]);
		expect(projectStore.project().packages).toEqual([
			{ source: "npm:pkg", autoload: false, extensions: ["-todo/index.ts"] },
		]);
	});

	test("keys a skill's delta by the project file, so the personal list stays whole", async () => {
		const globalStore = personalStore();
		const { discovery, projectStore } = makeDiscovery({
			skills: [packageSkill("pdf")],
			globalStore,
			trusted: true,
		});
		const runtime = createPickerRuntime({ discovery, cwd: "/proj", agentDir: "/agent" });

		runtime.setScope("project");
		await runtime.toggle("skills", runtime.items("skills")[0]);

		expect(projectStore.calls.setProjectPackages.at(-1)).toEqual([
			{ source: "npm:pkg", autoload: false, skills: ["-skills/pdf/SKILL.md"] },
		]);
		expect(globalStore.packages()).toEqual(["npm:personal", "npm:todo-plus"]);
	});

	test("clears the override out of the project's own entry, never the merged one", async () => {
		const globalStore = personalStore();
		const projectStore = makeStore({
			global: globalStore.global(),
			projectPackages: [{ source: "npm:pkg", autoload: false, extensions: ["-todo/index.ts"] }],
		});
		const { discovery } = makeDiscovery({
			extensions: [packageExtension("todo", true)],
			globalStore,
			projectStore,
			trusted: true,
		});
		const runtime = createPickerRuntime({ discovery, cwd: "/proj", agentDir: "/agent" });

		runtime.setScope("project");
		await runtime.clearOverride("extensions", runtime.items("extensions")[0]);

		expect(projectStore.calls.setProjectPackages.at(-1)).toEqual([]);
		expect(globalStore.calls.setPackages).toEqual([]);
		expect(projectStore.project().packages).toEqual([]);
	});

	test("says there is no override rather than clearing a personal entry into the project file", async () => {
		const errors: string[] = [];
		const globalStore = makeStore({ packages: [{ source: "npm:pkg", extensions: ["-todo/index.ts"] }] });
		const { discovery, projectStore } = makeDiscovery({
			extensions: [packageExtension("todo", true)],
			globalStore,
			trusted: true,
		});
		const runtime = createPickerRuntime({
			discovery,
			cwd: "/proj",
			agentDir: "/agent",
			onError: (message) => errors.push(message),
		});

		runtime.setScope("project");
		await runtime.clearOverride("extensions", runtime.items("extensions")[0]);

		expect(errors).toEqual(["No project override for todo/index.ts."]);
		expect(projectStore.calls.setProjectPackages).toEqual([]);
		expect(runtime.isDirty()).toBe(false);
	});
});
