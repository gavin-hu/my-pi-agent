import { describe, expect, test } from "bun:test";
import { GLYPHS, STATUS_KEYS } from "../../lib/ui.ts";
import { buildLines } from "./lines.ts";
import { stripAnsi } from "./format.ts";
import { fakeTheme, makeRecordingTheme } from "../../test/helpers/fakes.ts";
import { fullSnapshot } from "../../test/helpers/fixtures/status-bar.ts";

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
		expect(line1.right[1].forms[0]).toBe("⑂ smoke");
		expect(line1.right[1].separator).toBe(" · ");

		expect(line2.left[0].forms[0]).toBe("▰▰▰▰▰▰▱▱▱▱ 62%");
		expect(line2.left[0].separator).toBe("");
		expect(line2.left[1].forms[0]).toBe("/200k");
		expect(line2.left[2].forms[0]).toBe("$0.31");
		expect(line2.left[3].forms[0]).toBe("↑42k ↓8.0k");
		expect(line2.left[4].forms[0]).toBe("R96k CH 87%");
		expect(line2.left[5].forms[0]).toBe(`${GLYPHS.plan} plan`);
		expect(line2.left[5].separator).toBe(" │ ");
		expect(line2.right[0].forms[0]).toBe("opus-4.5");
		expect(line2.right[1].forms[0]).toBe("high");
	});

	test("excludes worktree from the status alerts and routes it right", () => {
		const snapshot = fullSnapshot({ statuses: new Map([[STATUS_KEYS.worktree, `${GLYPHS.worktree} smoke`]]) });
		const [line1, line2] = buildLines(snapshot, fakeTheme, "/home/u");

		expect(ids(line1.right)).toEqual(["branch", "worktree"]);
		expect(ids(line2.left)).not.toContain("statuses");
		expect(ids(line2.left)[0]).toBe("context");
	});

	test("has no mode slot when there are no alerts", () => {
		const [, line2] = buildLines(fullSnapshot({ statuses: new Map() }), fakeTheme, "/home/u");

		expect(ids(line2.left)).not.toContain("statuses");
		expect(line2.left[0].id).toBe("context");
	});

	test("routes the serve chip to line 1 right and out of the alerts", () => {
		const snapshot = fullSnapshot({ statuses: new Map([[STATUS_KEYS.serve, `${GLYPHS.serve} 4780`]]) });
		const [line1, line2] = buildLines(snapshot, fakeTheme, "/home/u");

		expect(ids(line1.left)).toEqual(["pwd"]);
		expect(ids(line1.right)).toEqual(["branch", "serve"]);
		expect(ids(line2.left)).not.toContain("statuses");
	});

	test("groups the serve chip with the worktree on line 1 right", () => {
		const statuses = new Map([
			[STATUS_KEYS.worktree, `${GLYPHS.worktree} smoke`],
			[STATUS_KEYS.serve, `${GLYPHS.serve} 4780`],
		]);
		const [line1] = buildLines(fullSnapshot({ statuses }), fakeTheme, "/home/u");

		expect(ids(line1.left)).toEqual(["pwd"]);
		expect(ids(line1.right)).toEqual(["branch", "worktree", "serve"]);
	});

	test("renders the serve chip with its port and a compact form", () => {
		const snapshot = fullSnapshot({ statuses: new Map([[STATUS_KEYS.serve, `${GLYPHS.serve} 4780`]]) });
		const [line1] = buildLines(snapshot, fakeTheme, "/home/u");
		const serve = line1.right.find((segment) => segment.id === "serve")!;

		expect(serve.forms).toEqual([`${GLYPHS.serve} 4780`, `${GLYPHS.serve}4780`, GLYPHS.serve]);
		expect(serve.separator).toBe(" · ");
	});

	test("omits zero-valued directions in the token meter", () => {
		const [, line2] = buildLines(
			fullSnapshot({ usage: { input: 42000, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0.31 } }),
			fakeTheme,
			"/home/u",
		);
		const tokens = line2.left.find((segment) => segment.id === "tokens")!;

		expect(tokens.forms[0]).toBe("↑42k");
	});

	test("omits zero-valued cache components", () => {
		const [, line2] = buildLines(
			fullSnapshot({
				usage: { input: 0, output: 0, cacheRead: 96000, cacheWrite: 0, cost: 0 },
				cacheHitRate: 87,
			}),
			fakeTheme,
			"/home/u",
		);
		const cache = line2.left.find((segment) => segment.id === "cache")!;

		expect(cache.forms[0]).toBe("R96k CH 87%");
	});

	test("omits the cache segment when nothing was cached, even at a 0% hit rate", () => {
		const [, line2] = buildLines(
			fullSnapshot({
				usage: { input: 100, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
				cacheHitRate: 0,
			}),
			fakeTheme,
			"/home/u",
		);

		expect(ids(line2.left)).not.toContain("cache");
	});

	test("shows cache tokens without a hit rate when no rate is known", () => {
		const [, line2] = buildLines(
			fullSnapshot({
				usage: { input: 0, output: 0, cacheRead: 96000, cacheWrite: 0, cost: 0 },
				cacheHitRate: null,
			}),
			fakeTheme,
			"/home/u",
		);
		const cache = line2.left.find((segment) => segment.id === "cache")!;

		expect(cache.forms[0]).toBe("R96k");
	});

	test("omits the branch and worktree when absent", () => {
		const snapshot = fullSnapshot({ branch: null, statuses: new Map() });
		const [line1] = buildLines(snapshot, fakeTheme, "/home/u");

		expect(ids(line1.left)).toEqual(["pwd"]);
		expect(line1.right).toEqual([]);
	});

	test("shows the detached marker", () => {
		const [line1] = buildLines(fullSnapshot({ branch: "detached" }), fakeTheme, "/home/u");
		expect(line1.right[0].forms).toEqual(["⚠ detached"]);
	});

	test("qualifies the model with the provider only when there are several", () => {
		const [line1, line2] = buildLines(fullSnapshot({ providerCount: 2 }), fakeTheme, "/home/u");
		expect(line2.right[0].forms[0]).toBe("(anthropic) opus-4.5");
		expect(line2.right[0].forms[1]).toBe("opus-4.5");
		expect(line1).toBeTruthy();
	});

	test("omits zero-value meters on a fresh session", () => {
		const snapshot = fullSnapshot({
			context: { tokens: null, contextWindow: 200000, percent: null },
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
			cacheHitRate: null,
		});
		const [, line2] = buildLines(snapshot, fakeTheme, "/home/u");

		expect(ids(line2.left)).toEqual(["context", "window", "statuses"]);
		const byId = new Map(line2.left.map((segment) => [segment.id, segment]));
		expect(byId.get("context")!.forms[0]).toContain("?");
	});

	test("strips color when compacting themed statuses", () => {
		const themed = `\x1b[33m${GLYPHS.plan} plan\x1b[39m`;
		const [, line2] = buildLines(
			fullSnapshot({ statuses: new Map([[STATUS_KEYS.planMode, themed]]) }),
			fakeTheme,
			"/home/u",
		);
		const statuses = line2.left.find((segment) => segment.id === "statuses")!;

		expect(statuses.forms[0]).toContain(themed);
		expect(statuses.forms[1]).toBe(GLYPHS.plan);
	});

	test("drops the plan file name from the plan status chip", () => {
		const themed = `\x1b[33m${GLYPHS.plan} plan · add-rate-limiting\x1b[39m`;
		const [, line2] = buildLines(
			fullSnapshot({ statuses: new Map([[STATUS_KEYS.planMode, themed]]) }),
			fakeTheme,
			"/home/u",
		);
		const statuses = line2.left.find((segment) => segment.id === "statuses")!;

		expect(stripAnsi(statuses.forms[0])).toBe(`${GLYPHS.plan} plan`);
		expect(statuses.forms[1]).toBe(GLYPHS.plan);
	});

	test("keeps a trailing count when compacting a badge status", () => {
		const snapshot = fullSnapshot({ statuses: new Map([[STATUS_KEYS.rewind, `${GLYPHS.rewind} 2`]]) });
		const [, line2] = buildLines(snapshot, fakeTheme, "/home/u");
		const statuses = line2.left.find((segment) => segment.id === "statuses")!;

		expect(statuses.forms[0]).toBe("↺ 2");
		expect(statuses.forms[1]).toBe("↺2");
	});

	test("renders the wechat chip in the statuses slot and compacts to its glyph", () => {
		const snapshot = fullSnapshot({ statuses: new Map([[STATUS_KEYS.wechat, `${GLYPHS.wechat} wechat`]]) });
		const [, line2] = buildLines(snapshot, fakeTheme, "/home/u");
		const statuses = line2.left.find((segment) => segment.id === "statuses")!;

		expect(statuses.forms[0]).toBe(`${GLYPHS.wechat} wechat`);
		expect(statuses.forms[1]).toBe(GLYPHS.wechat);
	});

	test("renders the jobs running and failure chips as separate segments", () => {
		const snapshot = fullSnapshot({
			statuses: new Map([
				[STATUS_KEYS.jobs, "▸ 1"],
				[STATUS_KEYS.jobsFailure, "✗ 1"],
			]),
		});
		const [, line2] = buildLines(snapshot, fakeTheme, "/home/u");
		const statuses = line2.left.find((segment) => segment.id === "statuses")!;
		expect(statuses.forms[0]).toBe("▸ 1 · ✗ 1");
		// Each chip compacts to glyph+count independently.
		expect(statuses.forms[1]).toBe("▸1 ✗1");
	});

	test("orders multiple statuses by key", () => {
		const snapshot = fullSnapshot({
			statuses: new Map([
				["zeta", "Z"],
				["alpha", "A"],
			]),
		});
		const [, line2] = buildLines(snapshot, fakeTheme, "/home/u");
		const statuses = line2.left.find((segment) => segment.id === "statuses")!;

		expect(statuses.forms[0]).toBe("A · Z");
	});

	test("handles an icon-only worktree status without duplicating the icon", () => {
		const [line1] = buildLines(fullSnapshot({ statuses: new Map([["worktree", "⑂"]]) }), fakeTheme, "/home/u");
		const worktree = line1.right.find((segment) => segment.id === "worktree")!;

		expect(worktree.forms).toEqual(["⑂"]);
	});

	test("shows the thinking level, including off for a reasoning model", () => {
		const [, line2] = buildLines(fullSnapshot({ thinkingLevel: null }), fakeTheme, "/home/u");
		expect(ids(line2.right)).toEqual(["model", "thinking"]);
		expect(line2.right[1].forms).toEqual(["off"]);
	});

	test("omits the thinking segment for a non-reasoning model", () => {
		const snapshot = fullSnapshot({ model: { id: "gpt-4o", provider: "openai", reasoning: false } });
		const [, line2] = buildLines(snapshot, fakeTheme, "/home/u");
		expect(ids(line2.right)).toEqual(["model"]);
	});

	test("adds the session name to the identity line and compacts it", () => {
		const snapshot = fullSnapshot({ sessionName: "feature-refactor-session" });
		const [line1] = buildLines(snapshot, fakeTheme, "/home/u");
		const session = line1.left.find((segment) => segment.id === "session")!;

		expect(ids(line1.left)).toEqual(["pwd", "session"]);
		expect(session.forms).toEqual(["feature-refactor-session", "feature-refac…"]);
	});

	test("omits the session segment when unnamed", () => {
		const [line1] = buildLines(fullSnapshot(), fakeTheme, "/home/u");
		expect(ids(line1.left)).toEqual(["pwd"]);
	});
});

describe("buildLines theme tokens", () => {
	test("colors the gauge by context severity", () => {
		const theme = makeRecordingTheme() as any;
		buildLines(fullSnapshot({ context: { tokens: 190000, contextWindow: 200000, percent: 95 } }), theme, "/home/u");

		expect(theme.calls).toContainEqual(["error", "95%"]);
	});

	test("marks a detached head as a warning", () => {
		const theme = makeRecordingTheme() as any;
		buildLines(fullSnapshot({ branch: "detached" }), theme, "/home/u");

		expect(theme.calls).toContainEqual(["warning", "⚠ detached"]);
	});

	test("colors the model with the accent token", () => {
		const theme = makeRecordingTheme() as any;
		buildLines(fullSnapshot(), theme, "/home/u");

		expect(theme.calls).toContainEqual(["accent", "opus-4.5"]);
	});
});
