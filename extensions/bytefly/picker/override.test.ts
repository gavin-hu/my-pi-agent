/**
 * The project layer of the picker runtime: clearing a row's override, the
 * project's own package list, and what a write that did not land leaves behind.
 *
 * `runtime.test.ts` holds the scope itself and the toggles each scope writes;
 * `picker.test.ts` holds what the runtime is handed.
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

describe("runtime after a write that did not land", () => {
	/**
	 * Pi changes the document in memory before the queued write can fail, so the
	 * store keeps a value the file never took. A later `x` would read that phantom
	 * override and write the cleared list, reporting a change nobody made.
	 */
	test("leaves no package override for a later x to clear", async () => {
		const globalStore = makeStore({ packages: ["npm:pkg"] });
		const projectStore = makeStore({ global: globalStore.global() });
		const { discovery } = makeDiscovery({
			extensions: [packageExtension("todo", true)],
			globalStore,
			projectStore,
			trusted: true,
		});
		const errors: string[] = [];
		const runtime = createPickerRuntime({
			discovery,
			cwd: "/proj",
			agentDir: "/agent",
			onError: (message) => errors.push(message),
		});

		runtime.setScope("project");
		const row = runtime.items("extensions")[0];
		projectStore.recordError(new Error("EACCES: permission denied"), "/proj/.pi/settings.json");
		await runtime.toggle("extensions", row);

		expect(errors).toEqual(["/proj/.pi/settings.json: EACCES: permission denied"]);
		expect(projectStore.project().packages).toBeUndefined();
		expect(runtime.isDirty()).toBe(false);

		await runtime.clearOverride("extensions", row);

		expect(errors.at(-1)).toBe("No project override for todo/index.ts.");
		expect(projectStore.calls.setProjectPackages).toHaveLength(1);
		expect(projectStore.project().packages).toBeUndefined();
		expect(runtime.isDirty()).toBe(false);
	});

	test("leaves no top-level path override for a later x to clear", async () => {
		const projectStore = makeStore({ project: { extensions: [] } });
		const { discovery } = makeDiscovery({
			extensions: [personal("/agent/extensions/a.ts")],
			projectStore,
			trusted: true,
		});
		const errors: string[] = [];
		const runtime = createPickerRuntime({
			discovery,
			cwd: "/proj",
			agentDir: "/agent",
			onError: (message) => errors.push(message),
		});

		runtime.setScope("project");
		const row = runtime.items("extensions")[0];
		projectStore.recordError(new Error("disk full"));
		await runtime.toggle("extensions", row);

		expect(errors).toEqual(["disk full"]);
		expect(projectStore.project().extensions).toEqual([]);

		await runtime.clearOverride("extensions", row);

		expect(errors.at(-1)).toBe("No project override for a.ts.");
		expect(projectStore.calls.setProjectExtensionPaths).toHaveLength(1);
		expect(projectStore.project().extensions).toEqual([]);
	});
});

describe("runtime once the settings file stops being readable", () => {
	/**
	 * The store is re-read before the setter runs, so a file that broke while the
	 * screen was open is refused rather than written into memory and dropped.
	 */
	test("refuses the write and leaves the document as it was", async () => {
		const globalStore = makeStore({ packages: ["npm:pkg"] });
		const projectStore = makeStore({ global: globalStore.global() });
		const { discovery } = makeDiscovery({
			extensions: [packageExtension("todo", true)],
			globalStore,
			projectStore,
			trusted: true,
		});
		const errors: string[] = [];
		const runtime = createPickerRuntime({
			discovery,
			cwd: "/proj",
			agentDir: "/agent",
			onError: (message) => errors.push(message),
		});

		runtime.setScope("project");
		const row = runtime.items("extensions")[0];
		projectStore.failRead("Unexpected token '}'", "/proj/.pi/settings.json");
		await runtime.toggle("extensions", row);

		expect(errors).toEqual(["/proj/.pi/settings.json: Unexpected token '}'"]);
		expect(projectStore.calls.setProjectPackages).toEqual([]);
		expect(projectStore.project().packages).toBeUndefined();
		expect(row.enabled).toBe(true);
		expect(runtime.isDirty()).toBe(false);

		// Nothing was written into the store, so there is no override to clear — and the
		// second key refuses in the document's own terms rather than at the file.
		await runtime.clearOverride("extensions", row);

		expect(errors.at(-1)).toBe("No project override for todo/index.ts.");
		expect(projectStore.calls.setProjectPackages).toEqual([]);
	});
});
