/**
 * The rows only Global writes: what the catalogue marks, what the row draws, what the
 * detail pane names, and what the runtime refuses.
 *
 * Three suites grew a case each when Currency joined the two app rows, and
 * `settings-runtime.test.ts` was already at the suite bar, so the capability they share is
 * its own suite — `settings-root.test.ts` exists for the same reason.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../../../test/helpers/env.ts";
import { fakeTheme } from "../../../test/helpers/fakes.ts";
import { makeTempTracker } from "../../../test/helpers/git.ts";
import { buildPanel, focusPanel, selectedLine } from "../../../test/helpers/fixtures/panel.ts";
import { makeStore } from "../../../test/helpers/fixtures/picker.ts";
import { fakeSettingsSurface, settingView, settingsSnapshot } from "../../../test/helpers/fixtures/settings.ts";
import { settle } from "../../../test/helpers/process.ts";
import { settingViews } from "./settings.ts";
import { createSettingsRuntime } from "./settings-runtime.ts";
import { sideRows } from "./tui/side-pane.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

const PATHS = { scope: "project" as const, cwd: "/proj", agentDir: "/agent" };
/** The three personal-file rows: the two app rows, and the currency that prices the footer. */
const PERSONAL = ["byteflyUi", "theme", "price.currency.code"];

describe("the rows only Global writes", () => {
	test("marks them read-only outside Global, and no other row", () => {
		const global = settingViews(settingsSnapshot(), "global");
		const project = settingViews(settingsSnapshot(), "project");
		const readOnly = (views: typeof global, id: string): boolean | undefined =>
			views.find((entry) => entry.id === id)?.readOnly;

		// A `bytefly.json` row Project may write stays writable, so the flag is what refuses
		// the currency, not its source.
		for (const id of PERSONAL) {
			expect(readOnly(global, id), id).toBe(false);
			expect(readOnly(project, id), id).toBe(true);
		}
		expect(readOnly(project, "notify.enabled")).toBe(false);
	});

	test("tags the Currency row in Project scope, and a Space there changes nothing", async () => {
		const base = fakeSettingsSurface({ global: { price: { currency: { code: "CNY" } } } });
		const { component } = buildPanel({ items: [], section: "settings", settings: base.surface });

		// The screen opens on Project in a trusted project, where this row cannot be written.
		component.render(80);
		focusPanel(component, "Currency");
		expect(selectedLine(component)).toContain("CNY (¥) · Global");

		component.handleInput(" ");
		await settle();
		await settle();
		expect(base.changes).toEqual([]);
	});

	test("tags the Theme row too, and a narrow terminal drops the tag rather than the value", () => {
		const { component } = buildPanel({ items: [], section: "settings", themes: ["system", "bytefly-dark"] });
		const text = component.render(80).join("\n");

		expect(text).toContain("system · Global");

		const narrow = component.render(40);
		expect(narrow.find((line) => line.includes("Theme")) ?? "").toContain("system");
		expect(narrow.join("\n")).not.toContain("· Global");
		expect(narrow.join("\n")).toContain("Change marked rows in Global scope.");
	});

	test("names the personal file rather than a project one in the detail pane", () => {
		const lines = sideRows({
			theme: fakeTheme,
			width: 60,
			section: "settings",
			setting: settingView(settingsSnapshot(), "project", "price.currency.code"),
			help: false,
			expanded: false,
			dirty: false,
			paths: PATHS,
		}).join("\n");

		expect(lines).toContain("Global only");
		expect(lines).toContain(join("/agent", "bytefly.json"));
	});

	test("refuses a Project write from every path, and writes nothing", async () => {
		const agentDir = temps.track(tempDir("bytefly-scope-agent-"));
		const cwd = temps.track(tempDir("bytefly-scope-cwd-"));
		const store = makeStore({ trusted: true });
		const notices: string[] = [];
		const runtime = createSettingsRuntime({
			stores: { global: store.store, project: store.store },
			cwd,
			agentDir,
			trusted: true,
			onError: (message) => notices.push(message),
		});
		const globalPath = join(agentDir, "bytefly.json");
		const projectPath = join(cwd, ".pi", "bytefly.json");

		for (const attempt of [
			() => runtime.change("project", "price.currency.code"),
			() => runtime.setValue("project", "price.currency.code", "USD"),
			() => runtime.reset("project", "price.currency.code"),
		]) {
			await attempt();
			expect(notices.at(-1)).toBe("Currency is a Global setting.");
		}

		// Nothing was written on either side: the refusal is a refusal, not a quiet write to
		// the personal file.
		expect(existsSync(globalPath) || existsSync(projectPath)).toBe(false);
		expect(runtime.isDirty()).toBe(false);
	});
});
