import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import bytefly from "./index.ts";
import { coloringTheme, emit, fakeTheme } from "../../test/helpers/fakes.ts";
import { withAgentDir, withEnv } from "../../test/helpers/env.ts";
import { ENV_DISABLED_EXTENSIONS } from "../../lib/env.ts";
import { fakeFooterCtx, makeFakePi, renderFooter } from "../../test/helpers/fixtures/bytefly.ts";

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
			const { pi, tools, commands, handlers } = makeFakePi();
			bytefly(pi);
			expect(tools.size).toBe(0);
			expect(commands.size).toBe(0);
			expect(handlers.size).toBe(0);
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
		expect(commands.has("doctor")).toBe(true);
	});

	test("registers the notify capability", () => {
		const { pi, handlers } = makeFakePi();
		bytefly(pi);
		// `ui_prompt_start` is notify's own hook; the separator shares `agent_settled`.
		expect(handlers.has("ui_prompt_start")).toBe(true);
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
		const { pi } = makeFakePi();
		bytefly(pi);
		const { ctx, headers } = fakeFooterCtx({ mode: "tui" });

		await emit(pi, "session_start", { reason: "startup" }, ctx);

		expect(headers).toHaveLength(1);
		expect(typeof headers[0]).toBe("function");
	});

	test("does not install the header outside interactive mode", async () => {
		const { pi } = makeFakePi();
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

	test("renders the brand mark through the installed header factory", async () => {
		const { pi } = makeFakePi();
		bytefly(pi);
		const { ctx, headers } = fakeFooterCtx({ mode: "tui" });

		await emit(pi, "session_start", { reason: "startup" }, ctx);
		const component = headers.at(-1)({ requestRender: () => {} }, fakeTheme);
		const lines = component.render(80);

		expect(lines).toHaveLength(6);
		expect(lines[0]).toContain("Pi v");
		expect(lines[1]).toContain("enhanced by bytefly");
	});

	test("restores the built-in footer on shutdown", async () => {
		const { pi } = makeFakePi();
		bytefly(pi);
		const { ctx, footers } = fakeFooterCtx({ mode: "tui" });

		await emit(pi, "session_shutdown", {}, ctx);

		expect(footers.at(-1)).toBeUndefined();
	});

	test("does nothing when toggled outside interactive mode", async () => {
		const { pi, commands } = makeFakePi();
		bytefly(pi);
		const { ctx, footers, notifications } = fakeFooterCtx({ mode: "print" });
		const command = commands.get("bytefly");

		await command.handler("", ctx);

		expect(footers).toHaveLength(0);
		expect(notifications).toHaveLength(0);
	});

	test("toggles the whole chrome with no argument", async () => {
		const { pi, commands } = makeFakePi();
		bytefly(pi);
		const { ctx, footers, headers, notifications } = fakeFooterCtx({ mode: "tui" });
		const command = commands.get("bytefly");

		await emit(pi, "session_start", { reason: "startup" }, ctx);
		await command.handler("", ctx);
		expect(footers.at(-1)).toBeUndefined();
		expect(headers.at(-1)).toBeUndefined();
		expect(notifications.at(-1)).toBe("bytefly off");

		await command.handler("", ctx);
		expect(typeof footers.at(-1)).toBe("function");
		expect(typeof headers.at(-1)).toBe("function");
		expect(notifications.at(-1)).toBe("bytefly on");
	});

	test("toggles only the header with the header subcommand", async () => {
		const { pi, commands } = makeFakePi();
		bytefly(pi);
		const { ctx, footers, headers, notifications } = fakeFooterCtx({ mode: "tui" });
		const command = commands.get("bytefly");

		await emit(pi, "session_start", { reason: "startup" }, ctx);
		await command.handler("header", ctx);

		expect(headers.at(-1)).toBeUndefined();
		expect(typeof footers.at(-1)).toBe("function");
		expect(notifications.at(-1)).toBe("bytefly header off");
	});

	test("toggles only the footer with the footer subcommand", async () => {
		const { pi, commands } = makeFakePi();
		bytefly(pi);
		const { ctx, footers, headers, notifications } = fakeFooterCtx({ mode: "tui" });
		const command = commands.get("bytefly");

		await emit(pi, "session_start", { reason: "startup" }, ctx);
		await command.handler("footer", ctx);

		expect(footers.at(-1)).toBeUndefined();
		expect(typeof headers.at(-1)).toBe("function");
		expect(notifications.at(-1)).toBe("bytefly footer off");
	});

	test("reports the header and footer state with the status subcommand", async () => {
		const { pi, commands } = makeFakePi();
		bytefly(pi);
		const { ctx, notifications } = fakeFooterCtx({ mode: "tui" });
		const command = commands.get("bytefly");

		await command.handler("status", ctx);

		expect(notifications.at(-1)).toBe("bytefly: header on, footer on");
	});

	test("completes the subcommands", () => {
		const { pi, commands } = makeFakePi();
		bytefly(pi);
		const command = commands.get("bytefly");

		expect(command.getArgumentCompletions("").map((item: any) => item.value)).toEqual(["footer", "header", "status"]);
		expect(command.getArgumentCompletions("st").map((item: any) => item.value)).toEqual(["status"]);
		expect(command.getArgumentCompletions("h").map((item: any) => item.value)).toEqual(["header"]);
		expect(command.getArgumentCompletions("zzz")).toBeNull();
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

	test("re-reads the config when the footer is toggled back on", async () => {
		const { pi, commands } = makeFakePi();
		bytefly(pi);
		const { ctx, footerData, footers } = fakeFooterCtx({ mode: "tui", entries: millionTokens(), context: undefined });
		const command = commands.get("bytefly");

		await withAgentDir(async (agentDir) => {
			const path = join(agentDir, "bytefly.json");
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
