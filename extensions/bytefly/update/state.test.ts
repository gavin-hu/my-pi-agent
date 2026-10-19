import { describe, expect, test } from "bun:test";
import { createUpdateState } from "./state.ts";
import type { PackageUpdate } from "./types.ts";

const UPDATES: PackageUpdate[] = [
	{ source: "@gavin-hu/my-pi-agent", displayName: "@gavin-hu/my-pi-agent", type: "npm", scope: "user" },
];

describe("createUpdateState", () => {
	test("starts with nothing known", () => {
		const state = createUpdateState();
		expect(state.updates()).toEqual([]);
		expect(state.ownLatest()).toBeUndefined();
	});

	test("records the list and this package's new version", () => {
		const state = createUpdateState();
		state.set(UPDATES, "0.14.0");
		expect(state.updates()).toEqual(UPDATES);
		expect(state.ownLatest()).toBe("0.14.0");
	});

	test("keeps another package's update out of the header marker", () => {
		const state = createUpdateState();
		state.set([{ source: "other", displayName: "other", type: "npm", scope: "user" }]);
		expect(state.updates()).toHaveLength(1);
		expect(state.ownLatest()).toBeUndefined();
	});

	test("clears on an empty set", () => {
		const state = createUpdateState();
		state.set(UPDATES, "0.14.0");
		state.set();
		expect(state.updates()).toEqual([]);
		expect(state.ownLatest()).toBeUndefined();
	});

	test("keeps each store separate, so a reload cannot inherit the last session's value", () => {
		const first = createUpdateState();
		first.set(UPDATES, "0.14.0");
		const second = createUpdateState();
		expect(second.updates()).toEqual([]);
		expect(second.ownLatest()).toBeUndefined();
	});
});
