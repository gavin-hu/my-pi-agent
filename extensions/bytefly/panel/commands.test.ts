/**
 * `/bytefly`: the one command, the subcommands it completes, and the text modes
 * it prints — doctor, the listings, and their flags.
 *
 * What the command does to the screen it opened is `probe.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { fakeCtx } from "../../../test/helpers/context.ts";
import { fakeTheme, makeFakePi } from "../../../test/helpers/fakes.ts";
import {
	bootPanel,
	commandDiscovery,
	fakeDoctor,
	fakeSettings,
	fakeUpdate,
	pathRow,
	skillIndex,
	userRow,
} from "../../../test/helpers/fixtures/bytefly.ts";
import { makeFinding, makeReport } from "../../../test/helpers/fixtures/doctor.ts";
import { makeDiscovery, makeItem, skillItem } from "../../../test/helpers/fixtures/picker.ts";
import { registerPanel } from "./commands.ts";
import type { DoctorRuntime } from "../doctor/runtime.ts";
import { SHIPPED_THEMES_DIR } from "./themes.ts";

/** The host's custom-UI factory, narrowed to what these tests drive. */
type ScreenFactory = (
	tui: { requestRender: () => void; terminal: { rows: number } },
	theme: typeof fakeTheme,
	keybindings: Record<string, never>,
	done: (result?: void) => void,
) => { render: (width: number) => string[] };

describe("bytefly panel command", () => {
	test("registers one /bytefly command", () => {
		const { commands } = bootPanel({});

		expect(commands.has("bytefly")).toBe(true);
		expect(commands.has("extensions")).toBe(false);
		expect(commands.has("doctor")).toBe(false);
	});

	test("completes the subcommands, extension names, and refresh", () => {
		const { commands } = bootPanel({});
		const labels = (prefix: string): string[] =>
			(commands.get("bytefly").getArgumentCompletions(prefix) ?? []).map((entry: { label: string }) => entry.label);

		const first = labels("");
		expect(first).toEqual(expect.arrayContaining(["doctor", "settings", "skills", "refresh", "plan"]));
		expect(first).not.toContain("header");
		expect(first).not.toContain("footer");
		expect(first).not.toContain("status");

		expect(labels("do")).toEqual(["doctor"]);
		expect(labels("file-")).toEqual(["file-browse", "file-read", "file-open"]);
		expect(commands.get("bytefly").getArgumentCompletions("do")?.[0]?.value).toBe("doctor ");
		expect(labels("doctor ")).toEqual(expect.arrayContaining(["plan", "refresh"]));
		expect(labels("doctor w")).toEqual(expect.arrayContaining(["web-access", "worktree"]));
		expect(commands.get("bytefly").getArgumentCompletions("doctor w")?.[0]?.value).toBe("doctor worktree");
		expect(labels("plan ")).toEqual(["refresh"]);
		expect(commands.get("bytefly").getArgumentCompletions("plan ")?.[0]?.value).toBe("plan refresh");
		expect(commands.get("bytefly").getArgumentCompletions("settings ")).toBeNull();
		expect(commands.get("bytefly").getArgumentCompletions("skills ")).toBeNull();
		expect(commands.get("bytefly").getArgumentCompletions("refresh ")).toBeNull();
		expect(commands.get("bytefly").getArgumentCompletions("doctor plan extra")).toBeNull();
	});

	test("rejects an extension name after settings before discovery", async () => {
		const { commands } = bootPanel({
			discover: async () => {
				throw new Error("should not resolve extensions");
			},
		});
		const { ctx, notifications } = fakeCtx({ mode: "print", extra: { isProjectTrusted: () => true } });

		await commands.get("bytefly").handler("settings plan", ctx);

		expect(notifications.at(-1)).toContain("settings takes no extension name");
		expect(notifications.at(-1)).toContain("plan");
	});

	test("rejects an extension name after skills before discovery", async () => {
		const { commands } = bootPanel({
			discover: async () => {
				throw new Error("should not resolve resources");
			},
		});
		const { ctx, notifications } = fakeCtx({ mode: "print", extra: { isProjectTrusted: () => true } });

		await commands.get("bytefly").handler("skills plan", ctx);

		expect(notifications.at(-1)).toContain("skills takes no extension name");
	});
});

describe("bytefly panel modes", () => {
	test("prints the grouped listing outside TUI mode", async () => {
		const { commands } = bootPanel({
			reports: [makeReport("plan")],
			discover: async () => makeDiscovery({ extensions: [userRow("one")] }).discovery,
		});
		const { ctx, notifications } = fakeCtx({ mode: "print", extra: { isProjectTrusted: () => true } });

		await commands.get("bytefly").handler("", ctx);

		const text = notifications.at(-1) ?? "";
		// The row is named for the extension directory, not for its `index.ts`.
		expect(text).toContain("[x] one");
		expect(text).not.toContain("one/index.ts");
		expect(text).toContain("plan");
	});

	test("prints the skills listing outside TUI mode", async () => {
		const index = skillIndex({
			"/agent/skills/pdf/SKILL.md": {
				name: "pdf-tools",
				description: "Read PDFs.",
				modelHidden: false,
			},
		});
		const { commands } = bootPanel({
			discover: async () =>
				makeDiscovery({
					extensions: [pathRow("/agent/extensions/one.ts")],
					skills: [skillItem("pdf")],
				}).discovery,
			skills: () => index,
		});
		const { ctx, notifications } = fakeCtx({ mode: "print", extra: { isProjectTrusted: () => true } });

		await commands.get("bytefly").handler("skills", ctx);

		const text = notifications.at(-1) ?? "";
		expect(text.split("\n")[0]).toBe("bytefly: Global · 1 skill");
		expect(text).toContain("[x] pdf-tools");
		expect(text).not.toContain("one.ts");
	});

	test("prints the doctor report for /bytefly doctor outside TUI mode", async () => {
		const report = makeReport("plan", [makeFinding("git", "missing", "not found on PATH", "install git")]);
		const { commands } = bootPanel({ reports: [report] });
		const { ctx, notifications } = fakeCtx({ mode: "print", extra: { isProjectTrusted: () => true } });

		await commands.get("bytefly").handler("doctor", ctx);

		const text = notifications.at(-1) ?? "";
		expect(text).toContain("doctor:");
		expect(text).toContain("git: not found on PATH");
	});

	test("prints one extension's findings when narrowed", async () => {
		const report = makeReport("plan", [makeFinding("git", "missing", "not found on PATH", "install git")]);
		const { commands } = bootPanel({ reports: [report] });
		const { ctx, notifications } = fakeCtx({ mode: "print", extra: { isProjectTrusted: () => true } });

		await commands.get("bytefly").handler("plan", ctx);

		expect(notifications.at(-1)).toContain("git: not found on PATH");
		expect(notifications.at(-1)).toContain("→ install git");
	});

	test("names the models this session could not price", async () => {
		const { commands } = bootPanel({});
		// Two records for a model with no rate in the default (DeepSeek, CNY) table, and
		// one for a model it prices: the report names the first and not the second.
		const at = "2026-10-26T08:00:00.000Z";
		const record = (model: string, input: number) => ({
			type: "usage",
			provider: "anthropic",
			model,
			usage: { input, output: 0, cacheRead: 0, cacheWrite: 0 },
			timestamp: at,
		});
		const { ctx, notifications } = fakeCtx({
			mode: "print",
			entries: [record("claude-fable-5", 1_000), record("claude-fable-5", 1_000)],
		});

		await commands.get("bytefly").handler("prices", ctx);

		const report = notifications.at(-1) ?? "";
		expect(report).toContain("2 records in 1 model have no rate");
		expect(report).toContain("anthropic/claude-fable-5 · 2 records");
		expect(report).toContain("price.rates");
	});

	test("says so when every record was priced", async () => {
		const { commands } = bootPanel({});
		const { ctx, notifications } = fakeCtx({ mode: "print", entries: [] });

		await commands.get("bytefly").handler("prices", ctx);

		expect(notifications.at(-1)).toBe("bytefly: every record in this session has a rate — nothing to add.");
	});

	test("warns on an unknown extension name", async () => {
		const { commands } = bootPanel({});
		const { ctx, notifications } = fakeCtx({ mode: "print", extra: { isProjectTrusted: () => true } });

		await commands.get("bytefly").handler("nope", ctx);

		expect(notifications.at(-1)).toContain('no extension named "nope"');
	});

	test("accepts a report name that is absent from the current scope view", async () => {
		const report = makeReport("plan", [makeFinding("git", "missing", "not found on PATH", "install git")]);
		const { commands } = bootPanel({ reports: [report] });
		const { ctx, notifications } = fakeCtx({ mode: "print", extra: { isProjectTrusted: () => true } });

		await commands.get("bytefly").handler("plan", ctx);

		expect(notifications.at(-1)).toContain("git: not found on PATH");
	});

	test("prints the no-report message for a named item with no report", async () => {
		const { commands } = bootPanel({
			discover: async () =>
				makeDiscovery({ extensions: [makeItem({ path: "/agent/extensions/one/index.ts" })] }).discovery,
		});
		const { ctx, notifications } = fakeCtx({ mode: "print", extra: { isProjectTrusted: () => true } });

		await commands.get("bytefly").handler("one", ctx);

		expect(notifications.at(-1)).toContain("one/index.ts");
		expect(notifications.at(-1)).toContain("— no doctor report");
	});

	test("sanitizes the name in the unknown-extension warning", async () => {
		const { commands } = bootPanel({});
		const { ctx, notifications } = fakeCtx({ mode: "print", extra: { isProjectTrusted: () => true } });

		await commands.get("bytefly").handler("bad\u001b[31m", ctx);

		expect(notifications.at(-1)).not.toContain("\u001b");
		expect(notifications.at(-1)).toContain('no extension named "bad');
	});

	test("reports a discovery failure instead of throwing", async () => {
		const { commands } = bootPanel({
			discover: async () => {
				throw new Error("no settings");
			},
		});
		const { ctx, notifications } = fakeCtx({ mode: "print", extra: { isProjectTrusted: () => true } });

		await commands.get("bytefly").handler("", ctx);

		expect(notifications.at(-1)).toContain("Could not list resources: no settings");
	});

	test("reports a probe failure instead of throwing", async () => {
		const { pi, commands } = makeFakePi();
		const doctor: DoctorRuntime = {
			...fakeDoctor([]),
			probeAll: async () => {
				throw new Error("probe exploded");
			},
		};
		registerPanel(pi, {
			doctor,
			update: fakeUpdate(),
			discover: async () => commandDiscovery(),
			settings: () => fakeSettings(),
		});
		const { ctx, notifications } = fakeCtx({ mode: "print", extra: { isProjectTrusted: () => true } });

		await commands.get("bytefly").handler("", ctx);

		expect(notifications.at(-1)).toContain("Could not probe extensions: probe exploded");
	});

	test("rejects an unknown name before probing the doctor", async () => {
		const refreshes: boolean[] = [];
		const { pi, commands } = makeFakePi();
		registerPanel(pi, {
			doctor: fakeDoctor([], refreshes),
			update: fakeUpdate(),
			discover: async () => commandDiscovery(),
			settings: () => fakeSettings(),
		});
		const { ctx, notifications } = fakeCtx({ mode: "print", extra: { isProjectTrusted: () => true } });

		await commands.get("bytefly").handler("nope", ctx);

		expect(notifications.at(-1)).toContain('no extension named "nope"');
		expect(refreshes).toEqual([]);
	});

	test("prints the settings listing outside TUI mode without resolving extensions", async () => {
		const { commands } = bootPanel({
			discover: async () => {
				throw new Error("should not resolve extensions");
			},
		});
		const { ctx, notifications } = fakeCtx({ mode: "print", extra: { isProjectTrusted: () => true } });

		await commands.get("bytefly").handler("settings", ctx);

		expect(notifications.at(-1)).toContain("bytefly: Settings · Global · 12 settings");
		expect(notifications.at(-1)).toContain("Startup screen: Off");
		expect(notifications.at(-1)).toContain("Session budget: Off");
		expect(notifications.at(-1)).toContain("Theme: system");
	});

	test("offers only this package's themes to the settings runtime", async () => {
		let themes: readonly string[] | undefined;
		const { commands } = bootPanel({
			settings: (deps) => {
				themes = deps.themes;
				return fakeSettings();
			},
		});
		const { ctx } = fakeCtx({ mode: "print", extra: { isProjectTrusted: () => true } });
		(ctx.ui as unknown as { getAllThemes: () => Array<{ name: string; path?: string }> }).getAllThemes = () => [
			{ name: "system" },
			{ name: "dark", path: "/pi/themes/dark.json" },
			{ name: "bytefly-dark", path: join(SHIPPED_THEMES_DIR, "bytefly-dark.json") },
			{ name: "mine", path: "/agent/themes/mine.json" },
			{ name: "bytefly-light", path: join(SHIPPED_THEMES_DIR, "bytefly-light.json") },
		];

		await commands.get("bytefly").handler("settings", ctx);

		expect(themes).toEqual(["bytefly-dark", "bytefly-light"]);
	});

	test("mounts the dock screen on the Settings section in TUI mode", async () => {
		const { commands } = bootPanel({});
		const { ctx } = fakeCtx({ mode: "tui", extra: { isProjectTrusted: () => true } });
		let rendered = "";
		ctx.ui.custom = async (factory: ScreenFactory) => {
			const component = factory({ requestRender: () => {}, terminal: { rows: 40 } }, fakeTheme, {}, () => {});
			rendered = component.render(80).join("\n");
			return undefined;
		};

		await commands.get("bytefly").handler("settings", ctx);

		expect(rendered).toContain("Settings 12");
		expect(rendered).toContain("Startup screen");
	});

	test("mounts the dock screen on the Skills section in TUI mode", async () => {
		const index = skillIndex({
			"/agent/skills/pdf/SKILL.md": {
				name: "pdf-tools",
				description: "Read PDFs.",
				modelHidden: false,
			},
		});
		const { commands } = bootPanel({
			discover: async () =>
				makeDiscovery({
					extensions: [pathRow("/agent/extensions/one.ts")],
					skills: [skillItem("pdf")],
				}).discovery,
			skills: () => index,
		});
		const { ctx } = fakeCtx({ mode: "tui", extra: { isProjectTrusted: () => true } });
		let rendered = "";
		ctx.ui.custom = async (factory: ScreenFactory) => {
			const component = factory({ requestRender: () => {}, terminal: { rows: 40 } }, fakeTheme, {}, () => {});
			rendered = component.render(80).join("\n");
			return undefined;
		};

		await commands.get("bytefly").handler("skills", ctx);

		expect(rendered).toContain("Skills 1");
		expect(rendered).toContain("pdf-tools");
	});

	test("mounts the dock screen once in TUI mode", async () => {
		const { commands } = bootPanel({});
		const { ctx, customCalls } = fakeCtx({ mode: "tui", extra: { isProjectTrusted: () => true } });

		await commands.get("bytefly").handler("", ctx);

		expect(customCalls).toHaveLength(1);
	});
});
