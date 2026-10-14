import { describe, expect, test } from "bun:test";
import bytefly from "../index.ts";
import { makeDiscovery, makeItem, makeStore } from "../../../test/helpers/fixtures/picker.ts";
import { fakeCtx } from "../../../test/helpers/context.ts";
import { fakeTheme, makeFakePi } from "../../../test/helpers/fakes.ts";
import { withEnv } from "../../../test/helpers/env.ts";
import { ENV_DISABLED_EXTENSIONS } from "../../../lib/env.ts";

const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const item = (path: string) => makeItem({ path });

function discovery() {
	return makeDiscovery({ global: [item("/agent/extensions/one.ts")] }).discovery;
}

describe("bytefly extensions picker", () => {
	test("registers nothing when disabled through PI_DISABLED_EXTENSIONS", async () => {
		await withEnv({ [ENV_DISABLED_EXTENSIONS]: "bytefly" }, () => {
			const { pi, commands } = makeFakePi();
			bytefly(pi);
			expect(commands.size).toBe(0);
		});
	});

	test("registers the /extensions command alongside /bytefly", () => {
		const { pi, commands } = makeFakePi();
		bytefly(pi);
		expect(commands.has("extensions")).toBe(true);
		expect(commands.has("bytefly")).toBe(true);
	});

	test("prints a listing outside TUI mode", async () => {
		const { pi, commands } = makeFakePi();
		bytefly(pi, { extensions: { discover: async () => discovery() } });
		const { ctx, notifications } = fakeCtx({ mode: "print", extra: { isProjectTrusted: () => true } });

		await commands.get("extensions").handler("", ctx);

		expect(notifications.at(-1)).toContain("[x] one.ts");
	});

	test("opens the dock screen in TUI mode", async () => {
		const { pi, commands } = makeFakePi();
		bytefly(pi, { extensions: { discover: async () => discovery() } });
		const { ctx, customCalls } = fakeCtx({ mode: "tui", extra: { isProjectTrusted: () => true } });

		await commands.get("extensions").handler("", ctx);

		expect(customCalls).toHaveLength(1);
	});

	test("offers a reload after a change and reloads when confirmed", async () => {
		const store = makeStore({ global: { extensions: [] } });
		const built = makeDiscovery({ global: [item("/agent/extensions/one.ts")], globalStore: store }).discovery;
		const { pi, commands } = makeFakePi();
		bytefly(pi, { extensions: { discover: async () => built } });

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

		await commands.get("extensions").handler("", ctx);

		expect(reloaded).toBe(1);
	});

	test("ignores the retired extension-picker disable name", async () => {
		await withEnv({ [ENV_DISABLED_EXTENSIONS]: "extension-picker" }, () => {
			const { pi, commands } = makeFakePi();
			bytefly(pi);
			expect(commands.has("extensions")).toBe(true);
		});
	});
});
