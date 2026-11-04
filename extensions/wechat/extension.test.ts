/**
 * The wechat extension's Pi registration: the gate, the command and tool it
 * registers, when the bridge module loads, and the status chip it publishes.
 *
 * The bridge lifecycle itself is `lifecycle.test.ts`: this suite never opens a
 * poller, so a registration regression is not buried in a network-free bridge run.
 */

import { describe, expect, test } from "bun:test";
import { ENV_DISABLED_EXTENSIONS } from "../../lib/env.ts";
import { GLYPHS } from "../../lib/tui/glyphs.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { withAgentDir, withEnv } from "../../test/helpers/env.ts";
import { coloringTheme, createFakePi, emit } from "../../test/helpers/fakes.ts";
import { writeAccount } from "../../test/helpers/fixtures/wechat.ts";
import wechat, { wechatChip } from "./index.ts";

describe("wechat registration", () => {
	test("registers the /wechat command and the send_wechat tool", () => {
		const fake = createFakePi();
		wechat(fake.pi);
		expect(fake.commands.has("wechat")).toBe(true);
		expect(fake.tools.has("send_wechat")).toBe(true);
	});

	test("loads the bridge only when a session starts it", async () => {
		await withAgentDir(async (dir) => {
			writeAccount(dir);
			let loads = 0;
			const fake = createFakePi();
			wechat(fake.pi, {
				loadBridge: () => {
					loads += 1;
					return import("./bridge.ts");
				},
			});
			const { ctx } = fakeCtx({ mode: "rpc" });
			// A stored account is not a start: the frame and a status read reach nothing.
			await emit(fake.pi, "session_start", { type: "session_start" }, ctx);
			await fake.commands.get("wechat").handler("status", ctx);
			expect(loads).toBe(0);
			await fake.commands.get("wechat").handler("start", ctx);
			expect(loads).toBe(1);
			await emit(fake.pi, "session_shutdown", { type: "session_shutdown" }, ctx);
		});
	});

	test("registers nothing when disabled through PI_DISABLED_EXTENSIONS", async () => {
		await withEnv({ [ENV_DISABLED_EXTENSIONS]: "wechat" }, () => {
			const fake = createFakePi();
			wechat(fake.pi);
			expect(fake.commands.size).toBe(0);
			expect(fake.tools.size).toBe(0);
			expect(fake.handlers.size).toBe(0);
		});
	});

	test("does not open the bridge when no account is stored", async () => {
		await withAgentDir(async () => {
			const fake = createFakePi();
			wechat(fake.pi);
			const { ctx, notifications } = fakeCtx({ mode: "rpc" });
			await emit(fake.pi, "session_start", { type: "session_start" }, ctx);
			await fake.commands.get("wechat").handler("status", ctx);
			expect(notifications.join("\n")).toContain("closed");
			await emit(fake.pi, "session_shutdown", { type: "session_shutdown" }, ctx);
		});
	});

	test("opens the status screen in the TUI", async () => {
		await withAgentDir(async () => {
			const fake = createFakePi();
			wechat(fake.pi);
			const { ctx, customCalls } = fakeCtx({ custom: "close" });
			await fake.commands.get("wechat").handler("status", ctx);
			expect(customCalls.length).toBe(1);
			await emit(fake.pi, "session_shutdown", { type: "session_shutdown" }, ctx);
		});
	});

	test("renders a chip for every bridge state, persistent for an expiry", () => {
		expect(wechatChip(coloringTheme, "running")).toBe(`[success]${GLYPHS.wechat} wechat`);
		expect(wechatChip(coloringTheme, "expired")).toBe(`[error]${GLYPHS.wechat} wechat expired`);
		expect(wechatChip(coloringTheme, "stopped")).toBeUndefined();
	});
});
