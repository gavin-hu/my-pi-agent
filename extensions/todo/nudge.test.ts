import { describe, expect, test } from "bun:test";
import {
	EMPTY_LIST_MUTATIONS,
	formatNudge,
	isFileWrite,
	isMutatingTool,
	MUTATING_TOOL_NAMES,
	type NudgeState,
	shouldNudge,
	TODO_NUDGE_MARKER,
} from "./nudge.ts";
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

describe("isFileWrite", () => {
	test("the built-in writers can change files", () => {
		expect(isFileWrite("write")).toBe(true);
		expect(isFileWrite("edit")).toBe(true);
	});

	test("a shell call cannot be told apart from a read, so it is not a write", () => {
		for (const name of ["bash", "powershell"]) expect(isFileWrite(name)).toBe(false);
	});

	test("the todo call and readers are never writes", () => {
		expect(isFileWrite("todo", { readOnlyHint: false })).toBe(false);
		expect(isFileWrite("read")).toBe(false);
	});

	test("an unknown mutator declaring readOnlyHint false counts as one", () => {
		expect(isFileWrite("some_mcp_tool")).toBe(false);
		expect(isFileWrite("some_mcp_tool", { readOnlyHint: false })).toBe(true);
	});
});

describe("shouldNudge", () => {
	const state = (overrides: Partial<NudgeState> = {}): NudgeState => ({
		mutations: 1,
		writes: 1,
		touched: false,
		nudged: false,
		todos: [pending("one")],
		...overrides,
	});

	test("an open item is due after one mutation, until one reminder is sent", () => {
		expect(shouldNudge(state())).toBe(true);
		expect(shouldNudge(state({ mutations: 0 }))).toBe(false);
		expect(shouldNudge(state({ nudged: true }))).toBe(false);
	});

	test("no list at all is due only after repeated work that wrote something", () => {
		expect(shouldNudge(state({ todos: [], mutations: EMPTY_LIST_MUTATIONS - 1 }))).toBe(false);
		expect(shouldNudge(state({ todos: [], mutations: EMPTY_LIST_MUTATIONS }))).toBe(true);
	});

	test("repeated shell reads with no write are investigation, not unplanned work", () => {
		expect(shouldNudge(state({ todos: [], writes: 0, mutations: EMPTY_LIST_MUTATIONS }))).toBe(false);
	});

	test("a list the model wrote or cleared this turn is left alone", () => {
		expect(shouldNudge(state({ todos: [], touched: true }))).toBe(false);
		expect(shouldNudge(state({ todos: [], touched: true, mutations: EMPTY_LIST_MUTATIONS }))).toBe(false);
	});

	test("never due when every item is completed", () => {
		expect(shouldNudge(state({ todos: [completed("done")], mutations: EMPTY_LIST_MUTATIONS }))).toBe(false);
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

	test("asks for a list when there is none", () => {
		const text = formatNudge([]);
		expect(text).toContain(TODO_NUDGE_MARKER);
		expect(text).toContain("no todo list was recorded");
		expect(text).not.toContain("still points at");
		expect(text).not.toContain("unfinished items");
	});
});
