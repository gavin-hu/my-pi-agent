import { describe, expect, test } from "bun:test";
import statusBar from "./index.ts";
import { coloringTheme, emit } from "../../test/helpers/fakes.ts";
import { withEnv } from "../../test/helpers/env.ts";
import { ENV_DISABLED_EXTENSIONS } from "../../lib/env.ts";
import { fakeFooterCtx, makeFakePi, renderFooter } from "../../test/helpers/fixtures/status-bar.ts";

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
});
