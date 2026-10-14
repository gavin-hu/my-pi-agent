import { describe, expect, test } from "bun:test";
import { fakeTheme } from "../../test/helpers/fakes.ts";
import { WatchListComponent, WatchResult } from "./tui.ts";
import type { WatchRecord } from "./types.ts";

function record(overrides: Partial<WatchRecord> = {}): WatchRecord {
	return {
		id: "w1",
		label: "errors",
		source: { kind: "file", path: "/tmp/app.log" },
		pattern: "error",
		exclude: [],
		caseSensitive: false,
		wake: false,
		fromStart: false,
		status: "running",
		startedAt: 0,
		linesRead: 0,
		matchCount: 0,
		...overrides,
	};
}

describe("WatchResult", () => {
	test("list rows start with a blank line and name each watcher", () => {
		const view = new WatchResult({ kind: "list", watches: [record()], more: 0 }, fakeTheme);
		const lines = view.render(80);
		expect(lines[0]).toBe("");
		expect(lines.join("\n")).toContain("w1");
		expect(lines.join("\n")).toContain("errors");
	});

	test("notes hidden rows and matched lines", () => {
		const more = new WatchResult({ kind: "list", watches: [record()], more: 2 }, fakeTheme).render(80);
		expect(more.join("\n")).toContain("2 more");

		const lines = new WatchResult(
			{ kind: "lines", label: "matches", lines: ["error: boom"], earlier: 3 },
			fakeTheme,
		).render(80);
		expect(lines[0]).toBe("");
		expect(lines.join("\n")).toContain("3 earlier matches");
		expect(lines.join("\n")).toContain("error: boom");
	});
});

describe("WatchListComponent", () => {
	function build(onStop: (id: string) => void = () => {}) {
		const watches = [record()];
		return new WatchListComponent(
			() => watches,
			fakeTheme,
			{ lines: () => ({ lines: ["error: boom"], more: false }), stop: onStop, clear: () => {} },
			() => {},
			() => {},
			24,
		);
	}

	test("renders the header and watcher rows", () => {
		const lines = build().render(80);
		expect(lines[0]).toContain("Watch");
		expect(lines.join("\n")).toContain("w1");
	});

	test("opening a watcher shows its matches", () => {
		const component = build();
		component.handleInput("l");
		expect(component.currentLineId()).toBe("w1");
		expect(component.render(80).join("\n")).toContain("error: boom");
	});

	test("stopping a running watcher asks for confirmation", () => {
		const stopped: string[] = [];
		const component = build((id) => stopped.push(id));
		component.handleInput("x");
		expect(component.render(80).join("\n")).toContain("Stop w1");
		component.handleInput("y");
		expect(stopped).toEqual(["w1"]);
	});
});
