import { describe, expect, test } from "bun:test";
import { GLYPHS } from "../../lib/ui.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { withAgentDir } from "../../test/helpers/env.ts";
import { coloringTheme, createFakePi, emit } from "../../test/helpers/fakes.ts";
import wechat, { wechatChip } from "./index.ts";

describe("wechat extension", () => {
	test("registers the /wechat command", () => {
		const fake = createFakePi();
		wechat(fake.pi);
		expect(fake.commands.has("wechat")).toBe(true);
	});

	test("completes the wechat subcommands", () => {
		const fake = createFakePi();
		wechat(fake.pi);
		const complete = (prefix: string): string[] =>
			(fake.commands.get("wechat").getArgumentCompletions(prefix) ?? []).map((item: { label: string }) => item.label);
		expect(complete("")).toEqual(["login", "start", "stop", "status", "logout"]);
		expect(complete("st")).toEqual(["start", "stop", "status"]);
		expect(complete("start ")).toEqual([]);
	});

	test("registers the send_wechat tool", () => {
		const fake = createFakePi();
		wechat(fake.pi);
		expect(fake.tools.has("send_wechat")).toBe(true);
	});

	test("does not open the bridge on session_start", async () => {
		await withAgentDir(async () => {
			const fake = createFakePi();
			wechat(fake.pi);
			const { ctx, notifications } = fakeCtx();
			await emit(fake.pi, "session_start", { type: "session_start" }, ctx);
			await fake.commands.get("wechat").handler("status", ctx);
			expect(notifications.join("\n")).toContain("closed");
			await emit(fake.pi, "session_shutdown", { type: "session_shutdown" }, ctx);
		});
	});

	test("refuses to start outside tui and rpc modes", async () => {
		await withAgentDir(async () => {
			const fake = createFakePi();
			wechat(fake.pi);
			const { ctx, notifications } = fakeCtx({ mode: "json", hasUI: false });
			await fake.commands.get("wechat").handler("start", ctx);
			expect(notifications.join("\n").toLowerCase()).toContain("interactive or rpc");
		});
	});

	test("reports a failed start when not logged in", async () => {
		await withAgentDir(async () => {
			const fake = createFakePi();
			wechat(fake.pi);
			const { ctx, notifications } = fakeCtx();
			await fake.commands.get("wechat").handler("start", ctx);
			expect(notifications.join("\n")).toContain("Not logged in");
			await emit(fake.pi, "session_shutdown", { type: "session_shutdown" }, ctx);
		});
	});

	test("renders a chip for every bridge state, persistent for an expiry", () => {
		expect(wechatChip(coloringTheme, "running")).toBe(`[success]${GLYPHS.wechat} wechat`);
		expect(wechatChip(coloringTheme, "expired")).toBe(`[error]${GLYPHS.wechat} wechat expired`);
		expect(wechatChip(coloringTheme, "stopped")).toBeUndefined();
	});
});
