import { describe, expect, test } from "bun:test";
import { createFakePi, fakeTheme } from "../../test/helpers/fakes.ts";
import { registerTools, TOOL_NAME } from "./tools.ts";
import type { AskResult } from "./types.ts";

function setup() {
	const { pi, tools } = createFakePi();
	registerTools(pi);
	return { tool: tools.get(TOOL_NAME) };
}

describe("ask_user_question transcript rendering", () => {
	test("call line lists one options line per question", () => {
		const { tool } = setup();
		const lines = tool
			.renderCall(
				{
					questions: [
						{ question: "Auth?", header: "Auth", options: [{ label: "OAuth" }, { label: "Cookies" }] },
						{ question: "Scope?", header: "Scope", options: [{ label: "repo" }, { label: "org" }] },
					],
				},
				fakeTheme,
				{ lastComponent: undefined },
			)
			.render(80)
			.map((line: string) => line.trimEnd());
		expect(lines[0]).toContain("ask_user_question 2 questions (Auth, Scope)");
		expect(lines[1]).toBe("  Auth: OAuth, Cookies, Other");
		expect(lines[2]).toBe("  Scope: repo, org, Other");
	});

	test("a free-form question adds no options line", () => {
		const { tool } = setup();
		const lines = tool
			.renderCall({ questions: [{ question: "Notes?", header: "Notes" }] }, fakeTheme, { lastComponent: undefined })
			.render(80);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain("1 question (Notes)");
	});

	test("result renders selected and custom answers", () => {
		const { tool } = setup();
		const details: AskResult = {
			questions: [],
			answers: [
				{
					id: "1",
					header: "Auth",
					question: "Auth?",
					values: ["OAuth"],
					labels: ["OAuth"],
					wasCustom: false,
					indices: [1],
				},
				{ id: "2", header: "Format", question: "Format?", values: ["json"], labels: ["json"], wasCustom: true },
			],
			cancelled: false,
		};
		const text = tool
			.renderResult({ details, content: [{ type: "text", text: "" }] }, { expanded: false }, fakeTheme, {
				lastComponent: undefined,
			})
			.render(80)
			.join("\n");
		expect(text).toContain("✓ Auth: 1. OAuth");
		expect(text).toContain("✓ Format: (wrote) json");
	});

	test("separates a multi-line answer body with a blank line", () => {
		const { tool } = setup();
		const details: AskResult = {
			questions: [],
			answers: [
				{
					id: "1",
					header: "Auth",
					question: "?",
					values: ["OAuth"],
					labels: ["OAuth"],
					wasCustom: false,
					indices: [1],
				},
				{ id: "2", header: "Scope", question: "?", values: ["repo"], labels: ["repo"], wasCustom: false, indices: [2] },
			],
			cancelled: false,
		};
		const lines = tool
			.renderResult({ details, content: [{ type: "text", text: "" }] }, { expanded: false }, fakeTheme, {
				lastComponent: undefined,
			})
			.render(80)
			.map((line: string) => line.trimEnd());
		expect(lines[0]).toBe("");
		expect(lines[1]).toContain("✓ Auth: 1. OAuth");
		expect(lines[2]).toContain("✓ Scope: 2. repo");
	});

	test("keeps a single answer flush", () => {
		const { tool } = setup();
		const details: AskResult = {
			questions: [],
			answers: [
				{
					id: "1",
					header: "Auth",
					question: "?",
					values: ["OAuth"],
					labels: ["OAuth"],
					wasCustom: false,
					indices: [1],
				},
			],
			cancelled: false,
		};
		const text = tool
			.renderResult({ details, content: [{ type: "text", text: "" }] }, { expanded: false }, fakeTheme, {
				lastComponent: undefined,
			})
			.render(80)
			.join("\n");
		expect(text.startsWith("✓ Auth")).toBe(true);
	});

	test("cancelled and no-UI results", () => {
		const { tool } = setup();
		const cancelled = tool
			.renderResult(
				{ details: { questions: [], answers: [], cancelled: true }, content: [{ type: "text", text: "" }] },
				{ expanded: false },
				fakeTheme,
				{ lastComponent: undefined },
			)
			.render(80)
			.join("\n");
		expect(cancelled).toContain("Cancelled");

		const unavailable = tool
			.renderResult(
				{
					details: { questions: [], answers: [], cancelled: false, unavailable: true },
					content: [{ type: "text", text: "" }],
				},
				{ expanded: false },
				fakeTheme,
				{ lastComponent: undefined },
			)
			.render(80)
			.join("\n");
		expect(unavailable).toContain("No interactive UI");
	});

	test("reuses the slot Text across renders", () => {
		const { tool } = setup();
		const first = tool.renderCall({ questions: [{ header: "A", options: [{ label: "x" }] }] }, fakeTheme, {
			lastComponent: undefined,
		});
		const again = tool.renderCall({ questions: [{ header: "B", options: [{ label: "y" }] }] }, fakeTheme, {
			lastComponent: first,
		});
		expect(again).toBe(first);
	});
});
