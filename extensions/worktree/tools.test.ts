/**
 * The folded `worktree` tool's own surface: its schema and its annotations.
 *
 * The isolation itself is proved in `flow.test.ts` and `git.test.ts`, against a
 * real repository, and the block it draws is bytefly's generic fallback — which is
 * why nothing here imports the transcript kit. This suite needs no checkout at all.
 */

import { describe, expect, test } from "bun:test";
import { makeWorktreePi } from "../../test/helpers/fixtures/worktree.ts";
import { WORKTREE_ACTIONS, WORKTREE_TOOL } from "./tools.ts";

/** The registered tool, from an extension that only had to register. */
function registered() {
	const { pi } = makeWorktreePi();
	return { tool: pi.tools.get(WORKTREE_TOOL) };
}

describe("the folded worktree tool", () => {
	test("offers the four lifecycle verbs as one action field", () => {
		const { tool } = registered();
		const action = (tool.parameters as { properties: { action: { enum: string[] } } }).properties.action;
		expect(action.enum).toEqual([...WORKTREE_ACTIONS]);
	});

	test("takes the strictest annotation, because entering writes into the checkout", () => {
		const { tool } = registered();
		expect(tool.executionMode).toBe("sequential");
		expect(tool.annotations).toEqual({ readOnlyHint: false, destructiveHint: true, openWorldHint: true });
	});
});
