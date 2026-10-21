import { describe, expect, test } from "bun:test";
import { ENV_DISABLED_EXTENSIONS } from "../../lib/env.ts";
import { NOTICE_TYPE } from "../../lib/notice.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { withEnv } from "../../test/helpers/env.ts";
import { emit, fakeTheme } from "../../test/helpers/fakes.ts";
import { bootBytefly, fakeFooterCtx, makeFakePi, OFFLINE_UPDATE } from "../../test/helpers/fixtures/bytefly.ts";
import { makeDiscovery, makeItem } from "../../test/helpers/fixtures/picker.ts";

describe("bytefly extension registration", () => {
	test("registers nothing when disabled through PI_DISABLED_EXTENSIONS", async () => {
		await withEnv({ [ENV_DISABLED_EXTENSIONS]: "bytefly" }, () => {
			const { pi, tools, commands, handlers, markdownTransformers, messageRenderers, toolRenderers } = makeFakePi();
			bootBytefly(pi);
			expect(tools.size).toBe(0);
			expect(commands.size).toBe(0);
			expect(handlers.size).toBe(0);
			expect(markdownTransformers).toHaveLength(0);
			expect(messageRenderers.size).toBe(0);
			expect(toolRenderers).toHaveLength(0);
		});
	});

	test("registers one /bytefly command and no retired aliases", () => {
		const { pi, commands } = makeFakePi();
		bootBytefly(pi);
		expect(commands.has("bytefly")).toBe(true);
		expect(commands.has("extensions")).toBe(false);
		expect(commands.has("doctor")).toBe(false);
	});

	test("completes extension names, not the retired chrome toggles", () => {
		const { pi, commands } = makeFakePi();
		bootBytefly(pi);
		const labels = commands
			.get("bytefly")
			.getArgumentCompletions("")
			.map((item: any) => item.label);

		expect(labels).toContain("refresh");
		expect(labels).not.toContain("header");
		expect(labels).not.toContain("footer");
		expect(labels).not.toContain("status");
	});

	test("registers the doctor surface's read-only tool", () => {
		const { pi, tools, commands } = makeFakePi();
		bootBytefly(pi);
		const tool = tools.get("run_doctor");
		expect(tool?.annotations.readOnlyHint).toBe(true);
		expect(commands.has("doctor")).toBe(false);
	});

	test("registers the notify capability's hooks", () => {
		const { pi, handlers } = makeFakePi();
		bootBytefly(pi);
		// `ui_prompt_start` is notify's own hook; the separator shares `agent_settled`.
		expect(handlers.has("ui_prompt_start")).toBe(true);
	});

	test("registers the user-message transformer", () => {
		const { pi, markdownTransformers } = makeFakePi();
		bootBytefly(pi);
		expect(markdownTransformers).toHaveLength(1);
	});

	test("registers the notice renderer", () => {
		const { pi, messageRenderers } = makeFakePi();
		bootBytefly(pi);
		expect(messageRenderers.has(NOTICE_TYPE)).toBe(true);
	});

	test("registers the tool-block resolver", () => {
		const { pi, toolRenderers } = makeFakePi();
		bootBytefly(pi);
		expect(toolRenderers).toHaveLength(1);
	});
});

describe("bytefly interactive surfaces", () => {
	test("drives the working line while the working row is up", async () => {
		const { pi } = makeFakePi();
		bootBytefly(pi);
		const { ctx, workingMessages } = fakeFooterCtx({ mode: "tui" });

		await emit(pi, "turn_start", {}, ctx);
		expect(workingMessages.at(-1)).toMatch(/^Working… \d+s$/);

		await emit(pi, "tool_execution_start", { toolCallId: "1", toolName: "read" }, ctx);
		expect(workingMessages.at(-1)).toMatch(/^read · 1 tool · \d+s$/);

		await emit(pi, "agent_end", {}, ctx);
		expect(workingMessages.at(-1)).toBeUndefined();
	});

	test("shares one output pad between the notice and the turn separator", () => {
		const { pi, messageRenderers, renderers } = makeFakePi();
		bootBytefly(pi);

		// A notice is handed Pi's pad; it insets by it and records it for the rest.
		const notice = messageRenderers.get(NOTICE_TYPE);
		const lines = notice(
			{ details: { source: "job", title: "done", items: [{ label: "j1", severity: "ok" }] } },
			{ expanded: false, outputPad: 3 },
			fakeTheme,
		).render(80);
		expect(lines[0]?.indexOf("job")).toBe(3);

		// Pi hands an entry renderer no pad, so the separator follows the observed 3.
		const separator = renderers.get("bytefly-separator");
		const rule = separator({ data: { turn: 1 } }, { expanded: false }, fakeTheme).render(60)[0] ?? "";
		expect(rule.startsWith(" ".repeat(3))).toBe(true);
		expect(rule.startsWith(" ".repeat(4))).toBe(false);
	});

	test("installs the footer on session start and restores it on shutdown", async () => {
		const { pi } = makeFakePi();
		bootBytefly(pi);
		const { ctx, footers } = fakeFooterCtx({ mode: "tui" });

		await emit(pi, "session_start", { reason: "startup" }, ctx);
		expect(footers).toHaveLength(1);
		expect(typeof footers[0]).toBe("function");

		await emit(pi, "session_shutdown", {}, ctx);
		expect(footers.at(-1)).toBeUndefined();
	});

	test("installs the header only with the bytefly startup TUI, and restores it", async () => {
		const { pi } = makeFakePi({ settings: { quietStartup: true } });
		bootBytefly(pi);
		const { ctx, headers } = fakeFooterCtx({ mode: "tui" });

		await emit(pi, "session_start", { reason: "startup" }, ctx);
		expect(headers).toHaveLength(1);
		expect(typeof headers[0]).toBe("function");

		await emit(pi, "session_shutdown", {}, ctx);
		expect(headers.at(-1)).toBeUndefined();
	});

	test("does not install interactive chrome outside the tui mode", async () => {
		const { pi } = makeFakePi({ settings: { quietStartup: true } });
		bootBytefly(pi);
		const { ctx, footers, headers } = fakeFooterCtx({ mode: "print" });

		await emit(pi, "session_start", { reason: "startup" }, ctx);

		expect(footers).toHaveLength(0);
		expect(headers).toHaveLength(0);
	});
});

describe("bytefly command wiring", () => {
	test("reaches the update check from /bytefly update", async () => {
		const { pi, commands } = makeFakePi();
		// The injected list and version are what the command reports, so the wiring
		// is proven without a package-manager call or an agent-directory write.
		bootBytefly(pi, {
			update: {
				...OFFLINE_UPDATE,
				isOffline: () => false,
				readUpdates: async () => [
					{ source: "@gavin-hu/my-pi-agent", displayName: "@gavin-hu/my-pi-agent", type: "npm", scope: "user" },
				],
				fetchLatest: async () => "99.0.0",
			},
		});
		const { ctx, notifications } = fakeCtx({ mode: "print", extra: { isProjectTrusted: () => true } });
		await emit(pi, "session_start", {}, ctx);

		await commands.get("bytefly").handler("update", ctx);

		expect(notifications.at(-1)).toContain("1 package update available");
		expect(notifications.at(-1)).toContain("v99.0.0");
	});

	test("keeps the chrome installed when the panel runs", async () => {
		const { pi, commands } = makeFakePi({ settings: { quietStartup: true } });
		const discovery = makeDiscovery({ global: [makeItem({ path: "/agent/extensions/one.ts" })] }).discovery;
		bootBytefly(pi, { extensions: { discover: async () => discovery } });
		const { ctx, footers, headers } = fakeFooterCtx({ mode: "tui", trusted: true });

		await emit(pi, "session_start", { reason: "startup" }, ctx);
		expect(typeof headers.at(-1)).toBe("function");
		expect(typeof footers.at(-1)).toBe("function");

		// `header` is now an unknown extension name, not a toggle.
		await commands.get("bytefly").handler("header", ctx);

		expect(typeof headers.at(-1)).toBe("function");
		expect(typeof footers.at(-1)).toBe("function");
	});
});
