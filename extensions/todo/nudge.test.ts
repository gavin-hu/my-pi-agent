import { describe, expect, test } from "bun:test";
import { formatNudge, isMutatingTool, MUTATING_TOOL_NAMES, shouldNudge, TODO_NUDGE_MARKER } from "./nudge.ts";
import type { Todo } from "./types.ts";

const pending = (content: string): Todo => ({ content, status: "pending" });
const inProgress = (content: string, activeForm: string): Todo => ({ content, status: "in_progress", activeForm });
const completed = (content: string): Todo => ({ content, status: "completed" });

describe("isMutatingTool", () => {
	test("the built-in writers and shells count as work", () => {
		for (const name of MUTATING_TOOL_NAMES) expect(isMutatingTool(name)).toBe(true);
	});

	test("the todo call is never work", () => {
		expect(isMutatingTool("todo", { readOnlyHint: false })).toBe(false);
	});

	test("a known reader is not work even without annotations", () => {
		expect(isMutatingTool("read")).toBe(false);
		expect(isMutatingTool("grep", {})).toBe(false);
	});

	test("an unknown tool counts only when it declares readOnlyHint false", () => {
		expect(isMutatingTool("some_mcp_tool")).toBe(false);
		expect(isMutatingTool("some_mcp_tool", { readOnlyHint: true })).toBe(false);
		expect(isMutatingTool("some_mcp_tool", { readOnlyHint: false })).toBe(true);
	});
});

describe("shouldNudge", () => {
	test("due only when work is dirty, not yet nudged, and the list is open", () => {
		expect(shouldNudge(true, false, [pending("one")])).toBe(true);
		expect(shouldNudge(false, false, [pending("one")])).toBe(false);
		expect(shouldNudge(true, true, [pending("one")])).toBe(false);
	});

	test("never due when the list is empty or fully completed", () => {
		expect(shouldNudge(true, false, [])).toBe(false);
		expect(shouldNudge(true, false, [completed("done")])).toBe(false);
	});
});

describe("formatNudge", () => {
	test("carries the marker and points at the active item", () => {
		const text = formatNudge([inProgress("Write tests", "Writing tests"), pending("Ship")]);
		expect(text).toContain(TODO_NUDGE_MARKER);
		expect(text).toContain("Writing tests");
	});

	test("omits the pointer when there is no current item", () => {
		const text = formatNudge([completed("done"), completed("also done")]);
		expect(text).not.toContain("still points at");
	});
});
