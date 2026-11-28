import { afterEach, describe, expect, jest, test } from "bun:test";
import jobs from "./index.ts";
import { TOOL_NAME } from "./tools.ts";
import { JobListComponent } from "./view/jobs-screen.ts";
import { ENV_DISABLED_EXTENSIONS } from "../../lib/env.ts";
import { JOB_FINISHED_CHANNEL } from "../../lib/events.ts";
import { NOTICE_TYPE } from "../../lib/notice.ts";
import { onRailsSuppressed } from "../../lib/rails.ts";
import { withEnv } from "../../test/helpers/env.ts";
import { createFakePi, emit, emitFirst, type AnyHandler, recordSent } from "../../test/helpers/fakes.ts";
import { mountCustom } from "../../test/helpers/context.ts";
import { makeCtx, jobRecord, makeHarnessSuite, save } from "../../test/helpers/fixtures/job.ts";

/** A context message as the notices case reads it: its source tag and its text. */
interface NoticeMessage {
	content: string;
	details?: { source?: string };
}

const suite = makeHarnessSuite();
afterEach(() => {
	suite.cleanup();
});

function setup(options: Parameters<typeof suite.makeHarness>[0] = {}) {
	const h = suite.makeHarness(options);
	const { pi, tools, commands, handlers } = createFakePi();
	jobs(pi, { runtime: h.runtime });
	const { ctx, statuses } = makeCtx();
	return { h, pi, tools, commands, handlers, ctx, statuses, command: commands.get("jobs") };
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

	test("registers the tool and the /jobs command", async () => {
		const { tools, commands } = setup();
		expect(tools.has(TOOL_NAME)).toBe(true);
		expect(commands.has("jobs")).toBe(true);
	});

	test("a /jobs typed before the registry load lands lists the merged records", async () => {
		const { h, pi, ctx, command } = setup();
		if (!command) throw new Error("the jobs command was not registered");
		const notices: string[] = [];
		ctx.ui.notify = (message: string) => notices.push(message);
		// A record from a session that is gone is merged in by the load, which the session start
		// only starts: the command is the reader that waits for it.
		save(h, "old", [jobRecord({ detached: false, label: "build" })], 2);
		await emit(pi, "session_start", {}, ctx);
		await command.handler("", ctx);
		expect(notices.at(-1)).toContain("build");
	});

	test("loads the registry on session start", async () => {
		const { pi, ctx, statuses } = setup();
		for (const handler of (pi.handlers.get("session_start") ?? []) as AnyHandler[]) await handler({}, ctx);
		expect(statuses.has("jobs")).toBe(false);
	});

	test("injects a completion note before the next turn", async () => {
		const { h, pi, ctx } = setup();
		await emit(pi, "session_start", {}, ctx);
		await h.runtime.start({ command: "sleep 1" }, ctx);
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
		await h.runtime.start({ command: "sleep 1", label: "build" }, ctx);
		h.children[0].close(2);
		expect(seen).toEqual([{ id: "j1", label: "build", status: "failed", exitCode: 2, signal: null }]);
	});

	test("announces and wakes a job killed as an orphan at load", async () => {
		const { h, pi, ctx } = setup();
		const sent = recordSent(pi);
		const seen: unknown[] = [];
		pi.events.on(JOB_FINISHED_CHANNEL, (data: unknown) => seen.push(data));
		// A dead session's non-detached job: `session_start` starts the load, which kills it and
		// holds the outcome until the trigger arms — a reader waits for that (`ready`).
		save(h, "old", [jobRecord({ detached: false, wake: true, label: "build" })], 2);

		await emit(pi, "session_start", {}, ctx);
		// The load is started, not awaited: the first turn's report triggers it to settle.
		await emitFirst(pi, "before_agent_start", {}, ctx);

		expect(sent).toHaveLength(1);
		expect(sent[0].options.triggerTurn).toBe(true);
		expect(seen).toEqual([{ id: "j1", label: "build", status: "killed", exitCode: null, signal: "SIGTERM" }]);
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
		expect(result.messages.some((message: NoticeMessage) => message.details?.source === "watch")).toBe(true);
		expect(
			result.messages
				.filter((message: NoticeMessage) => message.details?.source === "job")
				.map((message: NoticeMessage) => message.content),
		).toEqual(["new"]);
	});

	test("wakes the agent when a wake job finishes while idle", async () => {
		const { h, pi, ctx } = setup();
		const sent = recordSent(pi);

		await emit(pi, "session_start", {}, ctx);
		await h.runtime.start({ command: "sleep 1", wake: true }, ctx);
		h.children[0].close(0);

		expect(sent).toHaveLength(1);
		expect(sent[0].options.triggerTurn).toBe(true);
		expect(sent[0].message.customType).toBe(NOTICE_TYPE);
	});

	test("a wake job that finishes during a turn wakes once at settle", async () => {
		const { h, pi, ctx } = setup();
		const sent = recordSent(pi);

		await emit(pi, "session_start", {}, ctx);
		await emit(pi, "agent_start", {}, ctx);
		await h.runtime.start({ command: "sleep 1", wake: true }, ctx);
		h.children[0].close(0);
		expect(sent).toHaveLength(0);

		await emit(pi, "agent_settled", { aborted: false }, ctx);
		expect(sent).toHaveLength(1);
		expect(sent[0]?.options.triggerTurn).toBe(true);
		expect(sent[0]?.message.content).toContain("j1");
		// The settle retry already reported it, so the next turn adds nothing.
		expect(await emitFirst(pi, "before_agent_start", {}, ctx)).toBeUndefined();

		// The triggered run starts and settles; a later completion while idle wakes
		// its own turn.
		await emit(pi, "agent_start", {}, ctx);
		await emit(pi, "agent_settled", { aborted: false }, ctx);
		await h.runtime.start({ command: "sleep 1", wake: true }, ctx);
		h.children[1].close(0);
		expect(sent).toHaveLength(2);
	});

	test("an aborted run leaves a wake job for the next turn", async () => {
		const { h, pi, ctx } = setup();
		const sent = recordSent(pi);

		await emit(pi, "session_start", {}, ctx);
		await emit(pi, "agent_start", {}, ctx);
		await h.runtime.start({ command: "sleep 1", wake: true }, ctx);
		h.children[0].close(0);

		await emit(pi, "agent_settled", { aborted: true }, ctx);
		expect(sent).toHaveLength(0);

		const result = await emitFirst(pi, "before_agent_start", {}, ctx);
		expect(result?.message?.content).toContain("j1");
	});

	test("wake reports other pending completions instead of dropping them", async () => {
		const { h, pi, ctx } = setup();
		const sent = recordSent(pi);

		await emit(pi, "session_start", {}, ctx);
		// j1 finishes first and is not yet reported; j2 wakes the agent.
		await h.runtime.start({ command: "a" }, ctx);
		await h.runtime.start({ command: "b", wake: true }, ctx);
		h.children[0].close(0);
		h.children[1].close(0);

		expect(sent).toHaveLength(1);
		expect(sent[0].message.content).toContain("j1");
		expect(sent[0].message.content).toContain("j2");
	});

	test("wakes once when two wake jobs finish in the same tick", async () => {
		const { h, pi, ctx } = setup();
		const sent = recordSent(pi);

		await emit(pi, "session_start", {}, ctx);
		await h.runtime.start({ command: "a", wake: true }, ctx);
		await h.runtime.start({ command: "b", wake: true }, ctx);
		// Both close before the triggered turn has started, so the second one
		// must queue rather than raise a second turn.
		h.children[0].close(0);
		h.children[1].close(0);

		expect(sent).toHaveLength(1);
		expect(sent[0].options.triggerTurn).toBe(true);
		// The queued completion is still reported when the turn does start.
		const result = await emitFirst(pi, "before_agent_start", {}, ctx);
		expect(result?.message?.content).toContain("j2");
	});

	test("a failed wake leaves the completion for the next turn", async () => {
		const { h, pi, ctx } = setup();
		pi.sendMessage = () => {
			throw new Error("session busy");
		};
		await emit(pi, "session_start", {}, ctx);
		await h.runtime.start({ command: "sleep 1", wake: true }, ctx);
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
		await h.runtime.start({ command: "sleep 1" }, ctx);
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
		await h.runtime.start({ command: "sleep 1", wake: true }, ctx);
		h.children[0].close(0);
		expect(sent).toHaveLength(1);
	});

	test("session_tree re-asserts the status chip", async () => {
		const { h, pi, ctx, statuses } = setup();
		await emit(pi, "session_start", {}, ctx);
		await h.runtime.start({ command: "sleep 1" }, ctx);
		expect(statuses.has("jobs")).toBe(true);
		statuses.delete("jobs");
		await emit(pi, "session_tree", {}, ctx);
		expect(statuses.has("jobs")).toBe(true);
	});

	test("clears the status chips on shutdown", async () => {
		const { h, pi, ctx, statuses } = setup();
		await emit(pi, "session_start", {}, ctx);
		await h.runtime.start({ command: "sleep 1" }, ctx);
		h.children[0].close(1); // unreported failure
		h.runtime.setStatus(ctx);
		expect(statuses.get("jobs-failure")).toBe("✗ 1");
		for (const handler of (pi.handlers.get("session_shutdown") ?? []) as AnyHandler[]) await handler({}, ctx);
		expect(statuses.has("jobs")).toBe(false);
		expect(statuses.has("jobs-failure")).toBe(false);
	});
});

describe("jobs command", () => {
	test("prints a text summary outside the TUI", async () => {
		const { h, ctx, command } = setup();
		await h.runtime.load(ctx);
		await h.runtime.start({ command: "sleep 1" }, ctx);
		await command.handler("", ctx);
		expect(ctx.notices.at(-1)?.message).toContain("Jobs (1)");
		expect(ctx.customCalls).toHaveLength(0);
	});

	test("opens the jobs screen in the TUI and restores the rails", async () => {
		const { h, pi, ctx, command } = setup();
		ctx.mode = "tui";
		await h.runtime.load(ctx);
		await h.runtime.start({ command: "sleep 1" }, ctx);

		const screen = mountCustom(ctx, { rows: 24 });
		const suppressed: boolean[] = [];
		onRailsSuppressed(pi, (value) => suppressed.push(value));

		jest.useFakeTimers();
		try {
			await command.handler("", ctx);
		} finally {
			jest.useRealTimers();
		}

		const component = screen.component();
		expect(component).toBeInstanceOf(JobListComponent);
		expect(component.render(60).join("\n")).toContain("j1");
		expect(suppressed).toEqual([true, false]);
	});
});
