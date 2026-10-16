import { describe, expect, test } from "bun:test";
import { ENV_DISABLED_EXTENSIONS } from "../../../lib/env.ts";
import type { ExtensionReport } from "../../../lib/requirements.ts";
import { fakeCtx } from "../../../test/helpers/context.ts";
import { withEnv } from "../../../test/helpers/env.ts";
import { fakeTheme, makeFakePi } from "../../../test/helpers/fakes.ts";
import { makeFinding, makeReport } from "../../../test/helpers/fixtures/doctor.ts";
import { makeDiscovery, makeItem, makeStore } from "../../../test/helpers/fixtures/picker.ts";
import type { DoctorRuntime } from "../doctor/runtime.ts";
import { registerPanel } from "./commands.ts";

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
		reset: () => {},
	};
}

function boot(options: { discover?: () => Promise<ReturnType<typeof discovery>>; reports?: ExtensionReport[] }) {
	const { pi, commands } = makeFakePi();
	registerPanel(pi, {
		doctor: fakeDoctor(options.reports ?? []),
		discover: options.discover ?? (async () => discovery()),
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

	test("completes the doctor subcommand, extension names, and refresh", () => {
		const { commands } = boot({});
		const values = commands
			.get("bytefly")
			.getArgumentCompletions("")
			.map((entry: { value: string }) => entry.value);
		expect(values).toContain("doctor");
		expect(values).toContain("refresh");
		expect(values).toContain("plan");
		expect(values).not.toContain("header");
		expect(values).not.toContain("footer");
		expect(values).not.toContain("status");
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
		registerPanel(pi, { doctor, discover: async () => discovery() });
		const { ctx, notifications } = fakeCtx({ mode: "print", extra: { isProjectTrusted: () => true } });

		await commands.get("bytefly").handler("", ctx);

		expect(notifications.at(-1)).toContain("Could not probe extensions: probe exploded");
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
		registerPanel(pi, { doctor: fakeDoctor([makeReport("plan")], refreshes), discover: async () => discovery() });
		const { ctx } = fakeCtx({ mode: "print", extra: { isProjectTrusted: () => true } });

		await commands.get("bytefly").handler("doctor refresh", ctx);
		await commands.get("bytefly").handler("plan refresh", ctx);

		expect(refreshes).toEqual([true, true]);
	});
});

describe("bytefly panel reload", () => {
	test("offers a reload after a change and reloads when confirmed", async () => {
		const store = makeStore({ global: { extensions: [] } });
		const built = makeDiscovery({ global: [item("/agent/extensions/one.ts")], globalStore: store }).discovery;
		const { pi, commands } = makeFakePi();
		registerPanel(pi, { doctor: fakeDoctor([]), discover: async () => built });

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
		registerPanel(pi, { doctor: fakeDoctor([]), discover: async () => built });

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
});
