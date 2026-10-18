import { describe, expect, test } from "bun:test";
import { ENV_DISABLED_EXTENSIONS } from "../../../lib/env.ts";
import type { ExtensionReport } from "../../../lib/requirements.ts";
import { fakeCtx } from "../../../test/helpers/context.ts";
import { withEnv } from "../../../test/helpers/env.ts";
import { fakeTheme, makeFakePi } from "../../../test/helpers/fakes.ts";
import { makeFinding, makeReport } from "../../../test/helpers/fixtures/doctor.ts";
import { makeDiscovery, makeItem, makeStore } from "../../../test/helpers/fixtures/picker.ts";
import type { DoctorRuntime } from "../doctor/runtime.ts";
import type { UpdateOutcome } from "../update/state.ts";
import { registerPanel } from "./commands.ts";
import { type SettingsSnapshot, settingViews } from "./settings.ts";
import type { SettingsRuntime } from "./settings-runtime.ts";

/** Let a fire-and-forget toggle settle. */
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const item = (path: string) => makeItem({ path });

function discovery() {
	return makeDiscovery({ global: [item("/agent/extensions/one.ts")] }).discovery;
}

/** A doctor runtime double that returns fixed reports and records refreshes. */
function fakeDoctor(reports: ExtensionReport[], refreshes: boolean[] = []): DoctorRuntime {
	return {
		configure: () => {},
		probeRequired: async () => reports,
		probeAll: async (options) => {
			refreshes.push(options?.refresh === true);
			return reports;
		},
		peek: () => reports,
		noteSearchFacts: () => {},
		reset: () => {},
	};
}

/** An update handle double that answers a fixed outcome and records re-checks. */
function fakeUpdate(outcome: UpdateOutcome = { kind: "current", latest: "0.12.0" }, checks: number[] = []) {
	return {
		recheck: async () => {
			checks.push(1);
			return outcome;
		},
	};
}

/** A Settings runtime double over an in-memory snapshot. */
function fakeSettings(options: { dirty?: boolean; snapshot?: SettingsSnapshot } = {}): SettingsRuntime {
	const snapshot = options.snapshot ?? { app: {}, global: {}, project: {} };
	let dirty = options.dirty ?? false;
	return {
		views: (scope) => settingViews(snapshot, scope),
		count: (scope) => settingViews(snapshot, scope).length,
		change: async () => {
			dirty = true;
		},
		setValue: async () => {
			dirty = true;
			return true;
		},
		isDirty: () => dirty,
		onChange: () => () => {},
	};
}

function boot(options: {
	discover?: () => Promise<ReturnType<typeof discovery>>;
	reports?: ExtensionReport[];
	settings?: () => SettingsRuntime;
	update?: { recheck: () => Promise<UpdateOutcome> };
}) {
	const { pi, commands } = makeFakePi();
	registerPanel(pi, {
		doctor: fakeDoctor(options.reports ?? []),
		update: options.update ?? fakeUpdate(),
		discover: options.discover ?? (async () => discovery()),
		settings: options.settings ?? (() => fakeSettings()),
	});
	return { pi, commands };
}

describe("bytefly panel command", () => {
	test("registers one /bytefly command", () => {
		const { commands } = boot({});

		expect(commands.has("bytefly")).toBe(true);
		expect(commands.has("extensions")).toBe(false);
		expect(commands.has("doctor")).toBe(false);
	});

	test("registers nothing when disabled through PI_DISABLED_EXTENSIONS", async () => {
		await withEnv({ [ENV_DISABLED_EXTENSIONS]: "bytefly" }, async () => {
			const { default: bytefly } = await import("../index.ts");
			const { pi, commands } = makeFakePi();
			bytefly(pi, { extensions: { discover: async () => discovery() } });
			expect(commands.size).toBe(0);
		});
	});

	test("completes the subcommands, extension names, and refresh", () => {
		const { commands } = boot({});
		const labels = (prefix: string): string[] =>
			(commands.get("bytefly").getArgumentCompletions(prefix) ?? []).map((entry: { label: string }) => entry.label);

		const first = labels("");
		expect(first).toEqual(expect.arrayContaining(["doctor", "settings", "refresh", "plan"]));
		expect(first).not.toContain("header");
		expect(first).not.toContain("footer");
		expect(first).not.toContain("status");

		// The host replaces the whole argument, so the value carries the prefix.
		expect(labels("do")).toEqual(["doctor", "document"]);
		expect(commands.get("bytefly").getArgumentCompletions("do")?.[0]?.value).toBe("doctor ");
		expect(labels("doctor ")).toEqual(expect.arrayContaining(["plan", "refresh"]));
		expect(labels("doctor w")).toEqual(expect.arrayContaining(["web-access", "worktree"]));
		expect(commands.get("bytefly").getArgumentCompletions("doctor w")?.[0]?.value).toBe("doctor worktree");
		expect(labels("plan ")).toEqual(["refresh"]);
		expect(commands.get("bytefly").getArgumentCompletions("plan ")?.[0]?.value).toBe("plan refresh");
		expect(commands.get("bytefly").getArgumentCompletions("settings ")).toBeNull();
		expect(commands.get("bytefly").getArgumentCompletions("refresh ")).toBeNull();
		expect(commands.get("bytefly").getArgumentCompletions("doctor plan extra")).toBeNull();
	});

	test("rejects an extension name after settings before discovery", async () => {
		const { commands } = boot({
			discover: async () => {
				throw new Error("should not resolve extensions");
			},
		});
		const { ctx, notifications } = fakeCtx({ mode: "print", extra: { isProjectTrusted: () => true } });

		await commands.get("bytefly").handler("settings plan", ctx);

		expect(notifications.at(-1)).toContain("settings takes no extension name");
		expect(notifications.at(-1)).toContain("plan");
	});
});

describe("bytefly panel modes", () => {
	test("prints the grouped listing outside TUI mode", async () => {
		const { commands } = boot({ reports: [makeReport("plan")] });
		const { ctx, notifications } = fakeCtx({ mode: "print", extra: { isProjectTrusted: () => true } });

		await commands.get("bytefly").handler("", ctx);

		const text = notifications.at(-1) ?? "";
		expect(text).toContain("[x] one.ts");
		expect(text).toContain("plan");
	});

	test("prints the doctor report for /bytefly doctor outside TUI mode", async () => {
		const report = makeReport("plan", [makeFinding("git", "missing", "not found on PATH", "install git")]);
		const { commands } = boot({ reports: [report] });
		const { ctx, notifications } = fakeCtx({ mode: "print", extra: { isProjectTrusted: () => true } });

		await commands.get("bytefly").handler("doctor", ctx);

		const text = notifications.at(-1) ?? "";
		expect(text).toContain("doctor:");
		expect(text).toContain("git: not found on PATH");
	});

	test("prints one extension's findings when narrowed", async () => {
		const report = makeReport("plan", [makeFinding("git", "missing", "not found on PATH", "install git")]);
		const { commands } = boot({ reports: [report] });
		const { ctx, notifications } = fakeCtx({ mode: "print", extra: { isProjectTrusted: () => true } });

		await commands.get("bytefly").handler("plan", ctx);

		expect(notifications.at(-1)).toContain("git: not found on PATH");
		expect(notifications.at(-1)).toContain("→ install git");
	});

	test("warns on an unknown extension name", async () => {
		const { commands } = boot({});
		const { ctx, notifications } = fakeCtx({ mode: "print", extra: { isProjectTrusted: () => true } });

		await commands.get("bytefly").handler("nope", ctx);

		expect(notifications.at(-1)).toContain('no extension named "nope"');
	});

	test("accepts a report name that is absent from the current scope view", async () => {
		const report = makeReport("plan", [makeFinding("git", "missing", "not found on PATH", "install git")]);
		const { commands } = boot({ reports: [report] });
		const { ctx, notifications } = fakeCtx({ mode: "print", extra: { isProjectTrusted: () => true } });

		await commands.get("bytefly").handler("plan", ctx);

		expect(notifications.at(-1)).toContain("git: not found on PATH");
	});

	test("prints the no-report message for a named item with no report", async () => {
		const { commands } = boot({
			discover: async () => makeDiscovery({ global: [makeItem({ path: "/agent/extensions/one/index.ts" })] }).discovery,
		});
		const { ctx, notifications } = fakeCtx({ mode: "print", extra: { isProjectTrusted: () => true } });

		await commands.get("bytefly").handler("one", ctx);

		expect(notifications.at(-1)).toContain("one/index.ts");
		expect(notifications.at(-1)).toContain("— no doctor report");
	});

	test("sanitizes the name in the unknown-extension warning", async () => {
		const { commands } = boot({});
		const { ctx, notifications } = fakeCtx({ mode: "print", extra: { isProjectTrusted: () => true } });

		await commands.get("bytefly").handler("bad\u001b[31m", ctx);

		expect(notifications.at(-1)).not.toContain("\u001b");
		expect(notifications.at(-1)).toContain('no extension named "bad');
	});

	test("reports a discovery failure instead of throwing", async () => {
		const { commands } = boot({
			discover: async () => {
				throw new Error("no settings");
			},
		});
		const { ctx, notifications } = fakeCtx({ mode: "print", extra: { isProjectTrusted: () => true } });

		await commands.get("bytefly").handler("", ctx);

		expect(notifications.at(-1)).toContain("Could not list extensions: no settings");
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
			discover: async () => discovery(),
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
			discover: async () => discovery(),
			settings: () => fakeSettings(),
		});
		const { ctx, notifications } = fakeCtx({ mode: "print", extra: { isProjectTrusted: () => true } });

		await commands.get("bytefly").handler("nope", ctx);

		expect(notifications.at(-1)).toContain('no extension named "nope"');
		expect(refreshes).toEqual([]);
	});

	test("prints the settings listing outside TUI mode without resolving extensions", async () => {
		const { commands } = boot({
			discover: async () => {
				throw new Error("should not resolve extensions");
			},
		});
		const { ctx, notifications } = fakeCtx({ mode: "print", extra: { isProjectTrusted: () => true } });

		await commands.get("bytefly").handler("settings", ctx);

		expect(notifications.at(-1)).toContain("bytefly: Settings · Global · 10 settings");
		expect(notifications.at(-1)).toContain("Bytefly startup TUI: Off");
		expect(notifications.at(-1)).toContain("Delivery method: Auto");
		expect(notifications.at(-1)).toContain("Cost decimals: 2");
	});

	test("mounts the dock screen on the Settings section in TUI mode", async () => {
		const { commands } = boot({});
		const { ctx } = fakeCtx({ mode: "tui", extra: { isProjectTrusted: () => true } });
		let rendered = "";
		ctx.ui.custom = async (factory: any) => {
			const component = factory({ requestRender: () => {}, terminal: { rows: 40 } }, fakeTheme, {}, () => {});
			rendered = component.render(80).join("\n");
			return undefined;
		};

		await commands.get("bytefly").handler("settings", ctx);

		expect(rendered).toContain("Global · 10 settings");
		expect(rendered).toContain("Bytefly startup TUI");
	});

	test("mounts the dock screen once in TUI mode", async () => {
		const { commands } = boot({});
		const { ctx, customCalls } = fakeCtx({ mode: "tui", extra: { isProjectTrusted: () => true } });

		await commands.get("bytefly").handler("", ctx);

		expect(customCalls).toHaveLength(1);
	});
});

describe("bytefly panel refresh", () => {
	test("re-probes when refresh is asked for", async () => {
		const refreshes: boolean[] = [];
		const { pi, commands } = makeFakePi();
		registerPanel(pi, {
			doctor: fakeDoctor([makeReport("plan")], refreshes),
			update: fakeUpdate(),
			discover: async () => discovery(),
			settings: () => fakeSettings(),
		});
		const { ctx } = fakeCtx({ mode: "print", extra: { isProjectTrusted: () => true } });

		await commands.get("bytefly").handler("doctor refresh", ctx);
		await commands.get("bytefly").handler("plan refresh", ctx);

		expect(refreshes).toEqual([true, true]);
	});
});

describe("bytefly update command", () => {
	/** Run `/bytefly update` over a fixed outcome, recording the handle's calls. */
	async function run(outcome: UpdateOutcome, mode = "print") {
		const checks: number[] = [];
		const { pi, commands } = makeFakePi();
		registerPanel(pi, {
			doctor: fakeDoctor([]),
			update: fakeUpdate(outcome, checks),
			discover: async () => {
				throw new Error("should not resolve extensions");
			},
			settings: () => fakeSettings(),
		});
		const { ctx, notifications } = fakeCtx({ mode, extra: { isProjectTrusted: () => true } });
		await commands.get("bytefly").handler("update", ctx);
		return { checks, notifications };
	}

	test("reports an available version with its release URL, resolving nothing", async () => {
		const { checks, notifications } = await run({ kind: "available", latest: "99.0.0" });

		expect(checks).toEqual([1]);
		expect(notifications.at(-1)).toContain("v99.0.0 is available");
		expect(notifications.at(-1)).toContain("https://github.com/gavin-hu/my-pi-agent/releases/tag/v99.0.0");
	});

	test("reports the newest version when nothing is newer", async () => {
		const { notifications } = await run({ kind: "current", latest: "0.12.0" });

		expect(notifications.at(-1)).toContain("up to date");
		expect(notifications.at(-1)).toContain("v0.12.0");
	});

	test("reports a failed read as a warning", async () => {
		const { notifications } = await run({ kind: "failed" });

		expect(notifications.at(-1)).toContain("could not read the published version");
	});

	test("reports a skip when offline", async () => {
		const { notifications } = await run({ kind: "offline" });

		expect(notifications.at(-1)).toContain("PI_OFFLINE");
	});

	test("accepts a stray refresh token and re-checks once", async () => {
		const checks: number[] = [];
		const { pi, commands } = makeFakePi();
		registerPanel(pi, {
			doctor: fakeDoctor([]),
			update: fakeUpdate({ kind: "current", latest: "0.12.0" }, checks),
			discover: async () => discovery(),
			settings: () => fakeSettings(),
		});
		const { ctx } = fakeCtx({ mode: "print", extra: { isProjectTrusted: () => true } });

		await commands.get("bytefly").handler("update refresh", ctx);

		expect(checks).toEqual([1]);
	});

	test("takes no second token and is offered first", () => {
		const { commands } = boot({});

		expect(commands.get("bytefly").getArgumentCompletions("update ")).toBeNull();
		const first = (commands.get("bytefly").getArgumentCompletions("") ?? []).map(
			(entry: { label: string }) => entry.label,
		);
		expect(first).toContain("update");
	});
});

describe("bytefly panel probing", () => {
	test("mounts before probing and probes on the first Extensions view", async () => {
		const events: string[] = [];
		const { pi, commands } = makeFakePi();
		registerPanel(pi, {
			doctor: {
				...fakeDoctor([]),
				peek: () => undefined,
				probeAll: async () => {
					events.push("probe");
					return [];
				},
			},
			update: fakeUpdate(),
			discover: async () => discovery(),
			settings: () => fakeSettings(),
		});
		const { ctx } = fakeCtx({ mode: "tui", extra: { isProjectTrusted: () => true } });
		ctx.ui.custom = async (factory: any) => {
			events.push("mount");
			factory({ requestRender: () => {}, terminal: { rows: 40 } }, fakeTheme, {}, () => {});
			return undefined;
		};

		await commands.get("bytefly").handler("", ctx);

		expect(events).toEqual(["mount", "probe"]);
	});

	test("opens Settings without probing, then probes on the Extensions view", async () => {
		const refreshes: boolean[] = [];
		const { pi, commands } = makeFakePi();
		registerPanel(pi, {
			doctor: { ...fakeDoctor([], refreshes), peek: () => undefined },
			update: fakeUpdate(),
			discover: async () => discovery(),
			settings: () => fakeSettings(),
		});
		const { ctx } = fakeCtx({ mode: "tui", extra: { isProjectTrusted: () => true } });
		let component: any;
		ctx.ui.custom = async (factory: any) => {
			component = factory({ requestRender: () => {}, terminal: { rows: 40 } }, fakeTheme, {}, () => {});
			return undefined;
		};

		await commands.get("bytefly").handler("settings", ctx);
		expect(refreshes).toEqual([]);

		component.handleInput("\u001b[D");
		expect(refreshes).toEqual([false]);
	});

	test("reuses the session cache without probing", async () => {
		const refreshes: boolean[] = [];
		const { pi, commands } = makeFakePi();
		registerPanel(pi, {
			doctor: fakeDoctor([makeReport("plan")], refreshes),
			update: fakeUpdate(),
			discover: async () => discovery(),
			settings: () => fakeSettings(),
		});
		const { ctx } = fakeCtx({ mode: "tui", extra: { isProjectTrusted: () => true } });
		let rendered = "";
		ctx.ui.custom = async (factory: any) => {
			const component = factory({ requestRender: () => {}, terminal: { rows: 40 } }, fakeTheme, {}, () => {});
			rendered = component.render(80).join("\n");
			return undefined;
		};

		await commands.get("bytefly").handler("", ctx);

		expect(refreshes).toEqual([]);
		expect(rendered).toContain("plan");
		expect(rendered).toContain("ok");
	});

	test("keeps the screen open when the first probe fails", async () => {
		const { pi, commands } = makeFakePi();
		registerPanel(pi, {
			doctor: {
				...fakeDoctor([]),
				peek: () => undefined,
				probeAll: async () => {
					throw new Error("probe exploded");
				},
			},
			update: fakeUpdate(),
			discover: async () => discovery(),
			settings: () => fakeSettings(),
		});
		const { ctx, notifications } = fakeCtx({ mode: "tui", extra: { isProjectTrusted: () => true } });
		let component: any;
		ctx.ui.custom = async (factory: any) => {
			component = factory({ requestRender: () => {}, terminal: { rows: 40 } }, fakeTheme, {}, () => {});
			await settle();
			return undefined;
		};

		await commands.get("bytefly").handler("", ctx);

		// The failure lands in the screen's hint row, not behind it in the transcript.
		expect(component.render(80).join("\n")).toContain("Could not refresh: probe exploded");
		expect(notifications).toEqual([]);
	});

	test("shows a runtime toggle failure in the frame", async () => {
		const store = makeStore({ global: { extensions: [] } });
		store.failFlush(new Error("settings locked"));
		const built = makeDiscovery({ global: [item("/agent/extensions/one.ts")], globalStore: store }).discovery;
		const { pi, commands } = makeFakePi();
		registerPanel(pi, {
			doctor: fakeDoctor([]),
			update: fakeUpdate(),
			discover: async () => built,
			settings: () => fakeSettings(),
		});
		const { ctx, notifications } = fakeCtx({ mode: "tui", extra: { isProjectTrusted: () => true } });
		let component: any;
		ctx.ui.custom = async (factory: any) => {
			component = factory({ requestRender: () => {}, terminal: { rows: 40 } }, fakeTheme, {}, () => {});
			return undefined;
		};

		await commands.get("bytefly").handler("", ctx);
		component.handleInput(" ");
		await settle();

		expect(component.render(80).join("\n")).toContain("settings locked");
		expect(notifications).toEqual([]);
	});

	test("forces the first probe when the command asked for refresh", async () => {
		const refreshes: boolean[] = [];
		const { pi, commands } = makeFakePi();
		registerPanel(pi, {
			doctor: { ...fakeDoctor([], refreshes), peek: () => undefined },
			update: fakeUpdate(),
			discover: async () => discovery(),
			settings: () => fakeSettings(),
		});
		const { ctx } = fakeCtx({ mode: "tui", extra: { isProjectTrusted: () => true } });
		ctx.ui.custom = async (factory: any) => {
			factory({ requestRender: () => {}, terminal: { rows: 40 } }, fakeTheme, {}, () => {});
			return undefined;
		};

		await commands.get("bytefly").handler("refresh", ctx);

		expect(refreshes).toEqual([true]);
	});

	test("re-probes a cached session when the command asked for refresh", async () => {
		const refreshes: boolean[] = [];
		const { pi, commands } = makeFakePi();
		registerPanel(pi, {
			doctor: fakeDoctor([makeReport("plan")], refreshes),
			update: fakeUpdate(),
			discover: async () => discovery(),
			settings: () => fakeSettings(),
		});
		const { ctx } = fakeCtx({ mode: "tui", extra: { isProjectTrusted: () => true } });
		ctx.ui.custom = async (factory: any) => {
			factory({ requestRender: () => {}, terminal: { rows: 40 } }, fakeTheme, {}, () => {});
			return undefined;
		};

		await commands.get("bytefly").handler("refresh", ctx);

		expect(refreshes).toEqual([true]);
	});
});

describe("bytefly panel reload", () => {
	test("offers a reload after a change and reloads when confirmed", async () => {
		const store = makeStore({ global: { extensions: [] } });
		const built = makeDiscovery({ global: [item("/agent/extensions/one.ts")], globalStore: store }).discovery;
		const { pi, commands } = makeFakePi();
		registerPanel(pi, {
			doctor: fakeDoctor([]),
			update: fakeUpdate(),
			discover: async () => built,
			settings: () => fakeSettings(),
		});

		let reloaded = 0;
		const { ctx } = fakeCtx({
			mode: "tui",
			confirm: true,
			extra: {
				isProjectTrusted: () => true,
				reload: async () => {
					reloaded += 1;
				},
			},
		});
		ctx.ui.custom = async (factory: any) => {
			const component = factory({ requestRender: () => {}, terminal: { rows: 40 } }, fakeTheme, {}, () => {});
			component.handleInput(" ");
			await settle();
			return undefined;
		};

		await commands.get("bytefly").handler("", ctx);

		expect(reloaded).toBe(1);
	});

	test("does not offer a reload when nothing changed", async () => {
		const store = makeStore({ global: { extensions: [] } });
		const built = makeDiscovery({ global: [item("/agent/extensions/one.ts")], globalStore: store }).discovery;
		const { pi, commands } = makeFakePi();
		registerPanel(pi, {
			doctor: fakeDoctor([]),
			update: fakeUpdate(),
			discover: async () => built,
			settings: () => fakeSettings(),
		});

		let confirmed = 0;
		const { ctx } = fakeCtx({
			mode: "tui",
			extra: { isProjectTrusted: () => true, reload: async () => {} },
		});
		ctx.ui.confirm = async () => {
			confirmed += 1;
			return false;
		};
		ctx.ui.custom = async () => undefined;

		await commands.get("bytefly").handler("doctor", ctx);

		expect(confirmed).toBe(0);
	});

	test("offers a reload when only a setting changed", async () => {
		const { commands } = boot({ settings: () => fakeSettings({ dirty: true }) });

		let reloaded = 0;
		const { ctx } = fakeCtx({
			mode: "tui",
			confirm: true,
			extra: {
				isProjectTrusted: () => true,
				reload: async () => {
					reloaded += 1;
				},
			},
		});
		ctx.ui.custom = async (factory: any) => {
			const component = factory({ requestRender: () => {}, terminal: { rows: 40 } }, fakeTheme, {}, () => {});
			component.handleInput("\u001b");
			return undefined;
		};

		await commands.get("bytefly").handler("settings", ctx);

		expect(reloaded).toBe(1);
	});
});
