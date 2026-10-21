import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { readJson, SHARED_CONFIG_FILE } from "../../../lib/config.ts";
import { tempDir } from "../../../test/helpers/env.ts";
import { makeStore } from "../../../test/helpers/fixtures/picker.ts";
import { makeTempTracker } from "../../../test/helpers/git.ts";
import type { Settings } from "../picker/types.ts";
import { configPath, createSettingsRuntime } from "./settings-runtime.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

interface BootOptions {
	app?: Settings;
	globalDoc?: Record<string, unknown>;
	projectDoc?: Record<string, unknown>;
	trusted?: boolean;
	themes?: readonly string[];
}

function boot(options: BootOptions = {}) {
	const cwd = temps.track(tempDir("bytefly-settings-cwd-"));
	const agentDir = temps.track(tempDir("bytefly-settings-agent-"));
	if (options.globalDoc) {
		writeFileSync(join(agentDir, SHARED_CONFIG_FILE), JSON.stringify(options.globalDoc));
	}
	if (options.projectDoc) {
		mkdirSync(join(cwd, CONFIG_DIR_NAME), { recursive: true });
		writeFileSync(join(cwd, CONFIG_DIR_NAME, SHARED_CONFIG_FILE), JSON.stringify(options.projectDoc));
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
		globalPath: join(agentDir, SHARED_CONFIG_FILE),
		projectPath: join(cwd, CONFIG_DIR_NAME, SHARED_CONFIG_FILE),
	};
}

/** The current view for a row, or a failure when the scope hides it. */
function valueOf(runtime: ReturnType<typeof boot>["runtime"], scope: "global" | "project", id: string): string {
	const view = runtime.views(scope).find((entry) => entry.id === id);
	if (!view) throw new Error(`missing ${id} in ${scope}`);
	return view.value;
}

describe("configPath", () => {
	test("resolves the global and project documents", () => {
		expect(configPath("global", "/cwd", "/agent")).toBe(join("/agent", SHARED_CONFIG_FILE));
		expect(configPath("project", "/cwd", "/agent")).toBe(join("/cwd", CONFIG_DIR_NAME, SHARED_CONFIG_FILE));
	});
});

describe("app writes", () => {
	test("writes through the global setter, flushes, and marks the screen dirty", async () => {
		const { runtime, globalStore } = boot();

		await runtime.change("global", "byteflyUi");
		expect(globalStore.calls.setQuietStartup).toEqual([true]);
		expect(valueOf(runtime, "global", "byteflyUi")).toBe("true");

		await runtime.change("global", "byteflyUi");
		expect(globalStore.calls.setQuietStartup).toEqual([true, false]);
		expect(globalStore.flushCount()).toBe(2);
		expect(runtime.isDirty()).toBe(true);
		expect(valueOf(runtime, "global", "byteflyUi")).toBe("false");
	});

	test("refuses an app row in Project scope without touching the global store", async () => {
		const { runtime, globalStore, notices } = boot();

		await runtime.change("project", "byteflyUi");

		expect(notices.at(-1)).toContain("Global setting");
		expect(globalStore.calls.setQuietStartup).toEqual([]);
		expect(runtime.isDirty()).toBe(false);
	});

	test("writes the theme through the personal setter and flushes", async () => {
		const { runtime, globalStore } = boot({ themes: ["system", "dark", "light"] });

		await runtime.change("global", "theme");

		expect(globalStore.calls.setTheme).toEqual(["dark"]);
		expect(valueOf(runtime, "global", "theme")).toBe("dark");
		expect(globalStore.flushCount()).toBe(1);
		expect(runtime.isDirty()).toBe(true);
	});

	test("reports a flush failure and leaves the shown value unchanged", async () => {
		const { runtime, globalStore, notices } = boot();
		globalStore.failFlush(new Error("disk full"));

		await runtime.change("global", "byteflyUi");

		expect(notices.at(-1)).toContain("Could not save Bytefly startup TUI");
		expect(notices.at(-1)).toContain("disk full");
		expect(runtime.isDirty()).toBe(false);
		expect(valueOf(runtime, "global", "byteflyUi")).toBe("false");
	});
});

describe("bytefly writes", () => {
	test("writes one key to the global document and preserves siblings and metadata", async () => {
		const { runtime, globalPath } = boot({
			globalDoc: {
				$schema: "https://example.test/meta.json",
				version: 1,
				notify: { title: "Pi" },
				memory: { inject: true },
			},
		});

		await runtime.change("global", "notify.enabled");

		expect(readJson(globalPath)).toEqual({
			$schema: "https://example.test/meta.json",
			version: 1,
			notify: { title: "Pi", enabled: true },
			memory: { inject: true },
		});
		expect(runtime.isDirty()).toBe(true);
		expect(valueOf(runtime, "global", "notify.enabled")).toBe("true");
	});

	test("inherits the global value, then writes an explicit project override", async () => {
		const { runtime, globalPath, projectPath } = boot({ globalDoc: { notify: { enabled: true } } });

		expect(valueOf(runtime, "project", "notify.enabled")).toBe("true");

		await runtime.change("project", "notify.enabled");

		expect(readJson(globalPath)).toEqual({ notify: { enabled: true } });
		expect(readJson(projectPath)).toEqual({ notify: { enabled: false } });
		expect(valueOf(runtime, "project", "notify.enabled")).toBe("false");
	});

	test("stores the budget as a number and refuses a value its rule rejects", async () => {
		const { runtime, globalPath, notices } = boot();

		expect(await runtime.setValue("global", "price.budget", "2.50")).toBe(true);
		expect(readJson(globalPath)).toEqual({ price: { budget: 2.5 } });

		// The loader would clamp the amount on the next read, so the rule refuses it
		// before the file can hold it.
		expect(await runtime.setValue("global", "price.budget", "10000001")).toBe(false);
		expect(notices.at(-1)).toContain("Out of range");
		expect(readJson(globalPath)).toEqual({ price: { budget: 2.5 } });
	});

	test("cycles the currency algorithm", async () => {
		const { runtime, globalPath } = boot();

		expect(valueOf(runtime, "global", "price.currency.code")).toBe("CNY");
		await runtime.change("global", "price.currency.code");

		expect(readJson(globalPath)).toEqual({ price: { currency: { code: "USD", decimals: 3 } } });
		expect(valueOf(runtime, "global", "price.currency.code")).toBe("USD");
	});

	test("applies the currency and its companion leaf as one write", async () => {
		const { runtime, globalPath, notices } = boot();
		// A document the writer refuses: nothing may be half-applied, so the code
		// must not land while its precision does.
		const before = "{ not json";
		writeFileSync(globalPath, before);

		await runtime.change("global", "price.currency.code");

		expect(notices.at(-1)).toContain("Could not save Currency");
		expect(readFileSync(globalPath, "utf-8")).toBe(before);
		expect(valueOf(runtime, "global", "price.currency.code")).toBe("CNY");
	});

	test("writes a nested leaf and keeps the section's siblings and metadata", async () => {
		const { runtime, globalPath } = boot({
			globalDoc: {
				$schema: "https://example.test/meta.json",
				version: 1,
				price: { currency: { symbol: "$", decimals: 2 } },
				notify: { enabled: true },
			},
		});

		await runtime.change("global", "price.currency.code");

		expect(readJson(globalPath)).toEqual({
			$schema: "https://example.test/meta.json",
			version: 1,
			price: { currency: { symbol: "$", code: "USD", decimals: 3 } },
			notify: { enabled: true },
		});
		expect(valueOf(runtime, "global", "price.currency.code")).toBe("USD");
	});

	test("writes a nested project override without touching the global document", async () => {
		const { runtime, globalPath, projectPath } = boot({ globalDoc: { price: { currency: { code: "CNY" } } } });

		expect(valueOf(runtime, "project", "price.currency.code")).toBe("CNY");

		await runtime.change("project", "price.currency.code");

		expect(readJson(globalPath)).toEqual({ price: { currency: { code: "CNY" } } });
		expect(readJson(projectPath)).toEqual({ price: { currency: { code: "USD", decimals: 3 } } });
		expect(valueOf(runtime, "project", "price.currency.code")).toBe("USD");
	});

	test("writes the delivery method as a string", async () => {
		const { runtime, globalPath } = boot();

		await runtime.change("global", "notify.method");

		expect(readJson(globalPath)).toEqual({ notify: { method: "osc777" } });
		expect(valueOf(runtime, "global", "notify.method")).toBe("osc777");
	});

	test("refuses a project write when the project is untrusted", async () => {
		const { runtime, notices, projectPath } = boot({ trusted: false });

		await runtime.change("project", "notify.enabled");

		expect(notices.at(-1)).toContain("Project is not trusted");
		expect(existsSync(projectPath)).toBe(false);
		expect(runtime.isDirty()).toBe(false);
	});
});

describe("change notifications", () => {
	test("fires on a successful write and not on a refused one", async () => {
		let changes = 0;
		const { runtime } = boot();
		runtime.onChange(() => {
			changes += 1;
		});

		await runtime.change("global", "notify.enabled");
		expect(changes).toBe(1);

		await runtime.change("project", "byteflyUi");
		expect(changes).toBe(1);
	});
});

describe("text writes", () => {
	test("stores the value the user typed at its leaf", async () => {
		const { runtime, globalPath } = boot({
			globalDoc: { notify: { enabled: true }, price: { budget: 0 } },
		});

		expect(await runtime.setValue("global", "price.budget", "5")).toBe(true);

		expect(readJson(globalPath)).toEqual({ notify: { enabled: true }, price: { budget: 5 } });
		expect(valueOf(runtime, "global", "price.budget")).toBe("5");
		expect(runtime.isDirty()).toBe(true);
	});

	test("refuses a value its rule rejects and writes nothing", async () => {
		const { runtime, notices, globalPath } = boot({ globalDoc: { price: { budget: 3 } } });

		expect(await runtime.setValue("global", "price.budget", "10000001")).toBe(false);

		expect(notices.at(-1)).toContain("Out of range");
		expect(readJson(globalPath)).toEqual({ price: { budget: 3 } });
		expect(runtime.isDirty()).toBe(false);
		expect(valueOf(runtime, "global", "price.budget")).toBe("3");
	});

	test("refuses a row that is not a text row", async () => {
		const { runtime, notices } = boot();

		expect(await runtime.setValue("global", "notify.enabled", "true")).toBe(false);
		expect(notices.at(-1)).toContain("is not a text setting");
	});
});

describe("one guard for both write paths", () => {
	test("setValue refuses in Project scope for the same reason change does", async () => {
		const { runtime, notices, globalPath } = boot({ trusted: false, globalDoc: { price: { budget: 3 } } });

		expect(await runtime.setValue("project", "price.budget", "4")).toBe(false);

		expect(notices.at(-1)).toBe("Project is not trusted; settings can only be changed in Global scope.");
		expect(readJson(globalPath)).toEqual({ price: { budget: 3 } });
		expect(runtime.isDirty()).toBe(false);
	});
});

describe("reset", () => {
	test("deletes the row's leaf, keeps its siblings, and marks the screen dirty", async () => {
		const { runtime, globalPath } = boot({
			globalDoc: { job: { wakeOnFinish: true, showStatus: false }, notify: { enabled: true } },
		});

		expect(await runtime.reset("global", "job.wakeOnFinish")).toBe(true);

		expect(readJson(globalPath)).toEqual({ job: { showStatus: false }, notify: { enabled: true } });
		expect(valueOf(runtime, "global", "job.wakeOnFinish")).toBe("false");
		expect(runtime.isDirty()).toBe(true);
	});

	test("reports a row that is already at its default without writing", async () => {
		const { runtime, notices, globalPath } = boot({ globalDoc: { rewind: { autoSnapshots: false } } });

		expect(await runtime.reset("global", "job.wakeOnFinish")).toBe(false);

		expect(notices.at(-1)).toBe("Wake when a job finishes is already at its default.");
		expect(readJson(globalPath)).toEqual({ rewind: { autoSnapshots: false } });
		expect(runtime.isDirty()).toBe(false);
	});

	test("says an inherited project value is not a default", async () => {
		const { runtime, notices, globalPath } = boot({ globalDoc: { notify: { enabled: true } } });

		expect(await runtime.reset("project", "notify.enabled")).toBe(false);

		expect(notices.at(-1)).toBe(
			"Desktop notifications is inherited from Global; there is nothing to reset in Project.",
		);
		expect(readJson(globalPath)).toEqual({ notify: { enabled: true } });
		expect(runtime.isDirty()).toBe(false);
	});

	test("refuses an app row, which Pi has no unset for", async () => {
		const { runtime, notices } = boot();

		expect(await runtime.reset("global", "byteflyUi")).toBe(false);

		expect(notices.at(-1)).toContain("Pi has no unset");
		expect(runtime.isDirty()).toBe(false);
	});

	test("refuses Project scope when the project is untrusted", async () => {
		const { runtime, notices, globalPath } = boot({ trusted: false, globalDoc: { job: { wakeOnFinish: true } } });

		expect(await runtime.reset("project", "job.wakeOnFinish")).toBe(false);

		expect(notices.at(-1)).toBe("Project is not trusted; settings can only be changed in Global scope.");
		expect(readJson(globalPath)).toEqual({ job: { wakeOnFinish: true } });
	});

	test("reads the section from the scope the pane names", () => {
		const { runtime } = boot({
			globalDoc: { rewind: { autoSnapshots: false } },
			projectDoc: { job: { wakeOnFinish: true } },
		});

		expect(runtime.sectionDocument("global", "rewind")).toEqual({ autoSnapshots: false });
		expect(runtime.sectionDocument("project", "job")).toEqual({ wakeOnFinish: true });
		expect(runtime.sectionDocument("global", "watch")).toBeUndefined();
	});
});
