import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import statusBar from "./index.ts";
import { coloringTheme, emit } from "../../test/helpers/fakes.ts";
import { withAgentDir, withEnv } from "../../test/helpers/env.ts";
import { ENV_DISABLED_EXTENSIONS } from "../../lib/env.ts";
import { fakeFooterCtx, makeFakePi, renderFooter } from "../../test/helpers/fixtures/status-bar.ts";

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
	JSON.stringify({ currency: { symbol, decimals: 2 }, rates: { "anthropic/opus-4.5": { input: 2.5 } } });

describe("status-bar extension", () => {
	test("registers nothing when disabled through PI_DISABLED_EXTENSIONS", async () => {
		await withEnv({ [ENV_DISABLED_EXTENSIONS]: "status-bar" }, () => {
			const { pi, commands, handlers } = makeFakePi();
			statusBar(pi);
			expect(commands.size).toBe(0);
			expect(handlers.size).toBe(0);
		});
	});

	test("registers the /status-bar command", () => {
		const { pi, commands } = makeFakePi();
		statusBar(pi);
		expect(commands.has("status-bar")).toBe(true);
	});

	test("installs the footer on session start in interactive mode", async () => {
		const { pi } = makeFakePi();
		statusBar(pi);
		const { ctx, footers } = fakeFooterCtx({ mode: "tui" });

		await emit(pi, "session_start", { reason: "startup" }, ctx);

		expect(footers).toHaveLength(1);
		expect(typeof footers[0]).toBe("function");
	});

	test("does not touch the footer outside interactive mode", async () => {
		const { pi } = makeFakePi();
		statusBar(pi);
		const { ctx, footers } = fakeFooterCtx({ mode: "print" });

		await emit(pi, "session_start", { reason: "startup" }, ctx);

		expect(footers).toHaveLength(0);
	});

	test("restores the built-in footer on shutdown", async () => {
		const { pi } = makeFakePi();
		statusBar(pi);
		const { ctx, footers } = fakeFooterCtx({ mode: "tui" });

		await emit(pi, "session_shutdown", {}, ctx);

		expect(footers.at(-1)).toBeUndefined();
	});

	test("does nothing when toggled outside interactive mode", async () => {
		const { pi, commands } = makeFakePi();
		statusBar(pi);
		const { ctx, footers, notifications } = fakeFooterCtx({ mode: "print" });
		const command = commands.get("status-bar");

		await command.handler("", ctx);

		expect(footers).toHaveLength(0);
		expect(notifications).toHaveLength(0);
	});

	test("toggles between the bar and the built-in footer", async () => {
		const { pi, commands } = makeFakePi();
		statusBar(pi);
		const { ctx, footers, notifications } = fakeFooterCtx({ mode: "tui" });
		const command = commands.get("status-bar");

		await emit(pi, "session_start", { reason: "startup" }, ctx);
		await command.handler("", ctx);
		expect(footers.at(-1)).toBeUndefined();
		expect(notifications.at(-1)).toBe("Status bar disabled");

		await command.handler("", ctx);
		expect(typeof footers.at(-1)).toBe("function");
		expect(notifications.at(-1)).toBe("Status bar enabled");
	});

	test("renders two lines through the installed factory", async () => {
		const { pi } = makeFakePi();
		statusBar(pi);
		const { ctx, footerData, footers } = fakeFooterCtx({ mode: "tui", context: undefined });
		await emit(pi, "session_start", { reason: "startup" }, ctx);

		const lines = renderFooter(footers.at(-1), footerData, 100);

		expect(lines).toHaveLength(2);
		expect(lines[0]).toContain("⎇ main");
		expect(lines.join("\n")).toContain("opus-4.5");
	});

	test("reads the live theme on every render", async () => {
		const { pi } = makeFakePi();
		statusBar(pi);
		const { ctx, footerData, footers } = fakeFooterCtx({ mode: "tui" });
		await emit(pi, "session_start", { reason: "startup" }, ctx);

		const factory = footers.at(-1);
		ctx.ui.theme = coloringTheme;
		const lines = renderFooter(factory, footerData, 100);

		expect(lines[0]).toContain("[");
	});

	test("prices the cost from a status-bar.json rate", async () => {
		const { pi } = makeFakePi();
		statusBar(pi);
		const { ctx, footerData, footers } = fakeFooterCtx({ mode: "tui", entries: millionTokens(), context: undefined });

		await withAgentDir(async (agentDir) => {
			writeFileSync(join(agentDir, "status-bar.json"), rateConfig("¥"));
			await emit(pi, "session_start", { reason: "startup" }, ctx);
		});

		expect(renderFooter(footers.at(-1), footerData, 100)[1]).toContain("¥2.50");
	});

	test("re-reads the config when the bar is toggled back on", async () => {
		const { pi, commands } = makeFakePi();
		statusBar(pi);
		const { ctx, footerData, footers } = fakeFooterCtx({ mode: "tui", entries: millionTokens(), context: undefined });
		const command = commands.get("status-bar");

		await withAgentDir(async (agentDir) => {
			const path = join(agentDir, "status-bar.json");
			writeFileSync(path, rateConfig("$"));
			await emit(pi, "session_start", { reason: "startup" }, ctx);
			expect(renderFooter(footers.at(-1), footerData, 100)[1]).toContain("$2.50");

			await command.handler("", ctx);
			writeFileSync(path, rateConfig("¥"));
			await command.handler("", ctx);
			expect(renderFooter(footers.at(-1), footerData, 100)[1]).toContain("¥2.50");
		});
	});
});
