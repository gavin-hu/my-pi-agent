import { describe, expect, test } from "bun:test";
import { buildLines } from "../../extensions/status-bar/lines.ts";
import { fakeTheme, fullSnapshot } from "./helpers.ts";

const ids = (segments: Array<{ id: string }>) => segments.map((segment) => segment.id);

describe("buildLines", () => {
	test("routes segments to the right zones", () => {
		const [line1, line2] = buildLines(fullSnapshot(), fakeTheme, "/home/u");

		expect(ids(line1.left)).toEqual(["pwd"]);
		expect(ids(line1.right)).toEqual(["branch", "worktree"]);
		expect(ids(line2.left)).toEqual(["context", "window", "cost", "tokens", "cache", "statuses"]);
		expect(ids(line2.right)).toEqual(["model", "thinking"]);
	});

	test("renders the full forms", () => {
		const [line1, line2] = buildLines(fullSnapshot(), fakeTheme, "/home/u");

		expect(line1.left[0].forms[0]).toBe("~/repo/project");
		expect(line1.right[0].forms[0]).toBe("⎇ main");
		expect(line1.right[0].separator).toBe(" · ");
		expect(line1.right[1].forms[0]).toBe("⧉ smoke");
		expect(line1.right[1].separator).toBe(" · ");

		expect(line2.left[0].forms[0]).toBe("▰▰▰▰▰▰▱▱▱▱ 62%");
		expect(line2.left[0].separator).toBe("");
		expect(line2.left[1].forms[0]).toBe("/200k");
		expect(line2.left[2].forms[0]).toBe("$0.31");
		expect(line2.left[3].forms[0]).toBe("↑42k ↓8.0k");
		expect(line2.left[4].forms[0]).toBe("R96k W0 CH 87%");
		expect(line2.left[5].forms[0]).toBe("⏸ plan");
		expect(line2.left[5].separator).toBe(" │ ");
		expect(line2.right[0].forms[0]).toBe("opus-4.5");
		expect(line2.right[1].forms[0]).toBe("high");
	});

	test("excludes worktree from the status alerts and routes it right", () => {
		const snapshot = fullSnapshot({ statuses: new Map([["worktree", "⧉ smoke"]]) });
		const [line1, line2] = buildLines(snapshot, fakeTheme, "/home/u");

		expect(ids(line1.right)).toEqual(["branch", "worktree"]);
		expect(ids(line2.left)).not.toContain("statuses");
		expect(ids(line2.left)[0]).toBe("context");
	});

	test("has no mode slot when there are no alerts", () => {
		const [, line2] = buildLines(fullSnapshot({ statuses: new Map() }), fakeTheme, "/home/u");

		expect(ids(line2.left)).not.toContain("statuses");
		expect(ids(line2.left)).not.toContain("auto");
		expect(line2.left[0].id).toBe("context");
	});

	test("omits the branch and worktree when absent", () => {
		const snapshot = fullSnapshot({ branch: null, statuses: new Map() });
		const [line1] = buildLines(snapshot, fakeTheme, "/home/u");

		expect(ids(line1.left)).toEqual(["pwd"]);
		expect(line1.right).toEqual([]);
	});

	test("shows the detached marker", () => {
		const [line1] = buildLines(fullSnapshot({ branch: "detached" }), fakeTheme, "/home/u");
		expect(line1.right[0].forms[0]).toBe("⚠ detached");
		expect(line1.right[0].forms[2]).toBe("⎇");
	});

	test("qualifies the model with the provider only when there are several", () => {
		const [line1, line2] = buildLines(fullSnapshot({ providerCount: 2 }), fakeTheme, "/home/u");
		expect(line2.right[0].forms[0]).toBe("(anthropic) opus-4.5");
		expect(line2.right[0].forms[1]).toBe("opus-4.5");
		expect(line1).toBeTruthy();
	});

	test("shows zero usage meters and ? for unknown context", () => {
		const snapshot = fullSnapshot({
			context: { tokens: null, contextWindow: 200000, percent: null },
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
			cacheHitRate: null,
		});
		const [, line2] = buildLines(snapshot, fakeTheme, "/home/u");

		expect(ids(line2.left)).toEqual(["context", "window", "cost", "tokens", "cache", "statuses"]);
		const byId = new Map(line2.left.map((segment) => [segment.id, segment]));
		expect(byId.get("context")!.forms[0]).toContain("?");
		expect(byId.get("cost")!.forms[0]).toBe("$0.00");
		expect(byId.get("tokens")!.forms[0]).toBe("↑0 ↓0");
		expect(byId.get("cache")!.forms[0]).toBe("R0 W0");
	});

	test("omits the thinking segment without a level", () => {
		const [, line2] = buildLines(fullSnapshot({ thinkingLevel: null }), fakeTheme, "/home/u");
		expect(ids(line2.right)).toEqual(["model"]);
	});
});
