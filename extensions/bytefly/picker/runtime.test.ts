/**
 * The picker runtime's scope: the two views, which document a toggle edits, the
 * dirty flag, and the item the screen then shows.
 *
 * `override.test.ts` holds the project layer — clearing an override and what a
 * failed write leaves behind — and `picker.test.ts` what the runtime is handed.
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
