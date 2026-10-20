/**
 * The y/N confirmation layer: accept, dismiss, and the keys in between.
 */

import { describe, expect, test } from "bun:test";

/** Raw key chunks, as the host delivers them. */
const ENTER = "\r";
const ESCAPE = "\x1b";
import { ConfirmState } from "./confirm.ts";

function harness() {
	const state = new ConfirmState();
	const accepted: string[] = [];
	state.ask("Kill j1? y/N", () => accepted.push("yes"));
	return { state, accepted };
}

describe("ConfirmState", () => {
	test("holds the question until it is answered", () => {
		const { state } = harness();
		expect(state.pending?.prompt).toBe("Kill j1? y/N");
	});

	test("accepts on y, Y, and Enter", () => {
		for (const key of ["y", "Y", ENTER]) {
			const { state, accepted } = harness();
			expect(state.resolve(key)).toBe("accept");
			expect(accepted).toEqual(["yes"]);
			expect(state.pending).toBeUndefined();
		}
	});

	test("dismisses on n, N, Escape, and q without acting", () => {
		for (const key of ["n", "N", ESCAPE, "q"]) {
			const { state, accepted } = harness();
			expect(state.resolve(key)).toBe("dismiss");
			expect(accepted).toEqual([]);
			expect(state.pending).toBeUndefined();
		}
	});

	test("leaves any other key to the screen", () => {
		const { state, accepted } = harness();
		expect(state.resolve("j")).toBeUndefined();
		expect(state.pending?.prompt).toBe("Kill j1? y/N");
		expect(accepted).toEqual([]);
	});

	test("resolves nothing when no question is pending", () => {
		const state = new ConfirmState();
		expect(state.resolve("y")).toBeUndefined();
	});

	test("a later question replaces an earlier one", () => {
		const state = new ConfirmState();
		const accepted: string[] = [];
		state.ask("first? y/N", () => accepted.push("first"));
		state.ask("second? y/N", () => accepted.push("second"));
		state.resolve("y");
		expect(accepted).toEqual(["second"]);
	});

	test("clearing drops the question", () => {
		const { state, accepted } = harness();
		state.clear();
		expect(state.pending).toBeUndefined();
		expect(state.resolve("y")).toBeUndefined();
		expect(accepted).toEqual([]);
	});
});
