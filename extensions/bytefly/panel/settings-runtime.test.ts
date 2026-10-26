/**
 * The Settings runtime: the snapshot cache, the scope guards, the app setters
 * and per-leaf `bytefly.json` writes, dirty state, and change listeners.
 *
 * The catalogue it writes through is `settings.test.ts`. The harness here owns
 * real files under the temp root, so its teardown lives in this file.
 */

import { describe, expect, test, afterAll } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../../../test/helpers/env.ts";
import { makeStore } from "../../../test/helpers/fixtures/picker.ts";
import { makeTempTracker } from "../../../test/helpers/git.ts";
import type { Settings, WriteScope } from "../picker/types.ts";
import { configPath, createSettingsRuntime, type SettingsRuntime } from "./settings-runtime.ts";
import { UNTRUSTED_SETTINGS_NOTE } from "./settings.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

interface RuntimeBootOptions {
	app?: Settings;
	globalDoc?: Record<string, unknown>;
	projectDoc?: Record<string, unknown>;
	trusted?: boolean;
	themes?: readonly string[];
}

function bootRuntime(options: RuntimeBootOptions = {}) {
	const cwd = temps.track(tempDir("bytefly-settings-cwd-"));
	const agentDir = temps.track(tempDir("bytefly-settings-agent-"));
	if (options.globalDoc) {
		writeFileSync(join(agentDir, "bytefly.json"), JSON.stringify(options.globalDoc));
	}
	if (options.projectDoc) {
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		writeFileSync(join(cwd, ".pi", "bytefly.json"), JSON.stringify(options.projectDoc));
	}
	const trusted = options.trusted ?? true;
	const globalStore = makeStore({ global: options.app ?? {}, trusted });
	const projectStore = makeStore({ trusted });
	const notices: string[] = [];
	const runtime = createSettingsRuntime({
		stores: { global: globalStore.store, project: projectStore.store },
		cwd,
		agentDir,
		trusted,
		themes: options.themes,
		onError: (message) => notices.push(message),
	});
	return {
		runtime,
		globalStore,
		projectStore,
		notices,
		globalPath: join(agentDir, "bytefly.json"),
		projectPath: join(cwd, ".pi", "bytefly.json"),
	};
}

function runtimeValue(runtime: SettingsRuntime, scope: WriteScope, id: string): string {
	const view = runtime.views(scope).find((entry) => entry.id === id);
	if (!view) throw new Error(`missing ${id} in ${scope}`);
	return view.value;
}

const readText = (path: string): string => readFileSync(path, "utf8");
const writeText = (path: string, text: string): void => writeFileSync(path, text);
const exists = (path: string): boolean => existsSync(path);

describe("settings runtime", () => {
	test("resolves the global and project documents", () => {
		expect(configPath("global", "/cwd", "/agent")).toBe(join("/agent", "bytefly.json"));
		expect(configPath("project", "/cwd", "/agent")).toBe(join("/cwd", ".pi", "bytefly.json"));
	});

	test("writes an app row through the global setter, flushes, and marks the screen dirty", async () => {
		const { runtime, globalStore } = bootRuntime();

		await runtime.change("global", "byteflyUi");
		expect(globalStore.calls.setQuietStartup).toEqual([true]);
		expect(runtimeValue(runtime, "global", "byteflyUi")).toBe("true");

		await runtime.change("global", "byteflyUi");
		expect(globalStore.calls.setQuietStartup).toEqual([true, false]);
		expect(globalStore.flushCount()).toBe(2);
		expect(runtime.isDirty()).toBe(true);
		expect(runtimeValue(runtime, "global", "byteflyUi")).toBe("false");
	});

	test("refuses an app row in Project scope without touching the global store", async () => {
		const { runtime, globalStore, notices } = bootRuntime();

		await runtime.change("project", "byteflyUi");

		expect(notices.at(-1)).toContain("Global setting");
		expect(globalStore.calls.setQuietStartup).toEqual([]);
		expect(runtime.isDirty()).toBe(false);
	});

	test("writes the theme through the personal setter and flushes", async () => {
		const { runtime, globalStore } = bootRuntime({ themes: ["system", "dark", "light"] });

		await runtime.change("global", "theme");

		expect(globalStore.calls.setTheme).toEqual(["dark"]);
		expect(runtimeValue(runtime, "global", "theme")).toBe("dark");
		expect(globalStore.flushCount()).toBe(1);
		expect(runtime.isDirty()).toBe(true);
	});

	test("reports a flush failure and leaves the shown value unchanged", async () => {
		const { runtime, globalStore, notices } = bootRuntime();
		globalStore.failFlush(new Error("disk full"));

		await runtime.change("global", "byteflyUi");

		expect(notices.at(-1)).toContain("Could not save Bytefly startup TUI");
		expect(notices.at(-1)).toContain("disk full");
		expect(runtime.isDirty()).toBe(false);
		expect(runtimeValue(runtime, "global", "byteflyUi")).toBe("false");
	});

	test("writes one key to the global document and preserves siblings and metadata", async () => {
		const { runtime, globalPath } = bootRuntime({
			globalDoc: {
				$schema: "https://example.test/meta.json",
				version: 1,
				notify: { title: "Pi" },
				memory: { inject: true },
			},
		});

		await runtime.change("global", "notify.enabled");

		expect(JSON.parse(readText(globalPath))).toEqual({
			$schema: "https://example.test/meta.json",
			version: 1,
			notify: { title: "Pi", enabled: true },
			memory: { inject: true },
		});
		expect(runtime.isDirty()).toBe(true);
		expect(runtimeValue(runtime, "global", "notify.enabled")).toBe("true");
	});

	test("inherits the global value, then writes an explicit project override", async () => {
		const { runtime, globalPath, projectPath } = bootRuntime({ globalDoc: { notify: { enabled: true } } });

		expect(runtimeValue(runtime, "project", "notify.enabled")).toBe("true");

		await runtime.change("project", "notify.enabled");

		expect(JSON.parse(readText(globalPath))).toEqual({ notify: { enabled: true } });
		expect(JSON.parse(readText(projectPath))).toEqual({ notify: { enabled: false } });
		expect(runtimeValue(runtime, "project", "notify.enabled")).toBe("false");
	});

	test("stores the budget as a number and refuses a value its rule rejects", async () => {
		const { runtime, globalPath, notices } = bootRuntime();

		expect(await runtime.setValue("global", "price.budget", "2.50")).toBe(true);
		expect(JSON.parse(readText(globalPath))).toEqual({ price: { budget: 2.5 } });

		expect(await runtime.setValue("global", "price.budget", "10000001")).toBe(false);
		expect(notices.at(-1)).toContain("Out of range");
		expect(JSON.parse(readText(globalPath))).toEqual({ price: { budget: 2.5 } });
	});

	test("cycles the currency algorithm and its companion precision in one write", async () => {
		const { runtime, globalPath } = bootRuntime();

		expect(runtimeValue(runtime, "global", "price.currency.code")).toBe("CNY");
		await runtime.change("global", "price.currency.code");

		expect(JSON.parse(readText(globalPath))).toEqual({ price: { currency: { code: "USD", decimals: 3 } } });
		expect(runtimeValue(runtime, "global", "price.currency.code")).toBe("USD");
	});

	test("applies the currency and its companion leaf as one write", async () => {
		const { runtime, globalPath, notices } = bootRuntime();
		const before = "{ not json";
		writeText(globalPath, before);

		await runtime.change("global", "price.currency.code");

		expect(notices.at(-1)).toContain("Could not save Currency");
		expect(readText(globalPath)).toBe(before);
		expect(runtimeValue(runtime, "global", "price.currency.code")).toBe("CNY");
	});

	test("writes a nested leaf and keeps the section's siblings and metadata", async () => {
		const { runtime, globalPath } = bootRuntime({
			globalDoc: {
				$schema: "https://example.test/meta.json",
				version: 1,
				price: { currency: { symbol: "$", decimals: 2 } },
				notify: { enabled: true },
			},
		});

		await runtime.change("global", "price.currency.code");

		expect(JSON.parse(readText(globalPath))).toEqual({
			$schema: "https://example.test/meta.json",
			version: 1,
			price: { currency: { symbol: "$", code: "USD", decimals: 3 } },
			notify: { enabled: true },
		});
		expect(runtimeValue(runtime, "global", "price.currency.code")).toBe("USD");
	});

	test("writes a nested project override without touching the global document", async () => {
		const { runtime, globalPath, projectPath } = bootRuntime({ globalDoc: { price: { currency: { code: "CNY" } } } });

		expect(runtimeValue(runtime, "project", "price.currency.code")).toBe("CNY");

		await runtime.change("project", "price.currency.code");

		expect(JSON.parse(readText(globalPath))).toEqual({ price: { currency: { code: "CNY" } } });
		expect(JSON.parse(readText(projectPath))).toEqual({ price: { currency: { code: "USD", decimals: 3 } } });
		expect(runtimeValue(runtime, "project", "price.currency.code")).toBe("USD");
	});

	test("refuses a project write when the project is untrusted", async () => {
		const { runtime, notices, projectPath } = bootRuntime({ trusted: false });

		await runtime.change("project", "notify.enabled");

		expect(notices.at(-1)).toContain("Project is not trusted");
		expect(exists(projectPath)).toBe(false);
		expect(runtime.isDirty()).toBe(false);
	});

	test("fires a change notification on a successful write and not on a refused one", async () => {
		let changes = 0;
		const { runtime } = bootRuntime();
		runtime.onChange(() => {
			changes += 1;
		});

		await runtime.change("global", "notify.enabled");
		expect(changes).toBe(1);

		await runtime.change("project", "byteflyUi");
		expect(changes).toBe(1);
	});

	test("stores a typed value at its leaf and marks the screen dirty", async () => {
		const { runtime, globalPath } = bootRuntime({
			globalDoc: { notify: { enabled: true }, price: { budget: 0 } },
		});

		expect(await runtime.setValue("global", "price.budget", "5")).toBe(true);

		expect(JSON.parse(readText(globalPath))).toEqual({ notify: { enabled: true }, price: { budget: 5 } });
		expect(runtimeValue(runtime, "global", "price.budget")).toBe("5");
		expect(runtime.isDirty()).toBe(true);
	});

	test("refuses a text value its rule rejects and writes nothing", async () => {
		const { runtime, notices, globalPath } = bootRuntime({ globalDoc: { price: { budget: 3 } } });

		expect(await runtime.setValue("global", "price.budget", "10000001")).toBe(false);

		expect(notices.at(-1)).toContain("Out of range");
		expect(JSON.parse(readText(globalPath))).toEqual({ price: { budget: 3 } });
		expect(runtime.isDirty()).toBe(false);
		expect(runtimeValue(runtime, "global", "price.budget")).toBe("3");
	});

	test("refuses a row that is not a text row", async () => {
		const { runtime, notices } = bootRuntime();
		expect(await runtime.setValue("global", "notify.enabled", "true")).toBe(false);
		expect(notices.at(-1)).toContain("is not a text setting");
	});

	test("setValue refuses in Project scope for the same reason change does", async () => {
		const { runtime, notices, globalPath } = bootRuntime({ trusted: false, globalDoc: { price: { budget: 3 } } });

		expect(await runtime.setValue("project", "price.budget", "4")).toBe(false);

		expect(notices.at(-1)).toBe(UNTRUSTED_SETTINGS_NOTE);
		expect(JSON.parse(readText(globalPath))).toEqual({ price: { budget: 3 } });
		expect(runtime.isDirty()).toBe(false);
	});

	test("deletes the row's leaf on reset, keeps its siblings, and marks the screen dirty", async () => {
		const { runtime, globalPath } = bootRuntime({
			globalDoc: { job: { wakeOnFinish: true, showStatus: false }, notify: { enabled: true } },
		});

		expect(await runtime.reset("global", "job.wakeOnFinish")).toBe(true);

		expect(JSON.parse(readText(globalPath))).toEqual({ job: { showStatus: false }, notify: { enabled: true } });
		expect(runtimeValue(runtime, "global", "job.wakeOnFinish")).toBe("false");
		expect(runtime.isDirty()).toBe(true);
	});

	test("reports a row that is already at its default without writing", async () => {
		const { runtime, notices, globalPath } = bootRuntime({ globalDoc: { rewind: { autoSnapshots: false } } });

		expect(await runtime.reset("global", "job.wakeOnFinish")).toBe(false);

		expect(notices.at(-1)).toBe("Wake when a job finishes is already at its default.");
		expect(JSON.parse(readText(globalPath))).toEqual({ rewind: { autoSnapshots: false } });
		expect(runtime.isDirty()).toBe(false);
	});

	test("says an inherited project value is not a default", async () => {
		const { runtime, notices, globalPath } = bootRuntime({ globalDoc: { notify: { enabled: true } } });

		expect(await runtime.reset("project", "notify.enabled")).toBe(false);

		expect(notices.at(-1)).toBe(
			"Desktop notifications is inherited from Global; there is nothing to reset in Project.",
		);
		expect(JSON.parse(readText(globalPath))).toEqual({ notify: { enabled: true } });
		expect(runtime.isDirty()).toBe(false);
	});

	test("refuses an app row, which Pi has no unset for", async () => {
		const { runtime, notices } = bootRuntime();

		expect(await runtime.reset("global", "byteflyUi")).toBe(false);

		expect(notices.at(-1)).toContain("Pi has no unset");
		expect(runtime.isDirty()).toBe(false);
	});

	test("refuses a Project reset when the project is untrusted", async () => {
		const { runtime, notices, globalPath } = bootRuntime({
			trusted: false,
			globalDoc: { job: { wakeOnFinish: true } },
		});

		expect(await runtime.reset("project", "job.wakeOnFinish")).toBe(false);

		expect(notices.at(-1)).toBe(UNTRUSTED_SETTINGS_NOTE);
		expect(JSON.parse(readText(globalPath))).toEqual({ job: { wakeOnFinish: true } });
	});

	test("reports an unknown id from every write path without touching a file", async () => {
		const { runtime, notices, globalPath } = bootRuntime({ globalDoc: { notify: { enabled: true } } });

		await runtime.change("global", "missing");
		expect(await runtime.setValue("global", "missing", "1")).toBe(false);
		expect(await runtime.reset("global", "missing")).toBe(false);

		expect(notices).toEqual(["missing is not a setting.", "missing is not a setting."]);
		expect(JSON.parse(readText(globalPath))).toEqual({ notify: { enabled: true } });
		expect(runtime.isDirty()).toBe(false);
	});

	test("reads the section from the scope the pane names", () => {
		const { runtime } = bootRuntime({
			globalDoc: { rewind: { autoSnapshots: false } },
			projectDoc: { job: { wakeOnFinish: true } },
		});

		expect(runtime.sectionDocument("global", "rewind")).toEqual({ autoSnapshots: false });
		expect(runtime.sectionDocument("project", "job")).toEqual({ wakeOnFinish: true });
		expect(runtime.sectionDocument("global", "job")).toBeUndefined();
	});
});
