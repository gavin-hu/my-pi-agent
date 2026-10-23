import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, jest, test } from "bun:test";
import { DEFAULT_CONFIG, loadConfig, normalizeConfig } from "./config.ts";
import jobs from "./index.ts";
import { TOOL_NAME } from "./tools.ts";
import { JobListComponent } from "./tui.ts";
import { ENV_DISABLED_EXTENSIONS } from "../../lib/env.ts";
import { JOB_FINISHED_CHANNEL } from "../../lib/events.ts";
import { SHARED_CONFIG_FILE } from "../../lib/config.ts";
import { NOTICE_TYPE } from "../../lib/notice.ts";
import { onRailsSuppressed } from "../../lib/rails.ts";
import { tempDir, withAgentDir, withEnv } from "../../test/helpers/env.ts";
import { createFakePi, emit, emitFirst, fakeTheme, type AnyHandler } from "../../test/helpers/fakes.ts";
import { makeCtx, makeHarnessSuite } from "../../test/helpers/fixtures/job.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";

const suite = makeHarnessSuite();
const temps = makeTempTracker();
afterEach(() => {
	suite.cleanup();
	temps.flush();
});

function setup(options: Parameters<typeof suite.makeHarness>[0] = {}) {
	const h = suite.makeHarness(options);
	const { pi, tools, commands, handlers } = createFakePi();
	jobs(pi, { runtime: h.runtime });
	const { ctx, statuses } = makeCtx();
	return { h, pi, tools, commands, handlers, ctx, statuses, command: commands.get("jobs") };
}

describe("job config", () => {
	test("normalizeConfig returns the base for an absent section", () => {
		expect(normalizeConfig(undefined, DEFAULT_CONFIG)).toBe(DEFAULT_CONFIG);
	});

	test("takes booleans and ignores wrongly typed ones", () => {
		const config = normalizeConfig(
			{ enabled: false, showStatus: "no", wakeOnFinish: true, detachedByDefault: true },
			DEFAULT_CONFIG,
		);
		expect(config.enabled).toBe(false);
		expect(config.showStatus).toBe(true);
		expect(config.wakeOnFinish).toBe(true);
		expect(config.detachedByDefault).toBe(true);
	});

	test("clamps numeric fields into range", () => {
		const config = normalizeConfig(
			{
				maxJobs: 0,
				maxLogLines: 10_000,
				maxLogBytes: -1,
				killGraceMs: 999_999,
				repaintMs: 1,
				sessionTtlMs: 1,
			},
			DEFAULT_CONFIG,
		);
		expect(config.maxJobs).toBe(1);
		expect(config.maxLogLines).toBe(5000);
		expect(config.maxLogBytes).toBe(0);
		expect(config.killGraceMs).toBe(60_000);
		expect(config.repaintMs).toBe(100);
		expect(config.sessionTtlMs).toBe(5000);
	});

	test("keeps the default for a non-numeric value", () => {
		const config = normalizeConfig({ maxJobs: null, repaintMs: "fast" }, DEFAULT_CONFIG);
		expect(config.maxJobs).toBe(DEFAULT_CONFIG.maxJobs);
		expect(config.repaintMs).toBe(DEFAULT_CONFIG.repaintMs);
	});

	test("trims registryDir and treats a blank one as unset", () => {
		expect(normalizeConfig({ registryDir: " /custom/dir " }, DEFAULT_CONFIG).registryDir).toBe("/custom/dir");
		expect(normalizeConfig({ registryDir: "   " }, DEFAULT_CONFIG).registryDir).toBeUndefined();
	});

	test("loadConfig returns the defaults when no section is configured", async () => {
		await withAgentDir(() => {
			const cwd = temps.track(tempDir("pi-jobs-config-"));
			expect(loadConfig(cwd)).toEqual(DEFAULT_CONFIG);
		});
	});

	test("loadConfig layers the global section, then the project section", async () => {
		await withAgentDir(async (agentDir) => {
			const cwd = temps.track(tempDir("pi-jobs-config-"));
			writeFileSync(
				join(agentDir, SHARED_CONFIG_FILE),
				JSON.stringify({ job: { maxJobs: 5, wakeOnFinish: true } }),
				"utf-8",
			);
			mkdirSync(join(cwd, CONFIG_DIR_NAME), { recursive: true });
			writeFileSync(
				join(cwd, CONFIG_DIR_NAME, SHARED_CONFIG_FILE),
				JSON.stringify({ job: { maxJobs: 7, showStatus: false } }),
				"utf-8",
			);
			const config = loadConfig(cwd);
			expect(config.maxJobs).toBe(7);
			expect(config.wakeOnFinish).toBe(true);
			expect(config.showStatus).toBe(false);
		});
	});
});

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
		expect(result.messages.some((message: any) => message.details?.source === "watch")).toBe(true);
		expect(
			result.messages
				.filter((message: any) => message.details?.source === "job")
				.map((message: any) => message.content),
		).toEqual(["new"]);
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

	test("a wake job that finishes during a turn wakes once at settle", async () => {
		const { h, pi, ctx } = setup();
		const sent: Array<{ message: any; options: any }> = [];
		pi.sendMessage = (message: any, options: any) => sent.push({ message, options });

		await emit(pi, "session_start", {}, ctx);
		await emit(pi, "agent_start", {}, ctx);
		h.runtime.start({ command: "sleep 1", wake: true }, ctx);
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
		h.runtime.start({ command: "sleep 1", wake: true }, ctx);
		h.children[1].close(0);
		expect(sent).toHaveLength(2);
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

	test("wakes once when two wake jobs finish in the same tick", async () => {
		const { h, pi, ctx } = setup();
		const sent: Array<{ message: any; options: any }> = [];
		pi.sendMessage = (message: any, options: any) => sent.push({ message, options });

		await emit(pi, "session_start", {}, ctx);
		h.runtime.start({ command: "a", wake: true }, ctx);
		h.runtime.start({ command: "b", wake: true }, ctx);
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

	test("session_tree re-asserts the status chip", async () => {
		const { h, pi, ctx, statuses } = setup();
		await emit(pi, "session_start", {}, ctx);
		h.runtime.start({ command: "sleep 1" }, ctx);
		expect(statuses.has("jobs")).toBe(true);
		statuses.delete("jobs");
		await emit(pi, "session_tree", {}, ctx);
		expect(statuses.has("jobs")).toBe(true);
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

describe("jobs command", () => {
	test("prints a text summary outside the TUI", async () => {
		const { h, ctx, command } = setup();
		h.runtime.load(ctx);
		h.runtime.start({ command: "sleep 1" }, ctx);
		await command.handler("", ctx);
		expect(ctx.notices.at(-1)?.message).toContain("Jobs (1)");
		expect(ctx.customCalls).toHaveLength(0);
	});

	test("opens the jobs screen in the TUI and restores the rails", async () => {
		const { h, pi, ctx, command } = setup();
		ctx.mode = "tui";
		h.runtime.load(ctx);
		h.runtime.start({ command: "sleep 1" }, ctx);

		let component: JobListComponent | undefined;
		ctx.ui.custom = async (factory: any) => {
			component = factory({ requestRender: () => {}, terminal: { rows: 24 } }, fakeTheme, {}, () => {});
		};
		const suppressed: boolean[] = [];
		onRailsSuppressed(pi, (value) => suppressed.push(value));

		jest.useFakeTimers();
		try {
			await command.handler("", ctx);
		} finally {
			jest.useRealTimers();
		}

		expect(component).toBeInstanceOf(JobListComponent);
		expect(component?.render(60).join("\n")).toContain("j1");
		expect(suppressed).toEqual([true, false]);
	});
});
