import { describe, expect, test } from "bun:test";
import turnSeparator from "./index.ts";
import { emit, fakeTheme, makeFakePi } from "../../test/helpers/fakes.ts";
import { fakeCtx, separatorEntry } from "../../test/helpers/fixtures/turn-separator.ts";

describe("turn-separator extension", () => {
	test("registers the entry renderer", () => {
		const { pi, renderers } = makeFakePi();
		turnSeparator(pi);
		expect(renderers.has("turn-separator")).toBe(true);
	});

	test("appends the next turn when the agent settles", async () => {
		const { pi, appended } = makeFakePi();
		turnSeparator(pi);

		await emit(pi, "agent_settled", { type: "agent_settled" }, fakeCtx({ entries: [] }));
		await emit(pi, "agent_settled", { type: "agent_settled" }, fakeCtx({ entries: [separatorEntry(1)] }));

		expect(appended).toEqual([
			{ customType: "turn-separator", data: { turn: 1 } },
			{ customType: "turn-separator", data: { turn: 2 } },
		]);
	});

	test("does nothing outside interactive mode", async () => {
		const { pi, appended } = makeFakePi();
		turnSeparator(pi);

		await emit(pi, "agent_settled", { type: "agent_settled" }, fakeCtx({ mode: "print" }));

		expect(appended).toHaveLength(0);
	});

	test("renders the stored turn number", () => {
		const { pi, renderers } = makeFakePi();
		turnSeparator(pi);

		const renderer = renderers.get("turn-separator");
		const component = renderer(separatorEntry(4), { expanded: false }, fakeTheme);

		expect(component.render(30).join("\n")).toContain("turn 4");
	});

	test("ignores an entry without a turn number", () => {
		const { pi, renderers } = makeFakePi();
		turnSeparator(pi);

		const renderer = renderers.get("turn-separator");

		expect(renderer({ type: "custom", customType: "turn-separator" }, { expanded: false }, fakeTheme)).toBeUndefined();
	});
});
