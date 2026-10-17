import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import bytefly from "./index.ts";
import { coloringTheme, emit, fakeTheme } from "../../test/helpers/fakes.ts";
import { withAgentDir, withEnv } from "../../test/helpers/env.ts";
import { ENV_DISABLED_EXTENSIONS } from "../../lib/env.ts";
import { NOTICE_TYPE } from "../../lib/notice.ts";
import { fakeFooterCtx, makeFakePi, renderFooter } from "../../test/helpers/fixtures/bytefly.ts";
import { makeDiscovery, makeItem } from "../../test/helpers/fixtures/picker.ts";

/** A million-token Opus call, so a configured rate lands on a round number. */
const millionTokens = (): unknown[] => [
	{
		type: "message",
		timestamp: "2026-01-05T03:00:00.000Z",
		message: {
			role: "assistant",
			provider: "anthropic",
			model: "opus-4.5",
			usage: { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } },
		},
	},
];

/** A price config for the fake session's model, in the given currency. */
const rateConfig = (symbol: string): string =>
	JSON.stringify({
		price: { currency: { symbol, decimals: 2 }, rates: { "anthropic/opus-4.5": { input: 2.5 } } },
	});

describe("bytefly extension", () => {
	test("registers nothing when disabled through PI_DISABLED_EXTENSIONS", async () => {
		await withEnv({ [ENV_DISABLED_EXTENSIONS]: "bytefly" }, () => {
			const { pi, tools, commands, handlers, markdownTransformers, messageRenderers, toolRenderers } = makeFakePi();
			bytefly(pi);
			expect(tools.size).toBe(0);
			expect(commands.size).toBe(0);
			expect(handlers.size).toBe(0);
			expect(markdownTransformers).toHaveLength(0);
			expect(messageRenderers.size).toBe(0);
			expect(toolRenderers).toHaveLength(0);
		});
	});

	test("registers the /bytefly command", () => {
		const { pi, commands } = makeFakePi();
		bytefly(pi);
		expect(commands.has("bytefly")).toBe(true);
	});

	test("registers the doctor surface", () => {
		const { pi, tools, commands } = makeFakePi();
		bytefly(pi);
		const tool = tools.get("run_doctor");
		expect(tool?.annotations.readOnlyHint).toBe(true);
		expect(commands.has("bytefly")).toBe(true);
		expect(commands.has("doctor")).toBe(false);
	});

	test("registers the notify capability", () => {
		const { pi, handlers } = makeFakePi();
		bytefly(pi);
		// `ui_prompt_start` is notify's own hook; the separator shares `agent_settled`.
		expect(handlers.has("ui_prompt_start")).toBe(true);
	});

	test("registers the user-message transformer", () => {
		const { pi, markdownTransformers } = makeFakePi();
		bytefly(pi);
		expect(markdownTransformers).toHaveLength(1);
	});

	test("drives the working timer while the working row is up", async () => {
		const { pi } = makeFakePi();
		bytefly(pi);
		const { ctx, workingMessages } = fakeFooterCtx({ mode: "tui" });

		await emit(pi, "turn_start", {}, ctx);
		expect(workingMessages.at(-1)).toMatch(/^Working… \d+s$/);

		await emit(pi, "agent_end", {}, ctx);
		expect(workingMessages.at(-1)).toBeUndefined();
	});

	test("registers the notice renderer", () => {
		const { pi, messageRenderers } = makeFakePi();
		bytefly(pi);
		expect(messageRenderers.has(NOTICE_TYPE)).toBe(true);
	});

	test("shares one output pad between the notice and the turn separator", () => {
		const { pi, messageRenderers, renderers } = makeFakePi();
		bytefly(pi);

		// A notice is handed Pi's pad; it insets by it and records it for the rest.
		const notice = messageRenderers.get(NOTICE_TYPE);
		const lines = notice(
			{ details: { source: "job", title: "done", items: [{ label: "j1", severity: "ok" }] } },
			{ expanded: false, outputPad: 3 },
			fakeTheme,
		).render(80);
		expect(lines[0]?.startsWith("   job")).toBe(true);

		// Pi hands an entry renderer no pad, so the separator follows the observed 3.
		const separator = renderers.get("bytefly-separator");
		const rule = separator({ data: { turn: 1 } }, { expanded: false }, fakeTheme).render(60)[0] ?? "";
		expect(rule.startsWith("   ")).toBe(true);
		expect(rule.startsWith("    ")).toBe(false);
	});

	test("registers the tool-block resolver", () => {
		const { pi, toolRenderers } = makeFakePi();
		bytefly(pi);
		expect(toolRenderers).toHaveLength(1);
	});

	test("installs the footer on session start in interactive mode", async () => {
		const { pi } = makeFakePi();
		bytefly(pi);
		const { ctx, footers } = fakeFooterCtx({ mode: "tui" });

		await emit(pi, "session_start", { reason: "startup" }, ctx);

		expect(footers).toHaveLength(1);
		expect(typeof footers[0]).toBe("function");
	});

	test("does not install the footer outside interactive mode", async () => {
		const { pi } = makeFakePi();
		bytefly(pi);
		const { ctx, footers } = fakeFooterCtx({ mode: "print" });

		await emit(pi, "session_start", { reason: "startup" }, ctx);

		expect(footers).toHaveLength(0);
	});

	test("installs the header on session start in interactive mode", async () => {
		const { pi } = makeFakePi({ settings: { quietStartup: true } });
		bytefly(pi);
		const { ctx, headers } = fakeFooterCtx({ mode: "tui" });

		await emit(pi, "session_start", { reason: "startup" }, ctx);

		expect(headers).toHaveLength(1);
		expect(typeof headers[0]).toBe("function");
	});

	test("does not install the header outside interactive mode", async () => {
		const { pi } = makeFakePi({ settings: { quietStartup: true } });
		bytefly(pi);
		const { ctx, headers } = fakeFooterCtx({ mode: "print" });

		await emit(pi, "session_start", { reason: "startup" }, ctx);

		expect(headers).toHaveLength(0);
	});

	test("restores the built-in header on shutdown", async () => {
		const { pi } = makeFakePi();
		bytefly(pi);
		const { ctx, headers } = fakeFooterCtx({ mode: "tui" });

		await emit(pi, "session_shutdown", {}, ctx);

		expect(headers.at(-1)).toBeUndefined();
	});

	test("renders the nameplate through the installed header factory", async () => {
		const { pi } = makeFakePi({ settings: { quietStartup: true } });
		bytefly(pi);
		const { ctx, headers } = fakeFooterCtx({ mode: "tui" });

		await emit(pi, "session_start", { reason: "startup" }, ctx);
		const component = headers.at(-1)({ requestRender: () => {} }, fakeTheme);
		const lines = component.render(80);

		expect(lines).toHaveLength(6);
		expect(lines[0]).toContain("Pi v");
		expect(lines[1]).toContain("enhanced by bytefly");
	});

	test("places the header on Pi's output pad", async () => {
		for (const [outputPad, margin, help] of [
			[undefined, 1, 3],
			[0, 0, 2],
		] as const) {
			const { pi } = makeFakePi({ settings: { quietStartup: true, outputPad } });
			bytefly(pi);
			const { ctx, headers } = fakeFooterCtx({ mode: "tui" });
			await emit(pi, "session_start", { reason: "startup" }, ctx);
			const lines = headers
				.at(-1)({ requestRender: () => {} }, fakeTheme)
				.render(80);

			expect(lines[0]?.startsWith(`${" ".repeat(margin)}█▀█`)).toBe(true);
			// The raw `/` hints need no keybinding, so the row is stable in a bare test.
			expect(lines[5]?.startsWith(`${" ".repeat(help)}/`)).toBe(true);
		}
	});

	test("restores the built-in footer on shutdown", async () => {
		const { pi } = makeFakePi();
		bytefly(pi);
		const { ctx, footers } = fakeFooterCtx({ mode: "tui" });

		await emit(pi, "session_shutdown", {}, ctx);

		expect(footers.at(-1)).toBeUndefined();
	});

	test("registers one /bytefly command", () => {
		const { pi, commands } = makeFakePi();
		bytefly(pi);
		expect(commands.has("bytefly")).toBe(true);
		expect(commands.has("extensions")).toBe(false);
		expect(commands.has("doctor")).toBe(false);
	});

	test("completes extension names, not the retired chrome toggles", () => {
		const { pi, commands } = makeFakePi();
		bytefly(pi);
		const values = commands
			.get("bytefly")
			.getArgumentCompletions("")
			.map((item: any) => item.value);

		expect(values).toContain("refresh");
		expect(values).not.toContain("header");
		expect(values).not.toContain("footer");
		expect(values).not.toContain("status");
	});

	test("keeps the chrome installed when the panel runs", async () => {
		const { pi, commands } = makeFakePi({ settings: { quietStartup: true } });
		const discovery = makeDiscovery({ global: [makeItem({ path: "/agent/extensions/one.ts" })] }).discovery;
		bytefly(pi, { extensions: { discover: async () => discovery } });
		const { ctx, footers, headers } = fakeFooterCtx({ mode: "tui", trusted: true });

		await emit(pi, "session_start", { reason: "startup" }, ctx);
		expect(typeof headers.at(-1)).toBe("function");
		expect(typeof footers.at(-1)).toBe("function");

		// `header` is now an unknown extension name, not a toggle.
		await commands.get("bytefly").handler("header", ctx);

		expect(typeof headers.at(-1)).toBe("function");
		expect(typeof footers.at(-1)).toBe("function");
	});

	test("renders two footer lines through the installed factory", async () => {
		const { pi } = makeFakePi();
		bytefly(pi);
		const { ctx, footerData, footers } = fakeFooterCtx({ mode: "tui", context: undefined });
		await emit(pi, "session_start", { reason: "startup" }, ctx);

		const lines = renderFooter(footers.at(-1), footerData, 100);

		expect(lines).toHaveLength(2);
		expect(lines[0]).toContain("⎇ main");
		expect(lines.join("\n")).toContain("opus-4.5");
	});

	test("reads the live theme on every render", async () => {
		const { pi } = makeFakePi();
		bytefly(pi);
		const { ctx, footerData, footers } = fakeFooterCtx({ mode: "tui" });
		await emit(pi, "session_start", { reason: "startup" }, ctx);

		const factory = footers.at(-1);
		ctx.ui.theme = coloringTheme;
		const lines = renderFooter(factory, footerData, 100);

		expect(lines[0]).toContain("[");
	});

	test("prices the cost from a bytefly.json rate", async () => {
		const { pi } = makeFakePi();
		bytefly(pi);
		const { ctx, footerData, footers } = fakeFooterCtx({ mode: "tui", entries: millionTokens(), context: undefined });

		await withAgentDir(async (agentDir) => {
			writeFileSync(join(agentDir, "bytefly.json"), rateConfig("¥"));
			await emit(pi, "session_start", { reason: "startup" }, ctx);
		});

		expect(renderFooter(footers.at(-1), footerData, 100)[1]).toContain("¥2.50");
	});
});
