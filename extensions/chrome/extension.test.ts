import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import chrome from "./index.ts";
import { coloringTheme, emit } from "../../test/helpers/fakes.ts";
import { withAgentDir, withEnv } from "../../test/helpers/env.ts";
import { ENV_DISABLED_EXTENSIONS } from "../../lib/env.ts";
import { fakeFooterCtx, fakeTheme, makeFakePi, renderFooter } from "../../test/helpers/fixtures/chrome.ts";

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

describe("chrome extension", () => {
	test("registers nothing when disabled through PI_DISABLED_EXTENSIONS", async () => {
		await withEnv({ [ENV_DISABLED_EXTENSIONS]: "chrome" }, () => {
			const { pi, commands, handlers } = makeFakePi();
			chrome(pi);
			expect(commands.size).toBe(0);
			expect(handlers.size).toBe(0);
		});
	});

	test("registers the /chrome command", () => {
		const { pi, commands } = makeFakePi();
		chrome(pi);
		expect(commands.has("chrome")).toBe(true);
	});

	test("installs the header and footer on session start in interactive mode", async () => {
		const { pi } = makeFakePi();
		chrome(pi);
		const { ctx, headers, footers } = fakeFooterCtx({ mode: "tui" });

		await emit(pi, "session_start", { reason: "startup" }, ctx);

		expect(headers).toHaveLength(1);
		expect(typeof headers[0]).toBe("function");
		expect(footers).toHaveLength(1);
		expect(typeof footers[0]).toBe("function");
	});

	test("does not touch the chrome outside interactive mode", async () => {
		const { pi } = makeFakePi();
		chrome(pi);
		const { ctx, headers, footers } = fakeFooterCtx({ mode: "print" });

		await emit(pi, "session_start", { reason: "startup" }, ctx);

		expect(headers).toHaveLength(0);
		expect(footers).toHaveLength(0);
	});

	test("renders a header component with no session or model data", async () => {
		const { pi } = makeFakePi();
		chrome(pi);
		const { ctx, headers } = fakeFooterCtx({ mode: "tui" });
		await emit(pi, "session_start", { reason: "startup" }, ctx);

		const lines =
			headers
				.at(-1)?.({ requestRender: () => {} }, fakeTheme)
				.render(80) ?? [];

		expect(lines[0]).toBe("");
		expect(lines.join("\n")).toContain("Pi");
		expect(lines.join("\n")).not.toContain("feature");
	});

	test("restores the built-in chrome on shutdown", async () => {
		const { pi } = makeFakePi();
		chrome(pi);
		const { ctx, headers, footers } = fakeFooterCtx({ mode: "tui" });

		await emit(pi, "session_shutdown", {}, ctx);

		expect(headers.at(-1)).toBeUndefined();
		expect(footers.at(-1)).toBeUndefined();
	});

	test("does nothing when toggled outside interactive mode", async () => {
		const { pi, commands } = makeFakePi();
		chrome(pi);
		const { ctx, headers, footers, notifications } = fakeFooterCtx({ mode: "print" });
		const command = commands.get("chrome");

		await command.handler("", ctx);

		expect(headers).toHaveLength(0);
		expect(footers).toHaveLength(0);
		expect(notifications).toHaveLength(0);
	});

	test("toggles every surface with no argument", async () => {
		const { pi, commands } = makeFakePi();
		chrome(pi);
		const { ctx, headers, footers, notifications } = fakeFooterCtx({ mode: "tui" });
		const command = commands.get("chrome");

		await emit(pi, "session_start", { reason: "startup" }, ctx);
		await command.handler("", ctx);
		expect(headers.at(-1)).toBeUndefined();
		expect(footers.at(-1)).toBeUndefined();
		expect(notifications.at(-1)).toBe("chrome off");

		await command.handler("", ctx);
		expect(typeof headers.at(-1)).toBe("function");
		expect(typeof footers.at(-1)).toBe("function");
		expect(notifications.at(-1)).toBe("chrome on");
	});

	test("toggles one surface with a subcommand", async () => {
		const { pi, commands } = makeFakePi();
		chrome(pi);
		const { ctx, headers, footers, notifications } = fakeFooterCtx({ mode: "tui" });
		const command = commands.get("chrome");

		await emit(pi, "session_start", { reason: "startup" }, ctx);
		await command.handler("footer", ctx);

		expect(typeof headers.at(-1)).toBe("function");
		expect(footers.at(-1)).toBeUndefined();
		expect(notifications.at(-1)).toBe("chrome footer off");
	});

	test("reports the active surfaces with the status subcommand", async () => {
		const { pi, commands } = makeFakePi();
		chrome(pi);
		const { ctx, notifications } = fakeFooterCtx({ mode: "tui" });
		const command = commands.get("chrome");

		await command.handler("status", ctx);

		expect(notifications.at(-1)).toBe("chrome: header, footer");
	});

	test("completes the subcommands", () => {
		const { pi, commands } = makeFakePi();
		chrome(pi);
		const command = commands.get("chrome");

		expect(command.getArgumentCompletions("").map((item: any) => item.value)).toEqual(["header", "footer", "status"]);
		expect(command.getArgumentCompletions("fo").map((item: any) => item.value)).toEqual(["footer"]);
		expect(command.getArgumentCompletions("zzz")).toBeNull();
	});

	test("renders two footer lines through the installed factory", async () => {
		const { pi } = makeFakePi();
		chrome(pi);
		const { ctx, footerData, footers } = fakeFooterCtx({ mode: "tui", context: undefined });
		await emit(pi, "session_start", { reason: "startup" }, ctx);

		const lines = renderFooter(footers.at(-1), footerData, 100);

		expect(lines).toHaveLength(2);
		expect(lines[0]).toContain("⎇ main");
		expect(lines.join("\n")).toContain("opus-4.5");
	});

	test("reads the live theme on every render", async () => {
		const { pi } = makeFakePi();
		chrome(pi);
		const { ctx, footerData, footers } = fakeFooterCtx({ mode: "tui" });
		await emit(pi, "session_start", { reason: "startup" }, ctx);

		const factory = footers.at(-1);
		ctx.ui.theme = coloringTheme;
		const lines = renderFooter(factory, footerData, 100);

		expect(lines[0]).toContain("[");
	});

	test("prices the cost from a chrome.json rate", async () => {
		const { pi } = makeFakePi();
		chrome(pi);
		const { ctx, footerData, footers } = fakeFooterCtx({ mode: "tui", entries: millionTokens(), context: undefined });

		await withAgentDir(async (agentDir) => {
			writeFileSync(join(agentDir, "chrome.json"), rateConfig("¥"));
			await emit(pi, "session_start", { reason: "startup" }, ctx);
		});

		expect(renderFooter(footers.at(-1), footerData, 100)[1]).toContain("¥2.50");
	});

	test("re-reads the config when the chrome is toggled back on", async () => {
		const { pi, commands } = makeFakePi();
		chrome(pi);
		const { ctx, footerData, footers } = fakeFooterCtx({ mode: "tui", entries: millionTokens(), context: undefined });
		const command = commands.get("chrome");

		await withAgentDir(async (agentDir) => {
			const path = join(agentDir, "chrome.json");
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
