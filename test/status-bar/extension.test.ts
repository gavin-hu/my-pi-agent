import { describe, expect, test } from "bun:test";
import statusBar from "../../extensions/status-bar/index.ts";
import { emit, fakeFooterCtx, fakeTheme, makeFakePi, renderFooter } from "./helpers.ts";

describe("status-bar extension", () => {
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

	test("toggles between the bar and the built-in footer", async () => {
		const { pi, commands } = makeFakePi();
		statusBar(pi);
		const { ctx, footers, notifications } = fakeFooterCtx({ mode: "tui" });
		const command = commands.get("status-bar");

		await emit(pi, "session_start", { reason: "startup" }, ctx);
		await command.handler("", ctx);
		expect(footers.at(-1)).toBeUndefined();
		expect(notifications.at(-1)).toBe("Built-in footer restored");

		await command.handler("", ctx);
		expect(typeof footers.at(-1)).toBe("function");
		expect(notifications.at(-1)).toBe("Status bar on");
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
		ctx.ui.theme = { fg: (_color: string, text: string) => `[${text}]`, bold: (text: string) => text };
		const lines = renderFooter(factory, footerData, 100);

		expect(lines[0]).toContain("[");
	});

	test("does not show an auto indicator", async () => {
		const { pi } = makeFakePi();
		statusBar(pi);
		const { ctx, footerData, footers } = fakeFooterCtx({ mode: "tui" });
		await emit(pi, "session_start", { reason: "startup" }, ctx);

		const lines = renderFooter(footers.at(-1), footerData, 100);

		expect(lines[1]).not.toContain("auto");
	});
});

describe("status-bar theme double", () => {
	test("keeps text assertable", () => {
		expect(fakeTheme.fg("accent", "x")).toBe("x");
	});
});
