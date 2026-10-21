import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import subagent, { TOOL_NAME } from "./index.ts";
import type { BackgroundRun, BackgroundRuntime } from "./background.ts";
import { registerAgentsCommand } from "./commands.ts";
import { aggregateUsage, clip, clipPath, formatAgentsList, formatToolCall, formatUsageStats } from "./format.ts";
import type { RunOptions } from "./run.ts";
import { emptyUsage } from "./stream.ts";
import type { SingleResult } from "./types.ts";
import { createSubagentUi } from "./ui.ts";
import { ENV_DISABLED_EXTENSIONS } from "../../lib/env.ts";
import { SUBAGENT_FINISHED_CHANNEL } from "../../lib/events.ts";
import { PLAN_MODE_ENTRY_TYPE } from "../../lib/plan-state.ts";
import { STATUS_KEYS } from "../../lib/tui/glyphs.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { tempDir, useEnv, withAgentDir, withEnv } from "../../test/helpers/env.ts";
import { emit, makeFakePi } from "../../test/helpers/fakes.ts";
import { assistantMessage, fakeTheme, fakeToolCtx } from "../../test/helpers/fixtures/subagent.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { settle } from "../../test/helpers/process.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

// The effective root is read from the environment; clear a developer's
// worktree root so the fake ctx.cwd is used. The preload restores it afterwards.
beforeEach(() => {
	useEnv({ PI_WORKTREE_ROOT: undefined });
});

function success(agent: string, text: string): SingleResult {
	return { agent, task: "t", exitCode: 0, messages: [assistantMessage(text)], stderr: "", usage: emptyUsage() };
}

function failure(agent: string, message: string): SingleResult {
	return {
		agent,
		task: "t",
		exitCode: 1,
		messages: [],
		stderr: "",
		usage: emptyUsage(),
		stopReason: "error",
		errorMessage: message,
	};
}

function register(run: (options: RunOptions) => Promise<SingleResult>) {
	const { pi, tools } = makeFakePi();
	subagent(pi, { run });
	const tool = tools.get(TOOL_NAME);
	if (!tool) throw new Error("subagent tool was not registered");
	return Object.assign(tool, { pi });
}

function call(tool: any, params: unknown, ctx = fakeToolCtx()): Promise<any> {
	return tool.execute("call-1", params, undefined, undefined, ctx);
}

describe("subagent registration", () => {
	test("registers nothing when disabled through PI_DISABLED_EXTENSIONS", async () => {
		await withEnv({ [ENV_DISABLED_EXTENSIONS]: "subagent" }, () => {
			const { pi, tools } = makeFakePi();
			subagent(pi);
			expect(tools.size).toBe(0);
		});
	});

	test("registers a direct, active tool with its safety annotations", () => {
		const tool = register(async (options) => success(options.agentName, "ok"));
		expect(tool).toBeDefined();
		expect(tool.exposure).toBeUndefined();
		expect(tool.defaultActive).toBeUndefined();
		expect(tool.annotations).toEqual({ readOnlyHint: false, destructiveHint: true, openWorldHint: true });
	});

	test("paints a running chip and announces a finished background run", async () => {
		let release: ((result: SingleResult) => void) | undefined;
		const tool = register(
			() =>
				new Promise<SingleResult>((resolve) => {
					release = resolve;
				}),
		);
		const ctx = { ...fakeToolCtx(), ...fakeCtx({ hasUI: true, branch: [] }).ctx };
		ctx.sessionManager.getBranch = () => tool.pi.entries;

		await emit(tool.pi, "session_start", {}, ctx);
		const outcome = await call(tool, { agent: "explorer", task: "explore", background: true }, ctx);
		expect(outcome.content[0]?.text).toContain("Started explorer as a1");
		expect(ctx.statuses.get(STATUS_KEYS.agents)).toBe("↳ 1");

		await settle();
		release?.(success("explorer", "done"));
		await settle();
		expect(ctx.statuses.has(STATUS_KEYS.agents)).toBe(false);
		expect(ctx.notices.at(-1)).toMatchObject({ kind: "info" });
		expect(ctx.notices.at(-1)?.message).toContain("Background subagent a1");
	});

	test("starts a background run and records its lifecycle", async () => {
		let release: ((result: SingleResult) => void) | undefined;
		let signal: AbortSignal | undefined;
		const tool = register(
			(options) =>
				new Promise<SingleResult>((resolve) => {
					signal = options.signal;
					release = resolve;
				}),
		);
		const ctx = {
			...fakeToolCtx(),
			hasUI: false,
			isProjectTrusted: () => true,
			sessionManager: { getBranch: () => tool.pi.entries },
		};

		const outcome = await call(tool, { agent: "explorer", task: "explore", background: true }, ctx);
		expect(outcome.content[0]?.text).toContain("Started explorer as a1");
		expect(outcome.details.background).toMatchObject({ runId: "a1", agent: "explorer", task: "explore" });
		expect(tool.pi.entries).toHaveLength(1);

		await settle();
		expect(signal?.aborted).toBe(false);
		release?.(success("explorer", "done"));
		await settle();
		expect(tool.pi.entries).toHaveLength(2);
		expect(tool.pi.entries[1]?.data).toMatchObject({ phase: "finish", runId: "a1", status: "finished" });
	});

	test("shutdown aborts a background child and clears the chip", async () => {
		let signal: AbortSignal | undefined;
		const tool = register(
			(options) =>
				new Promise<SingleResult>(() => {
					signal = options.signal;
				}),
		);
		const ctx = { ...fakeToolCtx(), ...fakeCtx({ hasUI: true, branch: [] }).ctx };
		ctx.sessionManager.getBranch = () => tool.pi.entries;

		await emit(tool.pi, "session_start", {}, ctx);
		await call(tool, { agent: "explorer", task: "explore", background: true }, ctx);
		await settle();
		await emit(tool.pi, "session_shutdown", {}, ctx);

		expect(signal?.aborted).toBe(true);
		expect(ctx.statuses.has(STATUS_KEYS.agents)).toBe(false);
	});
});

describe("subagent run settings", () => {
	test("reads the deadline from the shared config and applies it to every task", async () => {
		const repo = tempDir("subagent-repo-");
		mkdirSync(join(repo, ".pi"), { recursive: true });
		writeFileSync(join(repo, ".pi", "bytefly.json"), JSON.stringify({ subagent: { timeoutMs: 1234 } }));

		const seen: Array<number | undefined> = [];
		const tool = register(async (options) => {
			seen.push(options.timeoutMs);
			return success(options.agentName, "ok");
		});

		await call(
			tool,
			{
				tasks: [
					{ agent: "explorer", task: "auth" },
					{ agent: "explorer", task: "billing" },
				],
			},
			fakeToolCtx({ cwd: repo }),
		);

		expect(seen).toEqual([1234, 1234]);
	});

	test("resolves the transcript store only when the config asks for one", async () => {
		await withAgentDir(async (agentDir) => {
			const seen: RunOptions[] = [];
			const tool = register(async (options) => {
				seen.push(options);
				return success(options.agentName, "ok");
			});
			const repo = tempDir("subagent-repo-");

			await call(tool, { agent: "explorer", task: "find it" }, fakeToolCtx({ cwd: repo }));
			expect(seen[0].transcripts).toBeUndefined();

			mkdirSync(join(repo, ".pi"), { recursive: true });
			writeFileSync(join(repo, ".pi", "bytefly.json"), JSON.stringify({ subagent: { transcripts: "failed" } }));
			await call(tool, { agent: "explorer", task: "find it again" }, fakeToolCtx({ cwd: repo }));
			expect(seen[1].transcripts).toEqual({ dir: join(agentDir, "subagents"), mode: "failed" });
		}, "subagent-global-");
	});
});

describe("subagent mode validation", () => {
	test("rejects an empty call without running anything and lists the roster", async () => {
		const tool = register(async () => success("explorer", "ok"));
		const result = await call(tool, {});
		expect(result.content[0].text).toContain("Provide one mode");
		expect(result.content[0].text).toContain("explorer");
		expect(result.details.results).toEqual([]);
	});
});

describe("subagent single mode", () => {
	test("returns the final output and dispatch defaults", async () => {
		const seen: RunOptions[] = [];
		const tool = register(async (options) => {
			seen.push(options);
			return success(options.agentName, "found it");
		});

		const result = await call(tool, { agent: "explorer", task: "find it" });
		expect(result.content[0].text).toBe("found it");
		expect(result.details.mode).toBe("single");
		expect(seen[0]).toMatchObject({
			agentName: "explorer",
			task: "find it",
			defaultCwd: "/repo",
			defaults: { model: "anthropic/claude-sonnet-4-5", thinkingLevel: "medium" },
		});
	});

	test("marks a failed run as an error", async () => {
		const tool = register(async () => failure("explorer", "no luck"));
		const result = await call(tool, { agent: "explorer", task: "find it" });
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("no luck");
	});
});

describe("subagent parallel mode", () => {
	test("runs every task and summarizes the outcomes", async () => {
		const tasks: string[] = [];
		const tool = register(async (options) => {
			tasks.push(options.task);
			return success(options.agentName, `out:${options.task}`);
		});

		const result = await call(tool, {
			tasks: [
				{ agent: "explorer", task: "auth" },
				{ agent: "planner", task: "billing" },
			],
		});

		expect(tasks).toEqual(["auth", "billing"]);
		expect(result.details.mode).toBe("parallel");
		expect(result.details.results).toHaveLength(2);
		expect(result.content[0].text).toContain("2/2 succeeded");
		expect(result.content[0].text).toContain("[explorer] completed");
	});

	test("reports failed tasks without dropping successful ones", async () => {
		const tool = register(async (options) =>
			options.agentName === "planner" ? failure("planner", "boom") : success("explorer", "ok"),
		);
		const result = await call(tool, {
			tasks: [
				{ agent: "explorer", task: "a" },
				{ agent: "planner", task: "b" },
			],
		});
		expect(result.content[0].text).toContain("1/2 succeeded");
		expect(result.content[0].text).toContain("[planner] failed");
	});
});

describe("subagent project agents", () => {
	/** A temp repo whose `.pi/agents` holds one project agent. */
	function projectRepo(): string {
		const root = temps.track(tempDir("pi-subagent-ctx-"));
		const agentsDir = join(root, ".pi", "agents");
		mkdirSync(agentsDir, { recursive: true });
		writeFileSync(join(agentsDir, "auditor.md"), "---\nname: auditor\ndescription: Audits\n---\nYou audit.\n", "utf-8");
		return root;
	}

	function projectCtx(root: string, trusted: boolean, onConfirm: () => void): any {
		return {
			cwd: root,
			model: { provider: "anthropic", id: "claude-sonnet-4-5" },
			thinkingLevel: "medium",
			hasUI: true,
			isProjectTrusted: () => trusted,
			ui: {
				confirm: async () => {
					onConfirm();
					return false;
				},
			},
		};
	}

	test("asks before running a project agent and cancels on decline", async () => {
		const root = projectRepo();
		let confirmed = 0;
		const tool = register(async (options) => success(options.agentName, "ok"));
		const result = await call(
			tool,
			{ agent: "auditor", task: "x", agentScope: "both" },
			projectCtx(root, false, () => confirmed++),
		);
		expect(confirmed).toBe(1);
		expect(result.content[0].text).toContain("not approved");
	});

	test("refuses project agents without a UI for an untrusted project", async () => {
		const root = projectRepo();
		const tool = register(async (options) => success(options.agentName, "ok"));
		const headless: any = {
			cwd: root,
			model: { provider: "anthropic", id: "claude-sonnet-4-5" },
			thinkingLevel: "medium",
			hasUI: false,
			isProjectTrusted: () => false,
			ui: { confirm: async () => true },
		};
		const result = await call(tool, { agent: "auditor", task: "x", agentScope: "both" }, headless);
		expect(result.content[0].text).toContain("Refusing");
	});

	test("runs a project agent without prompting for a trusted project", async () => {
		const root = projectRepo();
		let confirmed = 0;
		const tool = register(async (options) => success(options.agentName, "ok"));
		const result = await call(
			tool,
			{ agent: "auditor", task: "x", agentScope: "both" },
			projectCtx(root, true, () => confirmed++),
		);
		expect(confirmed).toBe(0);
		expect(result.content[0].text).toBe("ok");
	});
});

describe("subagent chain mode", () => {
	test("passes each output forward via {previous}", async () => {
		const tasks: string[] = [];
		const templates: (string | undefined)[] = [];
		const tool = register(async (options) => {
			tasks.push(options.task);
			templates.push(options.taskTemplate);
			return success(options.agentName, `out-${tasks.length}`);
		});

		const result = await call(tool, {
			chain: [
				{ agent: "explorer", task: "find" },
				{ agent: "planner", task: "plan using {previous}" },
			],
		});

		expect(tasks).toEqual(["find", "plan using out-1"]);
		expect(templates).toEqual(["find", "plan using {previous}"]);
		expect(result.details.mode).toBe("chain");
		expect(result.content[0].text).toBe("out-2");
	});

	test("stops and reports the failing step", async () => {
		const tool = register(async () => failure("planner", "step failed"));

		const result = await call(tool, {
			chain: [
				{ agent: "explorer", task: "one" },
				{ agent: "planner", task: "two" },
				{ agent: "worker", task: "three" },
			],
		});

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("Chain stopped at step 1");
	});
});

describe("subagent accounting", () => {
	/** A run that reports one assistant turn with usage and a model. */
	function spending(agent: string, input = 1000, output = 200, cost = 0.02): SingleResult {
		return {
			agent,
			task: "t",
			exitCode: 0,
			messages: [assistantMessage("done")],
			stderr: "",
			provider: "anthropic",
			model: "opus-4.5",
			usage: { ...emptyUsage(), input, output, cacheRead: 50, cacheWrite: 0, cost, turns: 1 },
			finishedAt: 1_700_000_000_000,
		};
	}

	/** Record every event a tool emits, by wrapping its `pi.events.emit`. */
	function recordEvents(tool: any): unknown[] {
		const seen: unknown[] = [];
		tool.pi.events.on(SUBAGENT_FINISHED_CHANNEL, (event: unknown) => seen.push(event));
		return seen;
	}

	test("a single run publishes what it spent", async () => {
		const tool = register(async () => spending("explorer"));
		const events = recordEvents(tool);

		await call(tool, { agent: "explorer", task: "look" });

		expect(events).toEqual([
			{
				agent: "explorer",
				provider: "anthropic",
				model: "opus-4.5",
				input: 1000,
				output: 200,
				cacheRead: 50,
				cacheWrite: 0,
				recordedCost: 0.02,
				at: 1_700_000_000_000,
				exitCode: 0,
			},
		]);
	});

	test("parallel runs publish one event per task", async () => {
		const tool = register(async (options) => spending(options.agentName));
		const events = recordEvents(tool);

		await call(tool, {
			tasks: [
				{ agent: "explorer", task: "a" },
				{ agent: "worker", task: "b" },
			],
		});

		expect(events).toHaveLength(2);
		expect((events as Array<{ agent: string }>).map((event) => event.agent).sort()).toEqual(["explorer", "worker"]);
	});

	test("a chain publishes one event per step", async () => {
		const tool = register(async (options) => spending(options.agentName));
		const events = recordEvents(tool);

		await call(tool, {
			chain: [
				{ agent: "explorer", task: "a" },
				{ agent: "worker", task: "b {previous}" },
			],
		});

		expect(events).toHaveLength(2);
	});

	test("a run with no usage publishes nothing", async () => {
		const tool = register(async () => failure("ghost", "Unknown agent"));
		const events = recordEvents(tool);

		await call(tool, { agent: "ghost", task: "look" });

		expect(events).toEqual([]);
	});

	test("a throwing event bus does not fail the call", async () => {
		const tool = register(async () => spending("explorer"));
		tool.pi.events.on(SUBAGENT_FINISHED_CHANNEL, () => {
			throw new Error("listener exploded");
		});

		const result = await call(tool, { agent: "explorer", task: "look" });

		expect(result.isError).toBeUndefined();
		expect(result.details.results[0].exitCode).toBe(0);
	});
});

const RUNS: BackgroundRun[] = [
	{ id: "a2", agent: "explorer", task: "Map auth", cwd: "/repo", startedAt: 1000, status: "running" },
	{
		id: "a1",
		agent: "reviewer",
		task: "Review",
		cwd: "/repo",
		startedAt: 0,
		finishedAt: 1000,
		status: "finished",
		output: "looks good",
	},
];

/** A runtime double recording the command's calls. */
function runtimeFor(runs: BackgroundRun[] = RUNS) {
	const calls = { collect: [] as string[], cancel: [] as string[] };
	const runtime = {
		start: () => ({ ok: false, error: "unused" }),
		list: () => runs,
		collect: (id: string) => {
			calls.collect.push(id);
			return { ok: true, text: "collected output" } as const;
		},
		cancel: (id: string) => {
			calls.cancel.push(id);
			return true;
		},
		shutdown: () => {},
		reset: () => {},
		subscribe: () => () => {},
	} as unknown as BackgroundRuntime;
	return { runtime, calls };
}

/** Register `/agents` over a runtime. */
function commandFor(runtime: BackgroundRuntime) {
	const fake = makeFakePi();
	registerAgentsCommand(fake.pi, runtime);
	return { fake, command: fake.commands.get("agents") };
}

describe("/agents", () => {
	test("prints the list headlessly", async () => {
		const { runtime } = runtimeFor();
		const { command } = commandFor(runtime);
		const ctx = fakeCtx({ mode: "print", hasUI: false, branch: [] }).ctx;

		await command.handler("", ctx);

		expect(ctx.notices.at(-1)?.message).toContain("a2 explorer");
		expect(ctx.notices.at(-1)?.message).toContain("a1 reviewer");
	});

	test("reports an empty board", async () => {
		const { runtime } = runtimeFor([]);
		const { command } = commandFor(runtime);
		const ctx = fakeCtx({ mode: "tui", hasUI: true, branch: [] }).ctx;

		await command.handler("", ctx);

		expect(ctx.notices.at(-1)?.message).toContain("No background subagents yet.");
	});

	test("refuses in plan mode", async () => {
		const { runtime } = runtimeFor();
		const { command } = commandFor(runtime);
		const ctx = fakeCtx({
			mode: "tui",
			branch: [{ type: "custom", customType: PLAN_MODE_ENTRY_TYPE, data: { enabled: true } }],
		}).ctx;

		await command.handler("", ctx);

		expect(ctx.notices.at(-1)?.message).toContain("Plan mode is read-only");
	});

	test("collects a finished run and sends it as a user message", async () => {
		const { runtime, calls } = runtimeFor();
		const { fake, command } = commandFor(runtime);
		const ctx = fakeCtx({ mode: "tui", hasUI: true, branch: [] }).ctx;
		ctx.ui.custom = async (factory: any) => {
			await new Promise((resolve) => {
				const component = factory({ requestRender: () => {}, terminal: { rows: 40 } }, ctx.ui.theme, {}, resolve);
				component.handleInput("j");
				component.handleInput("c");
			});
		};

		await command.handler("", ctx);

		expect(calls.collect).toEqual(["a1"]);
		expect(fake.sentMessages.at(-1)?.content).toBe("collected output");
	});

	test("cancels a running run and keeps the board open until close", async () => {
		const { runtime, calls } = runtimeFor();
		const { command } = commandFor(runtime);
		const ctx = fakeCtx({ mode: "tui", hasUI: true, branch: [] }).ctx;
		ctx.ui.custom = async (factory: any) => {
			await new Promise((resolve) => {
				const component = factory({ requestRender: () => {}, terminal: { rows: 40 } }, ctx.ui.theme, {}, resolve);
				component.handleInput("x");
				component.handleInput("\u001b");
			});
		};

		await command.handler("", ctx);

		expect(calls.cancel).toEqual(["a2"]);
	});
});

/** One background run with a stable shape. */
function backgroundRun(overrides: Partial<BackgroundRun> = {}): BackgroundRun {
	return {
		id: "a1",
		agent: "explorer",
		task: "Map the auth module",
		cwd: "/repo",
		startedAt: 0,
		status: "running",
		...overrides,
	};
}

function uiHarness(initial: BackgroundRun[] = [backgroundRun()]) {
	let runs = initial;
	const ui = createSubagentUi({ runs: () => runs });
	const { ctx, notices, statuses } = fakeCtx({ mode: "tui", hasUI: true });
	return {
		ui,
		ctx,
		notices,
		statuses,
		setRuns(next: BackgroundRun[]) {
			runs = next;
		},
	};
}

describe("subagent footer status", () => {
	test("paints the running count and clears it at zero", () => {
		const h = uiHarness();
		h.ui.attach(h.ctx);
		h.ui.paint();
		expect(h.statuses.get(STATUS_KEYS.agents)).toBe("↳ 1");

		h.setRuns([backgroundRun({ status: "finished", finishedAt: 1_000 })]);
		h.ui.paint();
		expect(h.statuses.has(STATUS_KEYS.agents)).toBe(false);
	});

	test("notifies a finished run and points at /agents", () => {
		const h = uiHarness();
		h.ui.attach(h.ctx);
		h.ui.notifyFinished(backgroundRun({ status: "finished", finishedAt: 1_000 }));

		const notice = h.notices.at(-1);
		expect(notice?.kind).toBe("info");
		expect(notice?.message).toContain("Background subagent a1 (explorer) finished");
		expect(notice?.message).toContain("Use /agents to collect it.");
	});

	test("uses an error notice for a failed or timed-out run", () => {
		const h = uiHarness();
		h.ui.attach(h.ctx);

		h.ui.notifyFinished(backgroundRun({ status: "failed" }));
		expect(h.notices.at(-1)?.kind).toBe("error");
		expect(h.notices.at(-1)?.message).toContain("Use /agents to inspect it.");

		h.ui.notifyFinished(backgroundRun({ status: "timedout" }));
		expect(h.notices.at(-1)?.message).toContain("timed out");
	});

	test("stays silent for a cancelled run", () => {
		const h = uiHarness();
		h.ui.attach(h.ctx);
		const before = h.notices.length;

		h.ui.notifyFinished(backgroundRun({ status: "cancelled" }));

		expect(h.notices).toHaveLength(before);
	});

	test("detach clears the chip and drops the context", () => {
		const h = uiHarness();
		h.ui.attach(h.ctx);
		h.ui.paint();
		h.ui.detach();

		expect(h.statuses.has(STATUS_KEYS.agents)).toBe(false);
		h.ui.notifyFinished(backgroundRun({ status: "finished", finishedAt: 1_000 }));
		expect(h.notices).toHaveLength(0);
	});
});

describe("formatUsageStats", () => {
	test("omits zero fields and appends the model", () => {
		const text = formatUsageStats(
			{ turns: 2, input: 1200, output: 300, cacheRead: 800, cacheWrite: 0, cost: 0.0042, contextTokens: 2000 },
			"claude-sonnet-4-5",
		);
		expect(text).toBe("2 turns ↑1.2k ↓300 R800 $0.0042 ctx:2.0k claude-sonnet-4-5");
	});

	test("returns an empty string when there is nothing to show", () => {
		expect(formatUsageStats({})).toBe("");
	});

	test("singularizes one turn", () => {
		expect(formatUsageStats({ turns: 1, input: 10 })).toBe("1 turn ↑10");
	});
});

describe("aggregateUsage", () => {
	test("sums every counter", () => {
		const total = aggregateUsage([
			{ usage: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, cost: 0.5, contextTokens: 0, turns: 1 } },
			{ usage: { input: 10, output: 20, cacheRead: 30, cacheWrite: 40, cost: 0.25, contextTokens: 0, turns: 2 } },
		]);
		expect(total).toMatchObject({ input: 11, output: 22, cacheRead: 33, cacheWrite: 44, turns: 3 });
		expect(total.cost).toBeCloseTo(0.75);
	});
});

describe("clip", () => {
	test("keeps surrogate pairs intact", () => {
		const out = clip(`${"a".repeat(59)}😀tail`, 60);
		expect(out.endsWith("…")).toBe(true);
		expect(out).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
		expect(out).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
	});

	test("accounts for wide characters by display width", () => {
		const out = clip("界".repeat(40), 20);
		expect(out.endsWith("…")).toBe(true);
		expect([...out].length).toBeLessThanOrEqual(12);
	});
});

describe("clipPath", () => {
	test("preserves the basename when eliding the middle", () => {
		const out = clipPath("/Users/gavin/Repositories/company/project/src/deeply/nested/module/file.ts", 40);
		expect(out.endsWith("file.ts")).toBe(true);
		expect(out).toContain("…");
	});

	test("returns a short path unchanged", () => {
		expect(clipPath("/tmp/a.ts", 40)).toBe("/tmp/a.ts");
	});
});

describe("formatToolCall", () => {
	const theme = fakeTheme();

	test("formats built-in tools", () => {
		expect(formatToolCall("bash", { command: "ls -la" }, theme, true)).toBe("$ ls -la");
		expect(formatToolCall("read", { file_path: "/tmp/a.ts", offset: 10, limit: 5 }, theme, true)).toContain(
			"/tmp/a.ts:10-14",
		);
		expect(formatToolCall("grep", { pattern: "foo", path: "/tmp" }, theme, true)).toContain("/foo/");
		expect(formatToolCall("find", { pattern: "*.ts", path: "." }, theme, true)).toContain("*.ts");
		expect(formatToolCall("write", { file_path: "/tmp/a.ts", content: "a\nb" }, theme, true)).toContain("(2 lines)");
	});

	test("collapses newlines so a tool call stays on one preview line", () => {
		expect(formatToolCall("bash", { command: "echo a\necho b" }, theme, true)).toBe("$ echo a echo b");
	});

	test("clips an overlong path in the preview", () => {
		const out = formatToolCall("read", { file_path: `/tmp/${"a".repeat(200)}` }, theme, true);
		expect(out.length).toBeLessThan(90);
		expect(out).toContain("…");
	});

	test("does not throw on malformed arguments", () => {
		for (const args of [undefined, null]) {
			for (const name of ["bash", "read", "grep", "write", "ls", "find", "edit", "custom"]) {
				expect(() => formatToolCall(name, args as never, theme, true)).not.toThrow();
			}
		}
	});

	test("falls back to a JSON preview for unknown tools", () => {
		expect(formatToolCall("custom", { a: 1 }, theme, true)).toContain('{"a":1}');
	});
});

describe("formatAgentsList", () => {
	test("counts the runs and lists each with its status and activity", () => {
		const text = formatAgentsList(RUNS, 2_000);
		expect(text).toContain("2 background runs · 1 running:");
		expect(text).toContain("a2 explorer · Map auth · running");
		expect(text).toContain("a1 reviewer · Review · finished · 1.0s");
	});

	test("names the empty board", () => {
		expect(formatAgentsList([])).toBe("No background subagents yet.");
	});
});
