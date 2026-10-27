/**
 * The tool-transcript kit and the per-instance render memo: the call line, the
 * sanitized error and rejection, the overflow hints, the tail block, the
 * running timer, and the cache that keeps a repeat frame cheap.
 */

import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { coloringTheme, fakeTheme } from "../../test/helpers/fakes.ts";
import { RenderCache } from "./render-cache.ts";
import {
	callLine,
	detailsOrLine,
	earlierHint,
	elapsedSuffix,
	errorLine,
	messageText,
	moreHint,
	overflowHint,
	rejectionLine,
	reuseCallText,
	startToolProgress,
	syncElapsedTimer,
	isTailResult,
	TailResult,
	ToolCallText,
	toolCallTitle,
} from "./tool.ts";

/** Column counts exercised by the width sweeps. */
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

	test("returns the same lines on a repeat render at the same width", () => {
		const component = new ToolCallText("read src/a.ts", "end");
		expect(component.render(40)).toBe(component.render(40));
	});

	test("rebuilds when the text or the width changes", () => {
		const component = new ToolCallText("read src/a.ts", "end");
		const first = component.render(40);

		expect(component.render(41)).not.toBe(first);
		component.setText("read src/b.ts");
		expect(component.render(41)[0]).toContain("src/b.ts");
	});

	test("rebuilds after invalidate even when nothing else changed", () => {
		const component = new ToolCallText("read src/a.ts", "end");
		const first = component.render(40);

		component.invalidate();

		expect(component.render(40)).not.toBe(first);
	});

	test("reuseCallText reuses the same component and clip mode", () => {
		const first = reuseCallText(undefined, "a", "end");
		expect(reuseCallText(first, "b", "end")).toBe(first);
		expect(reuseCallText(first, "b", "middle")).not.toBe(first);
	});
});

describe("callLine", () => {
	test("draws the bold tool name and the subject in the meta role", () => {
		const line = callLine(fakeTheme, undefined, "memory", "→ add (project): x").render(80)[0] ?? "";
		expect(line).toContain("memory ");
		expect(line).toContain("→ add (project): x");
	});

	test("flattens a multi-line subject to one line", () => {
		const line = callLine(fakeTheme, undefined, "memory", "first\nsecond").render(80);
		expect(line).toHaveLength(1);
		expect(line[0]).toContain("first second");
	});

	test("stays inside the render width at every sweep value", () => {
		const subject = "web_fetch https://example.com/docs/guides/retry-policy";
		for (const width of WIDTHS) {
			const line = callLine(fakeTheme, undefined, "web_fetch", subject, "middle").render(width)[0] ?? "";
			expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
	});

	test("reuses the previous call component", () => {
		const first = callLine(fakeTheme, undefined, "read", "src/a.ts");
		expect(callLine(fakeTheme, first, "read", "src/b.ts")).toBe(first);
		expect(callLine(fakeTheme, first, "read", "src/b.ts", "middle")).not.toBe(first);
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

	test("names the rejection when there is no text at all", () => {
		expect(rejectionLine(fakeTheme, { content: [], isError: true })).toContain("rejected");
	});

	test("messageText ignores non-text blocks", () => {
		expect(messageText({ content: [{ type: "image" }, { type: "text", text: "hello" }] })).toBe("hello");
	});
});

describe("detailsOrLine", () => {
	const declined = { content: [{ type: "text", text: "Permission denied: memory" }], isError: true };

	test("returns the details when the result is intact", () => {
		const outcome = detailsOrLine(fakeTheme, { content: [] }, false, { sent: true });
		expect(outcome).toEqual({ details: { sent: true } });
	});

	test("returns Pi's rejection line when the call carried no details", () => {
		const outcome = detailsOrLine(fakeTheme, declined, false, undefined);
		expect("line" in outcome && outcome.line).toContain("Error: Permission denied: memory");
	});

	test("returns the extension's error through errorLine", () => {
		const outcome = detailsOrLine(fakeTheme, { content: [] }, false, { error: "error: rate limited" });
		expect("line" in outcome && outcome.line).toBe("Error: rate limited");
	});

	test("keeps a multi-line error readable instead of collapsing it", () => {
		const outcome = detailsOrLine(fakeTheme, { content: [] }, false, { error: "first\nsecond" });
		expect("line" in outcome && outcome.line.split("\n")).toEqual(["Error: first", "second"]);
	});

	test("treats an empty error as no failure", () => {
		const outcome = detailsOrLine(fakeTheme, { content: [] }, false, { error: "" });
		expect("details" in outcome).toBe(true);
	});

	test("accepts a details block with no error field at all", () => {
		const outcome = detailsOrLine(fakeTheme, { content: [] }, false, { approved: true });
		expect(outcome).toEqual({ details: { approved: true } });
	});
});

describe("moreHint", () => {
	test("names the hidden count and the expand affordance", () => {
		const hint = moreHint(fakeTheme, 3);
		expect(hint).toContain("… 3 more lines");
		expect(hint.toLowerCase()).toContain("expand");
	});

	test("honours a custom noun", () => {
		expect(moreHint(fakeTheme, 2, "rows")).toContain("… 2 more rows");
	});
});

describe("overflowHint", () => {
	test("names the hidden count without a noun", () => {
		const hint = overflowHint(fakeTheme, 2);
		expect(hint).toContain("… 2 more");
		expect(hint.toLowerCase()).toContain("expand");
	});
});

describe("earlierHint", () => {
	test("names the hidden count and the label", () => {
		const hint = earlierHint(fakeTheme, 3, "matches");
		expect(hint).toContain("… 3 earlier matches");
		expect(hint.toLowerCase()).toContain("expand");
	});
});

describe("TailResult", () => {
	const rowLine = (row: string, width: number): string => `${row}:${width}`;

	test("draws a leading blank line, the rows, and the overflow note", () => {
		const view = new TailResult<string>({ kind: "list", rows: ["a", "b"], more: 2, rowLine }, fakeTheme);
		const lines = view.render(40);
		expect(lines[0]).toBe("");
		expect(lines[1]).toBe("a:40");
		expect(lines[2]).toBe("b:40");
		expect(lines[3]).toContain("… 2 more");
	});

	test("draws the earlier note and the themed tail", () => {
		const view = new TailResult<string>(
			{ kind: "lines", lines: ["one", "two"], earlier: 5, earlierLabel: "lines" },
			fakeTheme,
		);
		const lines = view.render(40);
		expect(lines[0]).toBe("");
		expect(lines[1]).toContain("… 5 earlier lines");
		expect(lines[2]).toBe("one");
		expect(lines[3]).toBe("two");
	});

	test("clips every line to the render width", () => {
		const view = new TailResult<string>(
			{ kind: "lines", lines: ["x".repeat(20)], earlier: 0, earlierLabel: "lines" },
			fakeTheme,
		);
		expect(visibleWidth(view.render(10)[1] ?? "")).toBeLessThanOrEqual(10);
	});

	test("draws one group of rows per section, with a faint heading and a per-section overflow note", () => {
		const view = new TailResult<string>(
			{
				kind: "sections",
				sections: [
					{ rows: ["a"], more: 0, rowLine },
					{ label: "Claims", rows: ["b"], more: 2, rowLine },
				],
			},
			fakeTheme,
		);
		const lines = view.render(40);
		expect(lines[0]).toBe("");
		expect(lines[1]).toBe("a:40");
		expect(lines[2]).toBe("Claims");
		expect(lines[3]).toBe("b:40");
		expect(lines[4]).toContain("… 2 more");
	});

	test("clips a section heading to the render width", () => {
		const view = new TailResult<string>(
			{ kind: "sections", sections: [{ label: "C".repeat(20), rows: [], more: 0, rowLine }] },
			fakeTheme,
		);
		expect(visibleWidth(view.render(10)[1] ?? "")).toBeLessThanOrEqual(10);
	});

	test("updates in place for reuse", () => {
		const view = new TailResult<string>(
			{ kind: "lines", lines: ["old"], earlier: 0, earlierLabel: "lines" },
			fakeTheme,
		);
		view.setInput({ kind: "lines", lines: ["new"], earlier: 0, earlierLabel: "lines" }, fakeTheme);
		expect(view.render(40)).toEqual(["", "new"]);
	});

	test("serves a repeat frame from its memo, and rebuilds when the input moves", () => {
		// A frame re-renders every block, so this one is derived once and compared
		// once until its input, theme or width changes.
		let built = 0;
		const counted = (row: string, width: number): string => {
			built += 1;
			return `${row}:${width}`;
		};
		const view = new TailResult<string>({ kind: "list", rows: ["a"], more: 0, rowLine: counted }, fakeTheme);
		const first = view.render(40);
		expect(view.render(40)).toBe(first);
		expect(built).toBe(1);

		// `setInput` is the invalidation: the new rows are built, then held again.
		view.setInput({ kind: "list", rows: ["a", "b"], more: 0, rowLine: counted }, fakeTheme);
		expect(view.render(40)).toEqual(["", "a:40", "b:40"]);
		expect(built).toBe(3);

		// A new width is a new layout; `invalidate` drops it for a theme change.
		view.render(20);
		expect(built).toBe(5);
		view.invalidate();
		view.render(20);
		expect(built).toBe(7);
	});
});

describe("isTailResult", () => {
	test("recognises the kit's block through the erased row type", () => {
		// The extensions reuse their block through `context.lastComponent`, so the guard is
		// where the row type the caller drew is put back on the instance.
		const view = new TailResult<string>({ kind: "lines", lines: ["x"], earlier: 0, earlierLabel: "lines" }, fakeTheme);
		expect(isTailResult<string>(view)).toBe(true);
		expect(isTailResult<string>({ render: () => [] })).toBe(false);
		expect(isTailResult<string>(undefined)).toBe(false);
		expect(isTailResult<string>("TailResult")).toBe(false);
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

/** A build that counts, so a cache hit is proved by the count rather than the output. */
function counting(lines: string[] = ["a"]) {
	let builds = 0;
	return {
		build: () => {
			builds++;
			return lines;
		},
		builds: () => builds,
	};
}

describe("RenderCache", () => {
	test("returns the same lines while the width and the source are unchanged", () => {
		const cache = new RenderCache();
		const source = ["a"];
		const built = counting(["x"]);

		expect(cache.lines(40, source, built.build)).toBe(cache.lines(40, source, built.build));
	});

	test("does not rebuild on a hit", () => {
		const cache = new RenderCache();
		const source = ["a"];
		const built = counting();

		cache.lines(40, source, built.build);
		cache.lines(40, source, built.build);

		expect(built.builds()).toBe(1);
	});

	test("rebuilds when the width changes", () => {
		const cache = new RenderCache();
		const source = ["a"];
		const built = counting();

		cache.lines(40, source, built.build);
		cache.lines(41, source, built.build);

		expect(built.builds()).toBe(2);
	});

	test("rebuilds when the source array changes, even with the same content", () => {
		const cache = new RenderCache();
		const built = counting();

		cache.lines(40, ["a"], built.build);
		cache.lines(40, ["a"], built.build);

		expect(built.builds()).toBe(2);
	});

	test("rebuilds after invalidate even when nothing else changed", () => {
		const cache = new RenderCache();
		const source = ["a"];
		const built = counting();

		cache.lines(40, source, built.build);
		cache.invalidate();
		cache.lines(40, source, built.build);

		expect(built.builds()).toBe(2);
	});

	test("caches a component with no source on its width alone", () => {
		const cache = new RenderCache();
		const built = counting();

		expect(cache.lines(40, undefined, built.build)).toBe(cache.lines(40, undefined, built.build));
		expect(built.builds()).toBe(1);
	});

	test("drops the cached lines on invalidate", () => {
		const cache = new RenderCache();

		const first = cache.lines(40, undefined, () => ["x"]);
		cache.invalidate();

		expect(cache.lines(40, undefined, () => ["x"])).not.toBe(first);
	});
});
