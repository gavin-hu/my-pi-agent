/**
 * The `/bytefly` command's follow-up actions on a live screen: a forced
 * re-probe, the doctor reports behind a verb, and the reload the screen asks for
 * through its own seam, or the command offers on close.
 *
 * The command itself is `commands.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { fakeCtx } from "../../../test/helpers/context.ts";
import { fakeTheme, makeFakePi } from "../../../test/helpers/fakes.ts";
import { bootPanel, commandDiscovery, fakeDoctor, fakeUpdate, pathRow } from "../../../test/helpers/fixtures/panel.ts";
import { fakeSettings } from "../../../test/helpers/fixtures/settings.ts";
import { makeReport } from "../../../test/helpers/fixtures/doctor.ts";
import { makeDiscovery, makeStore } from "../../../test/helpers/fixtures/picker.ts";
import { settle } from "../../../test/helpers/process.ts";
import { registerPanel } from "./commands.ts";

/** The host's custom-UI factory, narrowed to what these tests drive. */
type ScreenFactory = (
	tui: { requestRender: () => void; terminal: { rows: number } },
	theme: typeof fakeTheme,
	keybindings: Record<string, never>,
	done: (result?: void) => void,
) => { render: (width: number) => string[]; handleInput: (data: string) => void };

describe("bytefly panel refresh", () => {
	test("re-probes when refresh is asked for", async () => {
		const refreshes: boolean[] = [];
		const { pi, commands } = makeFakePi();
		registerPanel(pi, {
			doctor: fakeDoctor([makeReport("plan")], refreshes),
			update: fakeUpdate(),
			discover: async () => commandDiscovery(),
			settings: () => fakeSettings(),
		});
		const { ctx } = fakeCtx({ mode: "print", extra: { isProjectTrusted: () => true } });

		await commands.get("bytefly").handler("doctor refresh", ctx);
		await commands.get("bytefly").handler("plan refresh", ctx);

		expect(refreshes).toEqual([true, true]);
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
			discover: async () => commandDiscovery(),
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
			discover: async () => commandDiscovery(),
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
			discover: async () => commandDiscovery(),
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
			discover: async () => commandDiscovery(),
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

		expect(component.render(80).join("\n")).toContain("Could not refresh: probe exploded");
		expect(notifications).toEqual([]);
	});

	test("shows a runtime toggle failure in the frame", async () => {
		const store = makeStore({ global: { extensions: [] } });
		store.failFlush(new Error("settings locked"));
		const built = makeDiscovery({
			extensions: [pathRow("/agent/extensions/one.ts")],
			globalStore: store,
		}).discovery;
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
		component.render(80);
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
			discover: async () => commandDiscovery(),
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
			discover: async () => commandDiscovery(),
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
	test("reloads through the screen seam after a change and a confirmation", async () => {
		const store = makeStore({ global: { extensions: [] } });
		const built = makeDiscovery({
			extensions: [pathRow("/agent/extensions/one.ts")],
			globalStore: store,
		}).discovery;
		const { pi, commands } = makeFakePi();
		registerPanel(pi, {
			doctor: fakeDoctor([]),
			update: fakeUpdate(),
			discover: async () => built,
			settings: () => fakeSettings(),
		});

		let reloaded = 0;
		const { ctx, confirms } = fakeCtx({
			mode: "tui",
			confirm: true,
			extra: {
				isProjectTrusted: () => true,
				reload: async () => {
					reloaded += 1;
				},
			},
		});
		ctx.ui.custom = async (factory: ScreenFactory) => {
			const component = factory({ requestRender: () => {}, terminal: { rows: 40 } }, fakeTheme, {}, () => {});
			component.render(80);
			component.handleInput(" ");
			await settle();
			await settle();
			component.handleInput("R");
			await settle();
			// The press goes through the screen's own seam: one confirm, one reload.
			expect(confirms).toHaveLength(1);
			expect(confirms[0].title).toContain("Reload to apply changes?");
			expect(reloaded).toBe(1);
			return undefined;
		};

		await commands.get("bytefly").handler("", ctx);
	});

	test("says there is nothing to apply when R is pressed with no changes", async () => {
		const { pi, commands } = makeFakePi();
		registerPanel(pi, {
			doctor: fakeDoctor([]),
			update: fakeUpdate(),
			discover: async () => commandDiscovery(),
			settings: () => fakeSettings(),
		});

		let reloaded = 0;
		const { ctx, confirms } = fakeCtx({
			mode: "tui",
			confirm: true,
			extra: {
				isProjectTrusted: () => true,
				reload: async () => {
					reloaded += 1;
				},
			},
		});
		ctx.ui.custom = async (factory: ScreenFactory) => {
			const component = factory({ requestRender: () => {}, terminal: { rows: 40 } }, fakeTheme, {}, () => {});
			component.render(80);
			component.handleInput("R");
			expect(component.render(80).join("\n")).toContain("Nothing to apply; change something first.");
			return undefined;
		};

		await commands.get("bytefly").handler("", ctx);

		expect(confirms).toHaveLength(0);
		expect(reloaded).toBe(0);
	});

	test("does not offer a reload when nothing changed", async () => {
		const store = makeStore({ global: { extensions: [] } });
		const built = makeDiscovery({
			extensions: [pathRow("/agent/extensions/one.ts")],
			globalStore: store,
		}).discovery;
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
		const { commands } = bootPanel({ settings: () => fakeSettings({ dirty: true }) });

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
