import { afterEach, describe, expect, test } from "bun:test";
import jobs from "./index.ts";
import { TOOL_NAME } from "./tools.ts";
import { createFakePi, emit, emitFirst, type AnyHandler } from "../../test/helpers/fakes.ts";
import { withEnv } from "../../test/helpers/env.ts";
import { ENV_DISABLED_EXTENSIONS } from "../../lib/env.ts";
import { JOB_FINISHED_CHANNEL } from "../../lib/events.ts";
import { NOTICE_TYPE } from "../../lib/notice.ts";
import { makeCtx, makeHarnessSuite } from "../../test/helpers/fixtures/job.ts";

const suite = makeHarnessSuite();
const makeHarness = suite.makeHarness;
afterEach(() => suite.cleanup());

function setup() {
	const h = makeHarness();
	const { pi, tools, commands, handlers } = createFakePi();
	jobs(pi, { runtime: h.runtime });
	const { ctx, statuses, widgets } = makeCtx();
	return { h, pi, tools, commands, handlers, ctx, statuses, widgets };
}

describe("jobs extension", () => {
	test("registers nothing when disabled through PI_DISABLED_EXTENSIONS", async () => {
		await withEnv({ [ENV_DISABLED_EXTENSIONS]: "job" }, () => {
			const { pi, tools, commands, handlers } = createFakePi();
			jobs(pi);
			expect(tools.size).toBe(0);
			expect(commands.size).toBe(0);
			expect(handlers.size).toBe(0);
		});
	});

	test("registers the tool and the /jobs command", () => {
		const { tools, commands } = setup();
		expect(tools.has(TOOL_NAME)).toBe(true);
		expect(commands.has("jobs")).toBe(true);
	});

	test("loads the registry on session start", async () => {
		const { pi, ctx, statuses } = setup();
		for (const handler of (pi.handlers.get("session_start") ?? []) as AnyHandler[]) await handler({}, ctx);
		expect(statuses.has("jobs")).toBe(false);
	});

	test("injects a completion note before the next turn", async () => {
		const { h, pi, ctx } = setup();
		await emit(pi, "session_start", {}, ctx);
		h.runtime.start({ command: "sleep 1" }, ctx);
		h.children[0].close(0);

		const result = await emitFirst(pi, "before_agent_start", {}, ctx);
		expect(result?.message?.customType).toBe(NOTICE_TYPE);
		expect(result?.message?.display).toBe(true);
		expect(result?.message?.details?.source).toBe("job");
		expect(result?.message?.content).toContain("j1");
		expect(result?.message?.content).toContain("[BACKGROUND JOBS]");
	});

	test("publishes a finished job on the event bus", async () => {
		const { h, pi, ctx } = setup();
		await emit(pi, "session_start", {}, ctx);
		const seen: unknown[] = [];
		pi.events.on(JOB_FINISHED_CHANNEL, (data: unknown) => seen.push(data));
		h.runtime.start({ command: "sleep 1", label: "build" }, ctx);
		h.children[0].close(2);
		expect(seen).toEqual([{ id: "j1", label: "build", status: "failed", exitCode: 2, signal: null }]);
	});

	test("keeps only the newest injected completion note in context", async () => {
		const { pi, ctx } = setup();
		const note = (source: string, content: string) => ({
			role: "custom",
			customType: NOTICE_TYPE,
			content,
			display: true,
			details: { source, title: content },
		});
		const messages = [{ role: "user", content: "hi" }, note("job", "old"), note("watch", "seen"), note("job", "new")];
		const result = await emitFirst(pi, "context", { messages }, ctx);
		expect(result.messages).toHaveLength(3);
		// Another source's notice is left alone.
		expect(result.messages.some((m: any) => m.details?.source === "watch")).toBe(true);
		expect(result.messages.filter((m: any) => m.details?.source === "job").map((m: any) => m.content)).toEqual(["new"]);
	});

	test("wakes the agent when a wake job finishes while idle", async () => {
		const { h, pi, ctx } = setup();
		const sent: Array<{ message: any; options: any }> = [];
		pi.sendMessage = (message: any, options: any) => sent.push({ message, options });

		await emit(pi, "session_start", {}, ctx);
		h.runtime.start({ command: "sleep 1", wake: true }, ctx);
		h.children[0].close(0);

		expect(sent).toHaveLength(1);
		expect(sent[0].options.triggerTurn).toBe(true);
		expect(sent[0].message.customType).toBe(NOTICE_TYPE);
	});

	test("wake reports other pending completions instead of dropping them", async () => {
		const { h, pi, ctx } = setup();
		const sent: Array<{ message: any }> = [];
		pi.sendMessage = (message: any) => sent.push({ message });

		await emit(pi, "session_start", {}, ctx);
		// j1 finishes first and is not yet reported; j2 wakes the agent.
		h.runtime.start({ command: "a" }, ctx);
		h.runtime.start({ command: "b", wake: true }, ctx);
		h.children[0].close(0);
		h.children[1].close(0);

		expect(sent).toHaveLength(1);
		expect(sent[0].message.content).toContain("j1");
		expect(sent[0].message.content).toContain("j2");
	});

	test("a failed wake leaves the completion for the next turn", async () => {
		const { h, pi, ctx } = setup();
		pi.sendMessage = () => {
			throw new Error("session busy");
		};
		await emit(pi, "session_start", {}, ctx);
		h.runtime.start({ command: "sleep 1", wake: true }, ctx);
		h.children[0].close(0);

		// The wake send threw, so the completion is still unreported.
		const result = await emitFirst(pi, "before_agent_start", {}, ctx);
		expect(result?.message?.content).toContain("j1");
	});

	test("does not wake for a non-wake job", async () => {
		const { h, pi, ctx } = setup();
		const sent: unknown[] = [];
		pi.sendMessage = (...args: unknown[]) => sent.push(args);
		await emit(pi, "session_start", {}, ctx);
		h.runtime.start({ command: "sleep 1" }, ctx);
		h.children[0].close(0);
		expect(sent).toHaveLength(0);
	});

	test("re-arms wake handling after a session replacement", async () => {
		const { h, pi, ctx } = setup();
		const sent: unknown[] = [];
		pi.sendMessage = (...args: unknown[]) => sent.push(args);
		await emit(pi, "session_start", {}, ctx);
		for (const handler of (pi.handlers.get("session_shutdown") ?? []) as AnyHandler[]) await handler({}, ctx);
		// The runtime is reused on the next session; onFinish must be re-armed.
		await emit(pi, "session_start", {}, ctx);
		h.runtime.start({ command: "sleep 1", wake: true }, ctx);
		h.children[0].close(0);
		expect(sent).toHaveLength(1);
	});

	test("does not mount an above-editor widget in a TUI session", () => {
		const h = makeHarness();
		const { pi } = createFakePi();
		jobs(pi, { runtime: h.runtime });
		const { ctx, widgets } = makeCtx({ mode: "tui" });
		h.runtime.load(ctx);
		h.runtime.start({ command: "sleep 1" }, ctx);
		expect(widgets.size).toBe(0);
	});

	test("clears the status chips on shutdown", async () => {
		const { h, pi, ctx, statuses } = setup();
		await emit(pi, "session_start", {}, ctx);
		h.runtime.start({ command: "sleep 1" }, ctx);
		h.children[0].close(1); // unreported failure
		h.runtime.setStatus(ctx);
		expect(statuses.get("jobs-failure")).toBe("✗ 1");
		for (const handler of (pi.handlers.get("session_shutdown") ?? []) as AnyHandler[]) await handler({}, ctx);
		expect(statuses.has("jobs")).toBe(false);
		expect(statuses.has("jobs-failure")).toBe(false);
	});
});
