import { afterEach, describe, expect, test } from "bun:test";
import { ENV_DISABLED_EXTENSIONS } from "../../lib/env.ts";
import { WATCH_MATCH_CHANNEL } from "../../lib/events.ts";
import { NOTICE_TYPE } from "../../lib/notice.ts";
import { GLYPHS, STATUS_KEYS } from "../../lib/tui/glyphs.ts";
import { createFakePi, emit, emitFirst, fakeTheme } from "../../test/helpers/fakes.ts";
import { withEnv } from "../../test/helpers/env.ts";
import { makeCtx, makeHarnessSuite } from "../../test/helpers/fixtures/watch.ts";
import { DEFAULT_CONFIG } from "./config.ts";
import {
	compileRegex,
	formatCallText,
	formatPendingMatch,
	formatTail,
	formatWatchDetail,
	formatWatchList,
	formatWatchOutcomeLine,
	formatWatchStatus,
	shortLabel,
	sourceLabel,
	statusGlyphChar,
	statusRole,
	statusWord,
} from "./format.ts";
import watch, { buildWatchContext } from "./index.ts";
import { TOOL_NAME } from "./tools.ts";
import { WatchListComponent, WatchResult } from "./tui.ts";
import type { PendingMatch, WatchRecord } from "./types.ts";
import { createUiController } from "./ui.ts";

const suite = makeHarnessSuite();
afterEach(() => suite.cleanup());

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
		startedAt: 1000,
		linesRead: 3,
		matchCount: 1,
		...overrides,
	};
}

function setup() {
	const h = suite.makeHarness();
	const { pi, tools, commands, handlers, customMessages } = createFakePi();
	watch(pi, { runtime: h.runtime });
	const { ctx, statuses, notices } = makeCtx();
	return { h, pi, tools, commands, handlers, customMessages, ctx, statuses, notices };
}

describe("watch extension", () => {
	test("registers nothing when disabled", async () => {
		await withEnv({ [ENV_DISABLED_EXTENSIONS]: "watch" }, () => {
			const { pi, tools, commands, handlers } = createFakePi();
			watch(pi);
			expect(tools.size).toBe(0);
			expect(commands.size).toBe(0);
			expect(handlers.size).toBe(0);
		});
	});

	test("registers the tool and the /watch command", () => {
		const { tools, commands } = setup();
		expect(tools.has(TOOL_NAME)).toBe(true);
		expect(commands.has("watch")).toBe(true);
	});

	test("injects matched lines before the next turn", async () => {
		const { h, pi, ctx } = setup();
		await emit(pi, "session_start", {}, ctx);
		h.runtime.add({ command: "build", pattern: "FAIL", label: "ci" }, ctx);
		h.children[0].write("FAIL: one\n");

		const result = await emitFirst(pi, "before_agent_start", {}, ctx);
		expect(result?.message?.customType).toBe(NOTICE_TYPE);
		expect(result?.message?.display).toBe(true);
		expect(result?.message?.details?.source).toBe("watch");
		expect(result?.message?.content).toContain("[WATCH MATCHES]");
		expect(result?.message?.content).toContain("w1");
		expect(result?.message?.content).toContain("FAIL: one");
	});

	test("wakes the agent when a wake watcher matches while idle", async () => {
		const { h, pi, customMessages, ctx } = setup();
		await emit(pi, "session_start", {}, ctx);
		h.runtime.add({ command: "build", pattern: "FAIL", wake: true }, ctx);
		h.children[0].write("FAIL\n");

		expect(customMessages).toHaveLength(1);
		expect(customMessages[0].options).toMatchObject({ triggerTurn: true });
		expect(customMessages[0].message.customType).toBe(NOTICE_TYPE);
	});

	test("a mid-turn match wakes once when the run settles, carrying the burst", async () => {
		const { h, pi, ctx, customMessages } = setup();
		const seen: unknown[] = [];
		pi.events.on(WATCH_MATCH_CHANNEL, (data: unknown) => seen.push(data));

		await emit(pi, "session_start", {}, ctx);
		h.runtime.add({ command: "build", pattern: "FAIL", label: "ci", wake: true }, ctx);

		// Both matches arrive during a run; the settle retry raises one turn for the
		// whole burst, describing its newest match.
		await emit(pi, "agent_start", {}, ctx);
		h.children[0].write("FAIL: one\n");
		h.children[0].write("FAIL: two\n");
		expect(seen).toEqual([]);
		expect(customMessages).toHaveLength(0);

		await emit(pi, "agent_settled", { aborted: false }, ctx);

		expect(customMessages).toHaveLength(1);
		expect(customMessages[0]?.options).toMatchObject({ triggerTurn: true });
		expect(seen).toHaveLength(1);
		expect(seen[0]).toMatchObject({ count: 2, label: "ci", line: "FAIL: two" });
		expect((seen[0] as { watcherId: string }).watcherId).toMatch(/^w\d+$/);
		// The settle retry already reported it, so the next turn adds nothing.
		expect(await emitFirst(pi, "before_agent_start", {}, ctx)).toBeUndefined();
	});

	test("an aborted run leaves a wake match for the next turn", async () => {
		const { h, pi, ctx, customMessages } = setup();
		await emit(pi, "session_start", {}, ctx);
		h.runtime.add({ command: "build", pattern: "FAIL", wake: true }, ctx);
		await emit(pi, "agent_start", {}, ctx);
		h.children[0].write("FAIL\n");

		await emit(pi, "agent_settled", { aborted: true }, ctx);
		expect(customMessages).toHaveLength(0);

		const result = await emitFirst(pi, "before_agent_start", {}, ctx);
		expect(result?.message?.content).toContain("FAIL");
	});

	test("does not announce a match it did not wake for", async () => {
		const { h, pi, ctx } = setup();
		const seen: unknown[] = [];
		pi.events.on(WATCH_MATCH_CHANNEL, (data: unknown) => seen.push(data));

		await emit(pi, "session_start", {}, ctx);
		h.runtime.add({ command: "build", pattern: "FAIL" }, ctx);
		h.children[0].write("FAIL\n");

		expect(seen).toEqual([]);
	});

	test("a throwing listener still wakes the agent", async () => {
		const { h, pi, customMessages, ctx } = setup();
		pi.events.on(WATCH_MATCH_CHANNEL, () => {
			throw new Error("listener exploded");
		});

		await emit(pi, "session_start", {}, ctx);
		h.runtime.add({ command: "build", pattern: "FAIL", wake: true }, ctx);
		h.children[0].write("FAIL\n");

		expect(customMessages).toHaveLength(1);
	});

	test("does not wake for a non-wake watcher", async () => {
		const { h, pi, customMessages, ctx } = setup();
		await emit(pi, "session_start", {}, ctx);
		h.runtime.add({ command: "build", pattern: "FAIL" }, ctx);
		h.children[0].write("FAIL\n");
		expect(customMessages).toHaveLength(0);
	});

	test("a failed wake leaves the match for the next turn", async () => {
		const { h, pi, ctx } = setup();
		pi.sendMessage = () => {
			throw new Error("busy");
		};
		await emit(pi, "session_start", {}, ctx);
		h.runtime.add({ command: "build", pattern: "FAIL", wake: true }, ctx);
		h.children[0].write("FAIL\n");

		const result = await emitFirst(pi, "before_agent_start", {}, ctx);
		expect(result?.message?.content).toContain("FAIL");
	});

	test("keeps only the newest injected match note in context", async () => {
		const { pi, ctx } = setup();
		const note = (content: string) => ({
			role: "custom",
			customType: NOTICE_TYPE,
			content,
			display: true,
			details: { source: "watch", title: content },
		});
		const messages = [{ role: "user", content: "hi" }, note("old"), note("new")];
		const result = await emitFirst(pi, "context", { messages }, ctx);
		expect(result.messages).toHaveLength(2);
		expect(
			result.messages
				.filter((message: { details?: { source?: string } }) => message.details?.source === "watch")
				.map((message: { content: string }) => message.content),
		).toEqual(["new"]);
	});

	test("clears the status chips on shutdown", async () => {
		const { h, pi, ctx, statuses } = setup();
		await emit(pi, "session_start", {}, ctx);
		h.runtime.add({ command: "build", pattern: "FAIL" }, ctx);
		h.children[0].write("FAIL\n");
		h.runtime.setStatus(ctx);
		expect(statuses.get(STATUS_KEYS.watch)).toBe(`${GLYPHS.target} 1`);
		expect(statuses.get(STATUS_KEYS.watchMatches)).toBe(`${GLYPHS.warn} 1`);

		await emit(pi, "session_shutdown", {}, ctx);
		expect(statuses.has(STATUS_KEYS.watch)).toBe(false);
		expect(statuses.has(STATUS_KEYS.watchMatches)).toBe(false);
	});
});

describe("buildWatchContext", () => {
	test("caps the injected lines and notes the rest", () => {
		const matches: PendingMatch[] = Array.from({ length: 25 }, (_, i) => ({
			watcherId: "w1",
			label: "ci",
			seq: i + 1,
			line: `line ${i + 1}`,
			at: i,
		}));
		const text = buildWatchContext(matches);
		expect(text).toContain("25 watched lines matched");
		expect(text).toContain("line 20");
		expect(text).not.toContain("line 21");
		expect(text).toContain("5 more matches");
	});
});

describe("watch formatting", () => {
	test("compileRegex is case-insensitive by default and sensitive on request", () => {
		expect(compileRegex("error", false).test("ERROR")).toBe(true);
		expect(compileRegex("error", true).test("ERROR")).toBe(false);
	});

	test("sourceLabel names a file or a command", () => {
		expect(sourceLabel(record())).toBe("/tmp/app.log");
		expect(sourceLabel(record({ source: { kind: "command", command: "tail -f x" } }))).toBe("$ tail -f x");
	});

	test("shortLabel prefers the label and falls back to the source", () => {
		expect(shortLabel(record())).toBe("errors");
		expect(shortLabel(record({ label: "" }))).toBe("/tmp/app.log");
	});

	test("statusWord includes an exit code or an error", () => {
		expect(statusWord(record({ status: "exited", exitCode: 2 }))).toBe("exited (2)");
		expect(statusWord(record({ status: "error", error: "boom" }))).toBe("error (boom)");
		expect(statusWord(record({ status: "stopped" }))).toBe("stopped");
	});

	test("each status has its own role and glyph", () => {
		const statuses = ["running", "exited", "stopped", "error"] as const;
		expect(statuses.map(statusRole)).toEqual(["accent", "ok", "meta", "bad"]);
		expect(statuses.map(statusGlyphChar)).toEqual([GLYPHS.target, GLYPHS.check, GLYPHS.stopped, GLYPHS.warn]);
	});

	test("formatWatchList says so when there are none", () => {
		expect(formatWatchList([])).toBe("No watchers.");
	});

	test("formatWatchList includes the id, match count, and label", () => {
		const text = formatWatchList([record()], 5000);
		expect(text).toContain("w1");
		expect(text).toContain("1 match");
		expect(text).toContain("errors");
	});

	test("formatWatchStatus reports the pattern, source, and counts", () => {
		const text = formatWatchStatus(record(), 5000);
		expect(text).toContain("w1: running");
		expect(text).toContain("pattern: /error/i");
		expect(text).toContain("lines: 3");
		expect(text).toContain("matches: 1");
	});

	test("formatTail notes an empty tail", () => {
		expect(formatTail("matches", record(), [], 1000).text).toContain("no matches yet");
	});

	test("formatTail truncates from the front and reports it", () => {
		const lines = ["aaaa", "bbbb", "cccc"];
		const result = formatTail("matches", record(), lines, 9);
		expect(result.truncated).toBe(true);
		expect(result.text).not.toContain("aaaa");
		expect(result.text).toContain("bbbb");
	});

	test("formatCallText summarizes an add with its source and pattern", () => {
		expect(formatCallText("add", { path: "app.log", pattern: "error" })).toBe("add app.log /error/");
		expect(formatCallText("add", { command: "tail -f x", pattern: "boom" })).toBe("add $ tail -f x /boom/");
		expect(formatCallText("add", {}, false)).toBe("add …");
	});

	test("formatCallText summarizes an id action and clear", () => {
		expect(formatCallText("stop", { id: "w1" })).toBe("stop w1");
		expect(formatCallText("clear", { all: true })).toBe("clear all");
		expect(formatCallText("clear", {})).toBe("clear stopped");
	});

	test("formatWatchDetail names the source, pattern, and counts", () => {
		const lines = formatWatchDetail(record(), 5000);
		expect(lines[0]).toBe("/tmp/app.log · /error/i");
		expect(lines[1]).toBe("running · 3 lines · 1 matches · 4s");
	});

	test("formatWatchOutcomeLine leads with the status glyph and id", () => {
		const text = formatWatchOutcomeLine(record({ matchCount: 2 }), fakeTheme, 5000);
		expect(text).toContain(`${GLYPHS.target} w1 errors`);
		expect(text).toContain("2 matches");
		expect(text).toContain("4s");
	});

	test("formatPendingMatch names the watcher and the matched line", () => {
		expect(formatPendingMatch({ watcherId: "w1", label: "errors", seq: 1, line: "boom", at: 0 })).toBe(
			"w1 (errors): boom",
		);
	});
});

describe("watch status chips", () => {
	function controller(getConfig: () => typeof DEFAULT_CONFIG, getUnseen = () => 2) {
		return createUiController({
			getWatches: () => [record(), record({ id: "w2", status: "stopped" })],
			getUnseenMatches: getUnseen,
			getConfig,
		});
	}

	test("counts running watchers and unseen matches", () => {
		const { ctx, statuses } = makeCtx();
		controller(() => DEFAULT_CONFIG).setStatus(ctx);

		expect(statuses.get(STATUS_KEYS.watch)).toBe(`${GLYPHS.target} 1`);
		expect(statuses.get(STATUS_KEYS.watchMatches)).toBe(`${GLYPHS.warn} 2`);
	});

	test("clears both chips when the status is disabled", () => {
		const { ctx, statuses } = makeCtx();
		let config = DEFAULT_CONFIG;
		const ui = controller(() => config);
		ui.attach(ctx);
		ui.paint();
		expect(statuses.has(STATUS_KEYS.watch)).toBe(true);

		config = { ...DEFAULT_CONFIG, showStatus: false };
		ui.paint();
		expect(statuses.has(STATUS_KEYS.watch)).toBe(false);
		expect(statuses.has(STATUS_KEYS.watchMatches)).toBe(false);
	});

	test("notifyMatch names the watcher and the matched line", () => {
		const { ctx, notices } = makeCtx();
		const ui = controller(() => DEFAULT_CONFIG);
		ui.attach(ctx);
		ui.notifyMatch(record(), "error: boom");

		expect(notices.at(-1)).toEqual({ message: "watch w1 (errors) matched: error: boom", kind: "warning" });
	});
});

describe("watch transcript view", () => {
	test("WatchResult list rail carries each watcher's status glyph, id, and label", () => {
		const lines = new WatchResult(
			{ kind: "list", watches: [record(), record({ id: "w2", status: "stopped" })], more: 0 },
			fakeTheme,
		)
			.render(80)
			.join("\n");
		expect(lines).toContain(`${GLYPHS.target} w1`);
		expect(lines).toContain(`${GLYPHS.stopped} w2`);
		expect(lines).toContain("errors");
	});

	test("WatchResult labels the earlier-line note with the caller's kind", () => {
		const lines = new WatchResult({ kind: "lines", label: "output", lines: ["ok"], earlier: 3 }, fakeTheme)
			.render(80)
			.join("\n");
		expect(lines).toContain("3 earlier output");
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
