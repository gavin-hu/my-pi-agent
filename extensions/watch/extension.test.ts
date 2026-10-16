import { afterEach, describe, expect, test } from "bun:test";
import { ENV_DISABLED_EXTENSIONS } from "../../lib/env.ts";
import { NOTICE_TYPE } from "../../lib/notice.ts";
import { STATUS_KEYS } from "../../lib/tui/glyphs.ts";
import { createFakePi, emit, emitFirst, type AnyHandler } from "../../test/helpers/fakes.ts";
import { withEnv } from "../../test/helpers/env.ts";
import { makeCtx, makeHarnessSuite } from "../../test/helpers/fixtures/watch.ts";
import watch, { buildWatchContext } from "./index.ts";
import { TOOL_NAME } from "./tools.ts";
import type { PendingMatch } from "./types.ts";

const suite = makeHarnessSuite();
afterEach(() => suite.cleanup());

function setup() {
	const h = suite.makeHarness();
	const { pi, tools, commands, handlers } = createFakePi();
	watch(pi, { runtime: h.runtime });
	const { ctx, statuses, notices } = makeCtx();
	return { h, pi, tools, commands, handlers, ctx, statuses, notices };
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
		const { h, pi, ctx } = setup();
		const sent: Array<{ message: any; options: any }> = [];
		pi.sendMessage = (message: any, options: any) => sent.push({ message, options });

		await emit(pi, "session_start", {}, ctx);
		h.runtime.add({ command: "build", pattern: "FAIL", wake: true }, ctx);
		h.children[0].write("FAIL\n");

		expect(sent).toHaveLength(1);
		expect(sent[0].options.triggerTurn).toBe(true);
		expect(sent[0].message.customType).toBe(NOTICE_TYPE);
	});

	test("does not wake for a non-wake watcher", async () => {
		const { h, pi, ctx } = setup();
		const sent: unknown[] = [];
		pi.sendMessage = (...args: unknown[]) => sent.push(args);
		await emit(pi, "session_start", {}, ctx);
		h.runtime.add({ command: "build", pattern: "FAIL" }, ctx);
		h.children[0].write("FAIL\n");
		expect(sent).toHaveLength(0);
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
		expect(result.messages.filter((m: any) => m.details?.source === "watch").map((m: any) => m.content)).toEqual([
			"new",
		]);
	});

	test("clears the status chips on shutdown", async () => {
		const { h, pi, ctx, statuses } = setup();
		await emit(pi, "session_start", {}, ctx);
		h.runtime.add({ command: "build", pattern: "FAIL" }, ctx);
		h.children[0].write("FAIL\n");
		h.runtime.setStatus(ctx);
		expect(statuses.get(STATUS_KEYS.watchMatches)).toBe("! 1");

		for (const handler of (pi.handlers.get("session_shutdown") ?? []) as AnyHandler[]) await handler({}, ctx);
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
