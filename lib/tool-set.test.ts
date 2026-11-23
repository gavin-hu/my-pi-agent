/**
 * The active-set filter two modes share.
 *
 * The cases are about what a leave must not do: widen the set with a tool the
 * mode activated for its own sake, re-activate a tool a branch restore had already
 * accounted for, or drop a tool another filter added.
 */

import { describe, expect, test } from "bun:test";
import { createToolSetFilter } from "./tool-set.ts";

const ALLOWED = ["read", "grep"];
const policy = { isAllowed: (name: string) => ALLOWED.includes(name) };

/** A host whose active set is the one array it is given. */
function host(initial: string[]): {
	host: { getActiveTools(): string[]; setActiveTools(names: string[]): void };
	active(): string[];
} {
	let active = [...initial];
	return {
		host: {
			getActiveTools: () => [...active],
			setActiveTools: (names) => {
				active = [...names];
			},
		},
		active: () => [...active],
	};
}

describe("createToolSetFilter", () => {
	test("captures what entering would hide, but not the mode's own verbs", () => {
		const fake = host(["read", "write", "edit", "plan"]);
		const tools = createToolSetFilter(fake.host, policy, ["plan"]);
		expect(tools.capture()).toEqual(["write", "edit"]);
		expect(tools.capture()).toHaveLength(2);
	});

	test("entering keeps what the policy allows and adds the mode's verbs once", () => {
		const fake = host(["read", "write"]);
		createToolSetFilter(fake.host, policy, ["plan"]).enter();
		expect(fake.active()).toEqual(["read", "plan"]);
	});

	test("leaving puts back the tools the mode hid", () => {
		const fake = host(["read", "write"]);
		const tools = createToolSetFilter(fake.host, policy, ["plan"]);
		const removed = tools.capture();
		tools.enter();
		tools.leave(removed);
		expect(fake.active()).toEqual(["read", "write"]);
	});

	test("leaving drops the mode's own verb when the user did not have it", () => {
		const fake = host(["read", "plan"]);
		const tools = createToolSetFilter(fake.host, policy, ["plan"]);
		const removed = tools.capture();
		tools.enter();
		tools.leave(removed);
		// `plan` was already active, so this leave had nothing of its own to drop.
		expect(fake.active()).toEqual(["read", "plan"]);
	});

	test("a branch restore leaves without putting the hidden tools back", () => {
		const fake = host(["read", "write"]);
		const tools = createToolSetFilter(fake.host, policy, ["plan"]);
		tools.enter();
		tools.leave(["write"], { reAdd: false });
		expect(fake.active()).toEqual(["read"]);
	});

	test("two filters do not share the memory of what they activated", () => {
		const fake = host(["read"]);
		const first = createToolSetFilter(fake.host, policy, ["plan"]);
		const second = createToolSetFilter(fake.host, policy, ["plan"]);
		first.enter();
		second.enter();
		second.leave([], { reAdd: false });
		// The second filter never activated anything, so its leave drops nothing.
		expect(fake.active()).toEqual(["read", "plan"]);
	});
});
