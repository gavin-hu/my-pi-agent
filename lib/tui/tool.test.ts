import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { coloringTheme, fakeTheme } from "../../test/helpers/fakes.ts";
import {
	elapsedSuffix,
	errorLine,
	messageText,
	moreHint,
	rejectionLine,
	reuseCallText,
	startToolProgress,
	syncElapsedTimer,
	ToolCallText,
	toolCallTitle,
} from "./tool.ts";

/** Column counts exercised by the width sweep. */
const WIDTHS = [80, 48, 40, 20];

describe("toolCallTitle", () => {
	test("draws the bold tool title in the tool-title token", () => {
		expect(toolCallTitle(coloringTheme, "read")).toBe("[toolTitle][bold]read");
	});
});

describe("ToolCallText", () => {
	test("clips an over-wide call to one line instead of wrapping", () => {
		const line = new ToolCallText("memory → add (project): Prefers bun over npm", "end").render(40)[0] ?? "";
		expect(line).toContain("…");
		expect(visibleWidth(line)).toBeLessThanOrEqual(40);
		expect(line.split("\n")).toHaveLength(1);
	});

	test("middle clip keeps the host and the tail of a URL", () => {
		const line =
			new ToolCallText("web_fetch https://example.com/docs/guides/retry-policy", "middle").render(40)[0] ?? "";
		expect(line).toContain("https://");
		expect(line).toContain("policy");
		expect(visibleWidth(line)).toBeLessThanOrEqual(40);
	});

	test("keeps one output line per input line and fits every width", () => {
		const component = new ToolCallText("read\nsrc/very/long/path/to/a/file.ts\nopts", "end");
		for (const width of WIDTHS) {
			const lines = component.render(width);
			expect(lines).toHaveLength(3);
			for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
	});

	test("renders an empty string as one empty line", () => {
		expect(new ToolCallText().render(20)).toEqual([""]);
	});

	test("reuseCallText reuses the same component and clip mode", () => {
		const first = reuseCallText(undefined, "a", "end");
		expect(reuseCallText(first, "b", "end")).toBe(first);
		expect(reuseCallText(first, "b", "middle")).not.toBe(first);
	});
});

describe("errorLine", () => {
	test("sanitizes control characters before painting the error role", () => {
		expect(errorLine(fakeTheme, "a\u001b[31mb\u009dc")).toBe("Error: a [31mb c");
	});

	test("keeps exactly one Error: prefix", () => {
		expect(errorLine(fakeTheme, "Error: boom")).toBe("Error: boom");
		expect(errorLine(fakeTheme, "error: boom")).toBe("Error: boom");
	});

	test("names the failure when the message is empty", () => {
		expect(errorLine(fakeTheme, "  \n ")).toBe("Error: the tool call failed");
	});
});

describe("rejectionLine", () => {
	test("joins every text block and keeps the error role", () => {
		const line = rejectionLine(fakeTheme, {
			content: [
				{ type: "text", text: "Permission denied: todo" },
				{ type: "text", text: "Ask the user to allow it." },
			],
			isError: true,
		});
		expect(line).toContain("Error: Permission denied: todo");
		expect(line).toContain("Ask the user to allow it.");
	});

	test("caps collapsed output and expands it with the shared hint", () => {
		const content = Array.from({ length: 5 }, (_, index) => ({ type: "text", text: `line ${index}` }));
		const collapsed = rejectionLine(fakeTheme, { content, isError: true }, false, 3);
		expect(collapsed).toContain("line 2");
		expect(collapsed).not.toContain("line 3");
		expect(collapsed).toContain("… 2 more lines");
		const expanded = rejectionLine(fakeTheme, { content, isError: true }, true, 3);
		expect(expanded).toContain("line 4");
		expect(expanded).not.toContain("more lines");
	});

	test("messageText ignores non-text blocks", () => {
		expect(messageText({ content: [{ type: "image" }, { type: "text", text: "hello" }] })).toBe("hello");
	});
});

describe("moreHint", () => {
	test("names the hidden count and the expand affordance", () => {
		const hint = moreHint(fakeTheme, 3);
		expect(hint).toContain("… 3 more lines");
		expect(hint.toLowerCase()).toContain("expand");
	});
});

describe("syncElapsedTimer", () => {
	test("starts once, reports the first render time, and clears on completion", () => {
		const context = { state: {} as Record<string, unknown>, invalidate: () => {} };
		expect(syncElapsedTimer(true, context, 1000)).toBe(1000);
		expect(syncElapsedTimer(true, context, 5000)).toBe(1000);
		expect(context.state.elapsedTimer).toBeDefined();
		expect(syncElapsedTimer(false, context, 6000)).toBe(1000);
		expect(context.state.elapsedTimer).toBeUndefined();
	});

	test("does nothing without a render context", () => {
		expect(syncElapsedTimer(true, undefined, 1000)).toBeUndefined();
	});
});

describe("startToolProgress", () => {
	test("hands the host an empty partial result and tolerates no callback", () => {
		let seen: unknown;
		startToolProgress((partial) => {
			seen = partial;
		});
		expect(seen).toEqual({ content: [], details: undefined });
		expect(() => startToolProgress(undefined)).not.toThrow();
	});
});

describe("elapsedSuffix", () => {
	test("shows a perceptible duration and hides a sub-second one", () => {
		expect(elapsedSuffix(fakeTheme, 1500)).toContain("1.5s");
		expect(elapsedSuffix(fakeTheme, 500)).toBe("");
		expect(elapsedSuffix(fakeTheme, undefined)).toBe("");
	});
});
