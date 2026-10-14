import { describe, expect, test } from "bun:test";
import { ENV_DISABLED_EXTENSIONS } from "../../../lib/env.ts";
import { fakeCtx } from "../../../test/helpers/context.ts";
import { withEnv } from "../../../test/helpers/env.ts";
import { emit, fakeTheme } from "../../../test/helpers/fakes.ts";
import { makeFakePi, separatorEntry } from "../../../test/helpers/fixtures/bytefly.ts";
import bytefly from "../index.ts";

describe("bytefly turn separator", () => {
	test("registers the bytefly-separator renderer and not the retired one", () => {
		const { pi, renderers } = makeFakePi();
		bytefly(pi);
		expect(renderers.has("bytefly-separator")).toBe(true);
		expect(renderers.has("turn-separator")).toBe(false);
	});

	test("appends the next turn when the agent settles", async () => {
		const { pi, appended } = makeFakePi();
		bytefly(pi);

		await emit(pi, "agent_settled", { type: "agent_settled" }, fakeCtx({ branch: [] }).ctx);
		await emit(pi, "agent_settled", { type: "agent_settled" }, fakeCtx({ branch: [separatorEntry(1)] }).ctx);

		expect(appended).toEqual([
			{ customType: "bytefly-separator", data: { turn: 1 } },
			{ customType: "bytefly-separator", data: { turn: 2 } },
		]);
	});

	test("does not count the retired turn-separator entries", async () => {
		const { pi, appended } = makeFakePi();
		bytefly(pi);

		const legacy = { type: "custom", customType: "turn-separator", data: { turn: 9 } };
		await emit(pi, "agent_settled", { type: "agent_settled" }, fakeCtx({ branch: [legacy] }).ctx);

		expect(appended).toEqual([{ customType: "bytefly-separator", data: { turn: 1 } }]);
	});

	test("does nothing outside interactive mode", async () => {
		const { pi, appended } = makeFakePi();
		bytefly(pi);

		await emit(pi, "agent_settled", { type: "agent_settled" }, fakeCtx({ mode: "print" }).ctx);

		expect(appended).toHaveLength(0);
	});

	test("renders the stored turn number", () => {
		const { pi, renderers } = makeFakePi();
		bytefly(pi);

		const renderer = renderers.get("bytefly-separator");
		const component = renderer(separatorEntry(4), { expanded: false }, fakeTheme);

		expect(component.render(30).join("\n")).toContain("turn 4");
	});

	test("ignores an entry without a turn number", () => {
		const { pi, renderers } = makeFakePi();
		bytefly(pi);

		const renderer = renderers.get("bytefly-separator");

		expect(
			renderer({ type: "custom", customType: "bytefly-separator" }, { expanded: false }, fakeTheme),
		).toBeUndefined();
	});

	test("registers nothing when disabled through PI_DISABLED_EXTENSIONS", async () => {
		await withEnv({ [ENV_DISABLED_EXTENSIONS]: "bytefly" }, () => {
			const { pi, renderers, handlers } = makeFakePi();
			bytefly(pi);
			expect(renderers.size).toBe(0);
			expect(handlers.size).toBe(0);
		});
	});

	test("ignores the retired turn-separator disable name", async () => {
		await withEnv({ [ENV_DISABLED_EXTENSIONS]: "turn-separator" }, () => {
			const { pi, renderers } = makeFakePi();
			bytefly(pi);
			expect(renderers.has("bytefly-separator")).toBe(true);
		});
	});
});
