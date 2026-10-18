/**
 * Cross-cutting render contract: every registered tool draws lines that fit the
 * width it is given, a rejected call renders as a sanitized error, and bytefly's
 * frame reuses the lines it already rendered when nothing changed.
 *
 * The per-tool suites cover each renderer's content. This one proves the shape
 * they all share, because bytefly frames every tool block: a line that overflows
 * its width pushes the rail, an unsanitized message reaches the terminal, and a
 * frame that re-derives every block per render makes a long transcript slow.
 * Registration only — no session hook runs, so nothing touches disk or network.
 */

import { describe, expect, test } from "bun:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { ToolCallText } from "../lib/tui/tool.ts";
import bytefly from "../extensions/bytefly/index.ts";
import document from "../extensions/document/index.ts";
import goal from "../extensions/goal/index.ts";
import jobs from "../extensions/job/index.ts";
import memory from "../extensions/memory/index.ts";
import planMode from "../extensions/plan/index.ts";
import question from "../extensions/question/index.ts";
import subagent from "../extensions/subagent/index.ts";
import todo from "../extensions/todo/index.ts";
import watch from "../extensions/watch/index.ts";
import webAccess from "../extensions/web-access/index.ts";
import wechat from "../extensions/wechat/index.ts";
import { createFakePi, fakeTheme } from "./helpers/fakes.ts";

/** Every extension that registers a tool with a renderer, as the gallery does. */
const EXTENSIONS: Array<(pi: any) => void> = [
	bytefly,
	document,
	goal,
	jobs,
	memory,
	planMode,
	question,
	subagent,
	todo,
	watch,
	webAccess,
	wechat,
];

/** The widths the transcript is exercised at: wide, split, and narrow. */
const WIDTHS = [80, 48, 40];

/**
 * The call and result states a row actually renders: arguments still streaming
 * in, a settled call, a collapsed or expanded result, and a partial result.
 */
const CALL_STATES = [
	{ argsComplete: false, isPartial: true },
	{ argsComplete: true, isPartial: false },
];

const RESULT_STATES = [
	{ expanded: false, isPartial: false },
	{ expanded: true, isPartial: false },
	{ expanded: false, isPartial: true },
];

/** Control characters that must never reach the terminal; SGR may. */
const RAW_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;

/** A render context with the fields the package renderers read. */
function context(overrides: Record<string, unknown> = {}): any {
	return {
		args: {},
		toolCallId: "call-contract",
		invalidate: () => {},
		lastComponent: undefined,
		state: {},
		cwd: "/home/u/repo/project",
		executionStarted: true,
		argsComplete: true,
		isPartial: false,
		expanded: false,
		showImages: false,
		isError: false,
		durationMs: undefined,
		outputPad: 0,
		...overrides,
	};
}

/** Every tool the package's extensions register. */
function registeredTools(): Map<string, any> {
	const fake = createFakePi();
	for (const extension of EXTENSIONS) extension(fake.pi);
	return fake.tools;
}

/** Assert every line fits the width and carries no raw control characters. */
function expectBounded(lines: string[], width: number, label: string): void {
	for (const line of lines) {
		expect(visibleWidth(line), `${label} exceeds ${width}`).toBeLessThanOrEqual(width);
		expect(stripTerminalSequences(line), `${label} carries a control character`).not.toMatch(RAW_CONTROL);
	}
}

describe("tool render contract", () => {
	test("every renderCall draws bounded, control-free lines", () => {
		for (const [name, tool] of registeredTools()) {
			if (typeof tool.renderCall !== "function") continue;
			for (const width of WIDTHS) {
				const component = tool.renderCall({}, fakeTheme, context());
				expect(component, `${name} renderCall returned nothing`).toBeDefined();
				const lines = component.render(width);
				if (component instanceof ToolCallText) {
					expect(lines, `${name} call wrapped at ${width}`).toHaveLength(component.text.split("\n").length);
				}
				expectBounded(lines, width, `${name} call at ${width}`);
			}
		}
	});

	test("bytefly's frame reuses its lines on an unchanged frame", () => {
		const fake = createFakePi();
		for (const extension of EXTENSIONS) extension(fake.pi);
		const frame: any = fake.toolRenderers[0];
		expect(frame, "bytefly registered no tool frame").toBeDefined();
		const rejected: any = {
			content: [{ type: "text", text: "Error: Permission denied" }],
			details: {},
			isError: true,
		};

		for (const [name, tool] of fake.tools) {
			const wrapped = frame(name, () => tool);
			for (const width of WIDTHS) {
				for (const state of CALL_STATES) {
					const call = wrapped.renderCall({}, fakeTheme, context({ state: {}, ...state }));
					const first = call.render(width);
					expect(call.render(width), `${name} call rebuilt at ${width}`).toBe(first);
				}
				for (const state of RESULT_STATES) {
					const result = wrapped.renderResult(
						rejected,
						{ expanded: state.expanded, isPartial: state.isPartial },
						fakeTheme,
						context({ state: {}, isError: true, ...state }),
					);
					const first = result.render(width);
					expect(result.render(width), `${name} result rebuilt at ${width}`).toBe(first);
				}
			}
		}
	});

	test("a rejected call renders sanitized in the error role at every width", () => {
		for (const [name, tool] of registeredTools()) {
			if (typeof tool.renderResult !== "function") continue;
			const rejected = {
				content: [{ type: "text", text: `Error: Permission denied: ${name}` }],
				details: {},
				isError: true,
			};
			for (const width of WIDTHS) {
				const options = { expanded: false, isPartial: false };
				const component = tool.renderResult(rejected, options, fakeTheme, context({ isError: true }));
				const lines = component.render(width);
				expectBounded(lines, width, `${name} rejection at ${width}`);
				const text = lines.join(" ").replace(/\s+/g, " ");
				expect(text, `${name} lost the rejection message`).toContain(`Permission denied: ${name}`);
				expect(text, `${name} dropped the error prefix`).toContain("Error:");
				expect(text.includes("Error: Error:"), `${name} doubled the error prefix`).toBe(false);
			}
		}
	});
});
