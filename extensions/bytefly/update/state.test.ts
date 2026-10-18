import { describe, expect, test } from "bun:test";
import { createUpdateState } from "./state.ts";

describe("createUpdateState", () => {
	test("starts with nothing known", () => {
		expect(createUpdateState().latest()).toBeUndefined();
	});

	test("records the version it is given", () => {
		const state = createUpdateState();
		state.set("0.12.0");
		expect(state.latest()).toBe("0.12.0");
	});

	test("clears on an empty set", () => {
		const state = createUpdateState();
		state.set("0.12.0");
		state.set("");
		expect(state.latest()).toBeUndefined();
	});

	test("keeps each store separate, so a reload cannot inherit the last session's value", () => {
		const first = createUpdateState();
		first.set("0.12.0");
		expect(createUpdateState().latest()).toBeUndefined();
	});
});
