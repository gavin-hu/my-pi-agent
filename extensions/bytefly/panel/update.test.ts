/**
 * The update surfaces `/bytefly` drives: the update check and the upgrade it
 * applies, both through the bytefly factory.
 */

import { describe, expect, test } from "bun:test";
import pkg from "../../../package.json";
import { fakeCtx } from "../../../test/helpers/context.ts";
import { makeFakePi } from "../../../test/helpers/fakes.ts";
import { bootPanel, commandDiscovery, fakeDoctor, fakeUpdate } from "../../../test/helpers/fixtures/panel.ts";
import { fakeSettings } from "../../../test/helpers/fixtures/settings.ts";
import { registerPanel } from "./commands.ts";
import type { UpdateOutcome } from "../update/state.ts";

describe("bytefly update command", () => {
	async function runUpdate(outcome: UpdateOutcome, mode = "print") {
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

	test("reports an available package list with its release URL, resolving nothing", async () => {
		const { checks, notifications } = await runUpdate({
			kind: "available",
			updates: [{ source: "@gavin-hu/my-pi-agent", displayName: "@gavin-hu/my-pi-agent", type: "npm", scope: "user" }],
			ownLatest: "99.0.0",
		});

		expect(checks).toEqual([1]);
		expect(notifications.at(-1)).toContain("1 package update available");
		expect(notifications.at(-1)).toContain(`v${pkg.version} → v99.0.0`);
		expect(notifications.at(-1)).toContain("https://github.com/gavin-hu/my-pi-agent/releases/tag/v99.0.0");
	});

	test("reports an up-to-date session", async () => {
		const { notifications } = await runUpdate({ kind: "current" });
		expect(notifications.at(-1)).toContain("up to date");
	});

	test("reports a failed read as a warning", async () => {
		const { notifications } = await runUpdate({ kind: "failed" });
		expect(notifications.at(-1)).toContain("could not check package updates");
	});

	test("reports a skip when offline", async () => {
		const { notifications } = await runUpdate({ kind: "offline" });
		expect(notifications.at(-1)).toContain("PI_OFFLINE");
	});

	test("accepts a stray refresh token and re-checks once", async () => {
		const checks: number[] = [];
		const { pi, commands } = makeFakePi();
		registerPanel(pi, {
			doctor: fakeDoctor([]),
			update: fakeUpdate({ kind: "current" }, checks),
			discover: async () => commandDiscovery(),
			settings: () => fakeSettings(),
		});
		const { ctx } = fakeCtx({ mode: "print", extra: { isProjectTrusted: () => true } });

		await commands.get("bytefly").handler("update refresh", ctx);

		expect(checks).toEqual([1]);
	});

	test("takes no second token and is offered first", () => {
		const { commands } = bootPanel({});

		expect(commands.get("bytefly").getArgumentCompletions("update ")).toBeNull();
		const first = (commands.get("bytefly").getArgumentCompletions("") ?? []).map(
			(entry: { label: string }) => entry.label,
		);
		expect(first).toContain("update");
	});
});

describe("bytefly upgrade command", () => {
	async function runUpgrade(confirm: boolean) {
		const applies: number[] = [];
		const { pi, commands } = makeFakePi();
		registerPanel(pi, {
			doctor: fakeDoctor([]),
			update: {
				recheck: async () => ({ kind: "current" }),
				apply: async (): Promise<UpdateOutcome> => {
					applies.push(1);
					return { kind: "updated", pending: false };
				},
			},
			discover: async () => {
				throw new Error("should not resolve extensions");
			},
			settings: () => fakeSettings(),
		});
		const { ctx, notifications, confirms } = fakeCtx({ mode: "tui", confirm, extra: { isProjectTrusted: () => true } });
		await commands.get("bytefly").handler("upgrade", ctx);
		return { applies, notifications, confirms };
	}

	test("asks first, then prints what the update did", async () => {
		const { applies, notifications, confirms } = await runUpgrade(true);
		expect(confirms).toHaveLength(1);
		expect(confirms[0].title).toContain("Update packages?");
		expect(applies).toEqual([1]);
		expect(notifications.at(-1)).toContain("reload");
	});

	test("writes nothing when the confirmation is declined", async () => {
		const { applies, notifications, confirms } = await runUpgrade(false);
		expect(confirms).toHaveLength(1);
		expect(applies).toEqual([]);
		expect(notifications.at(-1)).toContain("cancelled");
	});

	test("is offered as a first token and takes no second one", () => {
		const { commands } = bootPanel({});
		expect(commands.get("bytefly").getArgumentCompletions("upg")).toEqual([{ value: "upgrade ", label: "upgrade" }]);
		expect(commands.get("bytefly").getArgumentCompletions("upgrade ")).toBeNull();
	});
});
