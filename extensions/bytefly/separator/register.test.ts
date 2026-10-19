import { describe, expect, test } from "bun:test";
import { ENV_DISABLED_EXTENSIONS } from "../../../lib/env.ts";
import { createPadStore } from "../pad.ts";
import { fakeCtx } from "../../../test/helpers/context.ts";
import { withEnv } from "../../../test/helpers/env.ts";
import { emit, fakeTheme } from "../../../test/helpers/fakes.ts";
import { bootBytefly, makeFakePi, separatorEntry } from "../../../test/helpers/fixtures/bytefly.ts";
import { registerTurnSeparator } from "./register.ts";

describe("bytefly turn separator", () => {
	test("registers the bytefly-separator renderer and not the retired one", () => {
		const { pi, renderers } = makeFakePi();
		bootBytefly(pi);
		expect(renderers.has("bytefly-separator")).toBe(true);
		expect(renderers.has("turn-separator")).toBe(false);
	});

	test("appends the next turn when the agent settles", async () => {
		const { pi, appended } = makeFakePi();
		bootBytefly(pi);

		await emit(pi, "agent_settled", { type: "agent_settled" }, fakeCtx({ branch: [] }).ctx);
		await emit(pi, "agent_settled", { type: "agent_settled" }, fakeCtx({ branch: [separatorEntry(1)] }).ctx);

		expect(appended).toEqual([
			{ customType: "bytefly-separator", data: { turn: 1 } },
			{ customType: "bytefly-separator", data: { turn: 2 } },
		]);
	});

	test("does not count the retired turn-separator entries", async () => {
		const { pi, appended } = makeFakePi();
		bootBytefly(pi);

		const legacy = { type: "custom", customType: "turn-separator", data: { turn: 9 } };
		await emit(pi, "agent_settled", { type: "agent_settled" }, fakeCtx({ branch: [legacy] }).ctx);

		expect(appended).toEqual([{ customType: "bytefly-separator", data: { turn: 1 } }]);
	});

	test("does nothing outside interactive mode", async () => {
		const { pi, appended } = makeFakePi();
		bootBytefly(pi);

		await emit(pi, "agent_settled", { type: "agent_settled" }, fakeCtx({ mode: "print" }).ctx);

		expect(appended).toHaveLength(0);
	});

	test("records the settled run's receipt", async () => {
		let time = 0;
		const { pi, appended } = makeFakePi();
		registerTurnSeparator(pi, createPadStore(), { now: () => time });
		const { ctx } = fakeCtx({ branch: [] });

		await emit(pi, "agent_start", { type: "agent_start" }, ctx);
		time = 5000;
		await emit(pi, "tool_execution_start", { toolCallId: "1", toolName: "read" }, ctx);
		await emit(pi, "tool_execution_start", { toolCallId: "2", toolName: "edit" }, ctx);
		await emit(pi, "tool_execution_end", { toolCallId: "2", toolName: "edit", isError: true }, ctx);
		await emit(pi, "agent_settled", { type: "agent_settled", aborted: false }, ctx);

		expect(appended).toEqual([
			{ customType: "bytefly-separator", data: { turn: 1, durationMs: 5000, tools: 2, failures: 1 } },
		]);
	});

	test("keeps one duration across a retry's second agent_start", async () => {
		let time = 0;
		const { pi, appended } = makeFakePi();
		registerTurnSeparator(pi, createPadStore(), { now: () => time });
		const { ctx } = fakeCtx({ branch: [] });

		await emit(pi, "agent_start", { type: "agent_start" }, ctx);
		time = 1000;
		await emit(pi, "agent_start", { type: "agent_start" }, ctx);
		time = 3000;
		await emit(pi, "agent_settled", { type: "agent_settled" }, ctx);

		expect((appended[0]?.data as { durationMs?: number }).durationMs).toBe(3000);
	});

	test("ignores nested tools in the receipt", async () => {
		let time = 0;
		const { pi, appended } = makeFakePi();
		registerTurnSeparator(pi, createPadStore(), { now: () => time });
		const { ctx } = fakeCtx({ branch: [] });

		await emit(pi, "agent_start", { type: "agent_start" }, ctx);
		time = 1000;
		await emit(pi, "tool_execution_start", { toolCallId: "1", toolName: "read" }, ctx);
		await emit(pi, "tool_execution_start", { toolCallId: "2", toolName: "inner", parentToolCallId: "1" }, ctx);
		await emit(
			pi,
			"tool_execution_end",
			{ toolCallId: "2", toolName: "inner", parentToolCallId: "1", isError: true },
			ctx,
		);
		await emit(pi, "agent_settled", { type: "agent_settled" }, ctx);

		expect(appended).toEqual([{ customType: "bytefly-separator", data: { turn: 1, durationMs: 1000, tools: 1 } }]);
	});

	test("records an aborted run", async () => {
		let time = 0;
		const { pi, appended } = makeFakePi();
		registerTurnSeparator(pi, createPadStore(), { now: () => time });
		const { ctx } = fakeCtx({ branch: [] });

		await emit(pi, "agent_start", { type: "agent_start" }, ctx);
		time = 1500;
		await emit(pi, "agent_settled", { type: "agent_settled", aborted: true }, ctx);

		expect(appended).toEqual([{ customType: "bytefly-separator", data: { turn: 1, durationMs: 1500, aborted: true } }]);
	});

	test("renders the stored turn number", () => {
		const { pi, renderers } = makeFakePi();
		bootBytefly(pi);

		const renderer = renderers.get("bytefly-separator");
		const component = renderer(separatorEntry(4), { expanded: false }, fakeTheme);

		expect(component.render(30).join("\n")).toContain("turn 4");
	});

	test("renders the stored receipt", () => {
		const { pi, renderers } = makeFakePi();
		bootBytefly(pi);

		const renderer = renderers.get("bytefly-separator");
		const entry = {
			type: "custom",
			customType: "bytefly-separator",
			data: { turn: 4, durationMs: 72_000, tools: 7, failures: 1 },
		};
		const component = renderer(entry, { expanded: false }, fakeTheme);

		expect(component.render(80).join("\n")).toContain("turn 4 · 1m12s · 7 tools · ✕1");
	});

	test("ignores an entry without a turn number", () => {
		const { pi, renderers } = makeFakePi();
		bootBytefly(pi);

		const renderer = renderers.get("bytefly-separator");

		expect(
			renderer({ type: "custom", customType: "bytefly-separator" }, { expanded: false }, fakeTheme),
		).toBeUndefined();
	});

	test("registers nothing when disabled through PI_DISABLED_EXTENSIONS", async () => {
		await withEnv({ [ENV_DISABLED_EXTENSIONS]: "bytefly" }, () => {
			const { pi, renderers, handlers } = makeFakePi();
			bootBytefly(pi);
			expect(renderers.size).toBe(0);
			expect(handlers.size).toBe(0);
		});
	});

	test("ignores the retired turn-separator disable name", async () => {
		await withEnv({ [ENV_DISABLED_EXTENSIONS]: "turn-separator" }, () => {
			const { pi, renderers } = makeFakePi();
			bootBytefly(pi);
			expect(renderers.has("bytefly-separator")).toBe(true);
		});
	});
});
