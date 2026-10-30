import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, utimesSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, test } from "bun:test";
import { screenText } from "../../test/helpers/fakes.ts";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
import { BUILTIN_AGENTS } from "./agents.ts";
import {
	BACKGROUND_ENTRY,
	canCollect,
	createBackgroundRuntime,
	type BackgroundRun,
	type BackgroundStartInput,
} from "./background.ts";
import { AgentsBoardComponent } from "./view/agents-board.ts";
import { formatBackgroundDuration } from "./format.ts";
import { runSingleAgent, type RunOptions } from "./run.ts";
import {
	applyEvent,
	createResult,
	emptyUsage,
	getFinalOutput,
	getResultOutput,
	isFailedResult,
	mapWithConcurrencyLimit,
	parseJsonLine,
	truncateOutput,
} from "./stream.ts";
import { createTranscript, pruneTranscripts, runIdFor, transcriptsDirFor } from "./transcripts.ts";
import type { SingleResult, SubagentDetails, UsageStats } from "./types.ts";
import { makeClock } from "../../test/helpers/clock.ts";
import { tempDir, withAgentDir } from "../../test/helpers/env.ts";
import { createFakePi, fakeTheme } from "../../test/helpers/fakes.ts";
import { assistantMessage, makeFakeSpawn } from "../../test/helpers/fixtures/subagent.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { settle, waitFor } from "../../test/helpers/process.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

const makeDetails = (results: SingleResult[]): SubagentDetails => ({ mode: "single", results });

/** A zeroed result for the pure stream helpers. */
function emptyResult(): SingleResult {
	return { agent: "explorer", task: "t", exitCode: 0, messages: [], stderr: "", usage: emptyUsage() };
}

/**
 * An agent with no system prompt, so a run needs no temp prompt file.
 *
 * The deadline tests only care about kill semantics, and writing the prompt goes
 * through the host's process-wide file queue, which a loaded machine can stall
 * past a short timeout. Removing that dependency keeps them about one thing.
 */
const MUTE_AGENT = { name: "mute", description: "No prompt", systemPrompt: "", source: "user" as const };

function options(overrides: Partial<RunOptions>): RunOptions {
	return {
		defaultCwd: "/repo",
		defaults: {},
		agentName: "explorer",
		task: "inspect the code",
		makeDetails,
		...overrides,
	};
}

function promptPath(args: string[]): string | undefined {
	const index = args.indexOf("--append-system-prompt");
	return index === -1 ? undefined : args[index + 1];
}

const store = () => temps.track(tempDir("subagent-runs-"));

describe("stream helpers", () => {
	test("createResult starts in the running-sentinel state", () => {
		const result = createResult("explorer", "t", { step: 2 });
		expect(result.exitCode).toBe(-1);
		expect(result.messages).toEqual([]);
		expect(result.stderr).toBe("");
		expect(result.usage.turns).toBe(0);
		expect(result.step).toBe(2);
	});

	test("parseJsonLine parses objects and ignores blanks and garbage", () => {
		expect(parseJsonLine('{"type":"message_end"}')).toEqual({ type: "message_end" });
		expect(parseJsonLine("")).toBeUndefined();
		expect(parseJsonLine("   ")).toBeUndefined();
		expect(parseJsonLine("not json")).toBeUndefined();
		expect(parseJsonLine("42")).toBeUndefined();
	});

	test("applyEvent records assistant messages and sums usage across turns", () => {
		const target = emptyResult();
		applyEvent(target, {
			type: "message_end",
			message: assistantMessage("one", { input: 10, output: 2, totalTokens: 12, cost: 0.1 }),
		});
		applyEvent(target, {
			type: "message_end",
			message: assistantMessage("two", {
				input: 5,
				output: 3,
				cacheRead: 4,
				cacheWrite: 1,
				totalTokens: 20,
				cost: 0.2,
			}),
		});

		expect(target.messages).toHaveLength(2);
		expect(target.usage).toMatchObject({
			turns: 2,
			input: 15,
			output: 5,
			cacheRead: 4,
			cacheWrite: 1,
			contextTokens: 20,
		});
		expect(target.usage.cost).toBeCloseTo(0.3);
		expect(target.model).toBe("claude-sonnet-4-5");
	});

	test("applyEvent ignores a usage payload that is not a set of numbers", () => {
		const target = emptyResult();
		applyEvent(target, {
			type: "message_end",
			message: {
				role: "assistant",
				content: [{ type: "text", text: "x" }],
				usage: { input: "12", output: Number.NaN, cacheRead: null, totalTokens: "20", cost: { total: "0.5" } },
			},
		});

		// The turn is still counted, so "turns but no tokens" stays visible.
		expect(target.usage.turns).toBe(1);
		expect(target.usage).toMatchObject({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 });
		expect(target.usage.contextTokens).toBe(0);
	});

	test("applyEvent keeps the last reported context size", () => {
		const target = emptyResult();
		applyEvent(target, { type: "message_end", message: assistantMessage("one", { totalTokens: 12, cost: 0.1 }) });
		// A later message that reports no window occupancy must not erase it.
		applyEvent(target, {
			type: "message_end",
			message: { role: "assistant", content: [{ type: "text", text: "two" }], usage: { cost: { total: 0.2 } } },
		});

		expect(target.usage.cost).toBeCloseTo(0.3);
		expect(target.usage.contextTokens).toBe(12);
	});

	test("applyEvent keeps the first model and the latest stop reason", () => {
		const target = emptyResult();
		applyEvent(target, {
			type: "message_end",
			message: assistantMessage("x", { model: "first", stopReason: "error", errorMessage: "boom" }),
		});
		applyEvent(target, { type: "message_end", message: assistantMessage("y", { model: "second" }) });
		expect(target.model).toBe("first");
		expect(target.stopReason).toBe("stop");
		expect(target.errorMessage).toBe("boom");
	});

	test("applyEvent records non-assistant messages without touching usage", () => {
		const target = emptyResult();
		applyEvent(target, { type: "message_end", message: { role: "user", content: "hi" } });
		expect(target.messages).toHaveLength(1);
		expect(target.usage.turns).toBe(0);
	});

	test("applyEvent counts tool execution errors but does not fail the run", () => {
		const target = emptyResult();
		expect(applyEvent(target, { type: "tool_execution_end", isError: true })).toBe(true);
		expect(applyEvent(target, { type: "tool_execution_end", isError: false })).toBe(false);
		expect(target.toolErrors).toBe(1);
		expect(isFailedResult(target)).toBe(false);
	});

	test("applyEvent ignores unrelated events", () => {
		expect(applyEvent(emptyResult(), { type: "tool_execution_start" })).toBe(false);
		expect(applyEvent(emptyResult(), null)).toBe(false);
	});

	test("getFinalOutput returns the last assistant text", () => {
		const target = emptyResult();
		target.messages.push(assistantMessage("first"), assistantMessage("last"));
		expect(getFinalOutput(target.messages)).toBe("last");
		expect(getFinalOutput([])).toBe("");
	});

	test("isFailedResult covers exit code and stop reasons", () => {
		expect(isFailedResult(emptyResult())).toBe(false);
		expect(isFailedResult({ ...emptyResult(), exitCode: 1 })).toBe(true);
		expect(isFailedResult({ ...emptyResult(), stopReason: "error" })).toBe(true);
		expect(isFailedResult({ ...emptyResult(), stopReason: "aborted" })).toBe(true);
	});

	test("getResultOutput prefers error detail over output", () => {
		const target = emptyResult();
		target.messages.push(assistantMessage("partial"));
		target.stopReason = "error";
		target.errorMessage = "model exploded";
		expect(getResultOutput(target)).toBe("model exploded");
		target.errorMessage = undefined;
		target.stderr = "stderr text";
		expect(getResultOutput(target)).toBe("stderr text");
		target.stderr = "";
		expect(getResultOutput(target)).toBe("partial");
		expect(getResultOutput(emptyResult())).toBe("(no output)");
	});

	test("truncateOutput leaves short output unchanged", () => {
		expect(truncateOutput("hello", 100)).toBe("hello");
	});

	test("truncateOutput caps UTF-8 bytes and reports what was omitted", () => {
		const text = "é".repeat(100); // 200 bytes
		const truncated = truncateOutput(text, 50);
		expect(Buffer.byteLength(truncated, "utf8")).toBeGreaterThan(50);
		expect(truncated).toContain("Output truncated");
		expect(truncated.startsWith("é".repeat(25))).toBe(true);
	});
});

describe("mapWithConcurrencyLimit", () => {
	test("preserves input order", async () => {
		const output = await mapWithConcurrencyLimit([1, 2, 3, 4, 5], 2, async (value) => {
			await settle((6 - value) * 2);
			return value * 10;
		});
		expect(output).toEqual([10, 20, 30, 40, 50]);
	});

	test("never exceeds the concurrency limit", async () => {
		let active = 0;
		let peak = 0;
		await mapWithConcurrencyLimit([1, 2, 3, 4, 5, 6], 2, async () => {
			active++;
			peak = Math.max(peak, active);
			await settle(1);
			active--;
		});
		expect(peak).toBeLessThanOrEqual(2);
	});

	test("returns an empty array for no items", async () => {
		expect(await mapWithConcurrencyLimit([], 4, async () => 1)).toEqual([]);
	});
});

describe("runSingleAgent", () => {
	test("captures output, stderr, and usage from a successful run", async () => {
		const { spawn } = makeFakeSpawn((child) => {
			child.line({
				type: "message_end",
				message: assistantMessage("all done", { input: 7, output: 3, totalTokens: 10, cost: 0.02 }),
			});
			child.emitStderr("a warning");
			child.close(0);
		});

		const result = await runSingleAgent(options({ spawn }));
		expect(result.exitCode).toBe(0);
		expect(getFinalOutput(result.messages)).toBe("all done");
		expect(result.stderr).toBe("a warning");
		expect(result.usage).toMatchObject({ turns: 1, input: 7, output: 3, contextTokens: 10 });
		expect(result.usage.cost).toBeCloseTo(0.02);
		expect(result.model).toBe("claude-sonnet-4-5");
		expect(isFailedResult(result)).toBe(false);
	});

	test("marks the result as running while the process is in flight", async () => {
		const seen: SingleResult[] = [];
		const { spawn, children } = makeFakeSpawn((child) => {
			child.line({ type: "message_end", message: assistantMessage("working") });
		});

		const promise = runSingleAgent(
			options({
				spawn,
				onUpdate: (partial) => seen.push(partial.details?.results[0] as SingleResult),
			}),
		);
		await waitFor(() => seen.length > 0);
		expect(seen[0].exitCode).toBe(-1);

		children[0].close(0);
		await promise;
	});

	test("parses a final line that has no trailing newline", async () => {
		const { spawn } = makeFakeSpawn((child) => {
			child.write(JSON.stringify({ type: "message_end", message: assistantMessage("tail") }));
			child.close(0);
		});
		const result = await runSingleAgent(options({ spawn }));
		expect(getFinalOutput(result.messages)).toBe("tail");
	});

	test("reports a non-zero exit as failure", async () => {
		const { spawn } = makeFakeSpawn((child) => child.close(1));
		const result = await runSingleAgent(options({ spawn }));
		expect(result.exitCode).toBe(1);
		expect(isFailedResult(result)).toBe(true);
	});

	test("reports a signal-terminated child as a failure", async () => {
		const { spawn } = makeFakeSpawn((child) => child.close(null, "SIGKILL"));
		const result = await runSingleAgent(options({ spawn }));
		expect(result.exitCode).toBe(1);
		expect(isFailedResult(result)).toBe(true);
		expect(getResultOutput(result)).toContain("SIGKILL");
	});

	test("reports a spawn error as a failed run", async () => {
		const { spawn } = makeFakeSpawn((child) => child.fail(new Error("spawn failed")));
		const result = await runSingleAgent(options({ spawn }));
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("spawn failed");
		expect(isFailedResult(result)).toBe(true);
	});

	test("resolves a supplied cwd against the default root", async () => {
		const { spawn, children } = makeFakeSpawn((child) => child.close(0));
		await runSingleAgent(options({ spawn, defaultCwd: "/repo", cwd: "sub" }));
		expect(children[0].options?.cwd).toBe(resolve("/repo", "sub"));
		await runSingleAgent(options({ spawn, defaultCwd: "/repo", cwd: "/elsewhere" }));
		expect(children[1].options?.cwd).toBe(resolve("/elsewhere"));
	});

	test("propagates a model error and its message", async () => {
		const { spawn } = makeFakeSpawn((child) => {
			child.line({
				type: "message_end",
				message: assistantMessage("", { stopReason: "error", errorMessage: "quota exceeded" }),
			});
			child.close(0);
		});
		const result = await runSingleAgent(options({ spawn }));
		expect(isFailedResult(result)).toBe(true);
		expect(getResultOutput(result)).toBe("quota exceeded");
	});

	test("rejects an unknown agent without spawning", async () => {
		const { spawn, children } = makeFakeSpawn();
		const result = await runSingleAgent(options({ agentName: "ghost", spawn }));
		expect(children).toHaveLength(0);
		expect(result.exitCode).toBe(1);
		expect(result.agentSource).toBe("unknown");
		expect(result.stderr).toContain("Available agents");
		expect(result.stderr).toContain("explorer");
	});

	test("resolves an agent from the supplied pool and records its source", async () => {
		let seenPrompt = "";
		const { spawn } = makeFakeSpawn((child) => {
			seenPrompt = readFileSync(promptPath(child.args)!, "utf-8");
			child.line({ type: "message_end", message: assistantMessage("done") });
			child.close(0);
		});
		const custom = { name: "auditor", description: "Audits", systemPrompt: "You audit.", source: "user" as const };

		const result = await runSingleAgent(options({ agentName: "auditor", agents: [custom], spawn }));
		expect(result.exitCode).toBe(0);
		expect(result.agentSource).toBe("user");
		expect(seenPrompt).toContain("You audit.");
	});

	test("readOnly restricts the child tools and notes the constraint", async () => {
		let seenPrompt = "";
		let seenArgs: string[] = [];
		const { spawn } = makeFakeSpawn((child) => {
			seenArgs = child.args;
			seenPrompt = readFileSync(promptPath(child.args)!, "utf-8");
			child.close(0);
		});

		await runSingleAgent(options({ agentName: "worker", readOnly: true, spawn }));

		const toolsIndex = seenArgs.indexOf("--tools");
		expect(seenArgs[toolsIndex + 1]).toBe("read,grep,find,ls,read_doc");
		expect(seenPrompt).toContain("Read-only mode");
	});

	test("aborts the child and throws", async () => {
		const controller = new AbortController();
		const { spawn, children } = makeFakeSpawn(() => {
			/* hold the process open until the test closes it */
		});

		const promise = runSingleAgent(options({ signal: controller.signal, spawn }));
		await waitFor(() => children.length === 1);
		controller.abort();
		children[0].close(0);

		await expect(promise).rejects.toThrow("aborted");
		expect(children[0].killSignals).toContain("SIGTERM");
	});

	test("returns an aborted result when the caller asks for one", async () => {
		const controller = new AbortController();
		const { spawn, children } = makeFakeSpawn(() => {
			/* hold the process open until the test closes it */
		});

		const promise = runSingleAgent(options({ signal: controller.signal, abortAsResult: true, spawn }));
		await waitFor(() => children.length === 1);
		controller.abort();
		children[0].close(0);

		const result = await promise;
		expect(result.stopReason).toBe("aborted");
		expect(result.errorMessage).toBe("Aborted");
		expect(result.exitCode).toBe(1);
	});

	test("fails a run that outlives its deadline without aborting the call", async () => {
		const { spawn, children } = makeFakeSpawn(() => {
			/* hold the child open until the deadline kills it */
		});

		const promise = runSingleAgent(options({ spawn, timeoutMs: 5, agentName: "mute", agents: [MUTE_AGENT] }));
		await waitFor(() => children.length === 1 && children[0].killSignals.length > 0);
		children[0].close(null, "SIGTERM");

		const result = await promise;
		expect(result.timedOut).toBe(true);
		expect(result.timeoutMs).toBe(5);
		expect(result.exitCode).toBe(1);
		expect(isFailedResult(result)).toBe(true);
		expect(getResultOutput(result)).toContain("Timed out after 5ms");
	});

	test("clears the deadline once the child exits first", async () => {
		const { spawn, children } = makeFakeSpawn((child) => child.close(0));

		const result = await runSingleAgent(options({ spawn, timeoutMs: 5 }));
		expect(result.timedOut).toBeUndefined();
		await settle(20);
		expect(children[0].killSignals).toEqual([]);
	});

	test("a zero deadline disables the limit", async () => {
		const { spawn, children } = makeFakeSpawn(() => {
			/* hold the child open past any plausible limit */
		});

		const promise = runSingleAgent(options({ spawn, timeoutMs: 0, agentName: "mute", agents: [MUTE_AGENT] }));
		await waitFor(() => children.length === 1);
		await settle(20);
		expect(children[0].killSignals).toEqual([]);

		children[0].close(0);
		await promise;
	});

	test("writes a transcript for a finished run", async () => {
		const dir = store();
		const { spawn } = makeFakeSpawn((child) => {
			child.line({ type: "message_end", message: assistantMessage("done") });
			child.emitStderr("a warning");
			child.close(0);
		});

		const result = await runSingleAgent(options({ spawn, transcripts: { dir, mode: "all" } }));

		expect(result.artifactError).toBeUndefined();
		expect(existsSync(join(result.artifactPath!, "meta.json"))).toBe(true);
		expect(readFileSync(join(result.artifactPath!, "events.jsonl"), "utf-8")).toContain("message_end");
		expect(readFileSync(join(result.artifactPath!, "stderr.log"), "utf-8")).toBe("a warning");
	});

	test("failed mode keeps a failed run and skips a successful one", async () => {
		const dir = store();
		const { spawn } = makeFakeSpawn((child) => child.close(1));

		const failed = await runSingleAgent(options({ spawn, transcripts: { dir, mode: "failed" } }));
		expect(existsSync(join(failed.artifactPath!, "meta.json"))).toBe(true);

		const { spawn: okSpawn } = makeFakeSpawn((child) => child.close(0));
		const succeeded = await runSingleAgent(options({ spawn: okSpawn, transcripts: { dir, mode: "failed" } }));
		expect(succeeded.artifactPath).toBeUndefined();
		expect(readdirSync(dir)).toHaveLength(1);
	});

	test("writes the transcript of an aborted run before rejecting", async () => {
		const dir = store();
		const controller = new AbortController();
		const { spawn, children } = makeFakeSpawn(() => {
			/* hold the process open until the test aborts it */
		});

		const promise = runSingleAgent(
			options({
				signal: controller.signal,
				spawn,
				agentName: "mute",
				agents: [MUTE_AGENT],
				transcripts: { dir, mode: "all" },
			}),
		);
		await waitFor(() => children.length === 1);
		controller.abort();
		children[0].close(null, "SIGTERM");

		await expect(promise).rejects.toThrow("aborted");
		const [run] = readdirSync(dir);
		expect(JSON.parse(readFileSync(join(dir, run, "meta.json"), "utf-8")).exitCode).toBe(1);
	});

	test("records a timed-out run in failed mode", async () => {
		const dir = store();
		const { spawn, children } = makeFakeSpawn(() => {
			/* hold the child open until the deadline kills it */
		});

		const promise = runSingleAgent(
			options({ spawn, timeoutMs: 5, agentName: "mute", agents: [MUTE_AGENT], transcripts: { dir, mode: "failed" } }),
		);
		await waitFor(() => children.length === 1 && children[0].killSignals.length > 0);
		children[0].close(null, "SIGTERM");

		const result = await promise;
		const meta = JSON.parse(readFileSync(join(result.artifactPath!, "meta.json"), "utf-8"));
		expect(meta.timedOut).toBe(true);
	});

	test("reports an unwritable transcript without failing the run", async () => {
		const blocker = join(store(), "file");
		writeFileSync(blocker, "");
		const { spawn } = makeFakeSpawn((child) => child.close(0));

		const result = await runSingleAgent(options({ spawn, transcripts: { dir: blocker, mode: "all" } }));

		expect(result.artifactPath).toBeUndefined();
		expect(result.artifactError).toBeTruthy();
		expect(isFailedResult(result)).toBe(false);
	});

	test("removes the temporary system-prompt file", async () => {
		let seenPath: string | undefined;
		const { spawn } = makeFakeSpawn((child) => {
			seenPath = promptPath(child.args);
			expect(seenPath && existsSync(seenPath)).toBe(true);
			child.close(0);
		});

		await runSingleAgent(options({ spawn }));
		expect(seenPath).toBeTruthy();
		expect(existsSync(seenPath!)).toBe(false);
	});
});

const FIXED_START = Date.parse("2026-10-15T14:30:12Z");
const DAY_MS = 86_400_000;

function transcriptResult(overrides: Partial<SingleResult> = {}): SingleResult {
	return {
		agent: "explorer",
		agentSource: "builtin",
		task: "inspect the loader",
		exitCode: 0,
		messages: [],
		stderr: "",
		usage: { input: 7, output: 3, cacheRead: 0, cacheWrite: 0, cost: 0.02, contextTokens: 10, turns: 1 },
		model: "claude-sonnet-4-5",
		startedAt: FIXED_START,
		finishedAt: FIXED_START + 4_000,
		...overrides,
	};
}

/** A Pi double whose only git answer is the repository root. */
function piIn(root: string | undefined) {
	return createFakePi({
		exec: async () => (root ? { stdout: `${root}\n`, stderr: "", code: 0 } : { stdout: "", stderr: "no", code: 128 }),
	}).pi;
}

/** Create a run directory with a fixed age, as `worktree/prune.test.ts` does. */
function makeRun(dir: string, name: string, ageMs: number): string {
	const path = join(dir, name);
	mkdirSync(path, { recursive: true });
	const seconds = (FIXED_START - ageMs) / 1000;
	utimesSync(path, seconds, seconds);
	return path;
}

describe("transcripts", () => {
	test("runIdFor renders the start time in UTC with a hex suffix", () => {
		expect(runIdFor(FIXED_START, "a1b2c3")).toBe("20261015-143012-a1b2c3");
	});

	test("runIdFor sorts chronologically as a plain string", () => {
		const first = runIdFor(FIXED_START, "ffffff");
		const second = runIdFor(FIXED_START + 1_000, "000000");
		expect(first < second).toBe(true);
	});

	test("transcriptsDirFor resolves the repository's .pi/subagents", async () => {
		const repo = realpathSync.native(tempDir("subagent-repo-"));
		expect(await transcriptsDirFor(piIn(repo), repo)).toBe(join(repo, CONFIG_DIR_NAME, "subagents"));
	});

	test("transcriptsDirFor falls back to the agent directory outside a repository", async () => {
		await withAgentDir(async (agentDir) => {
			expect(await transcriptsDirFor(piIn(undefined), tempDir("subagent-cwd-"))).toBe(join(agentDir, "subagents"));
			expect(getAgentDir()).toBe(agentDir);
		}, "subagent-global-");
	});

	test("createTranscript writes the stream, stderr, and metadata for one run", () => {
		const dir = store();
		const transcript = createTranscript();
		transcript.line('{"type":"message_end"}');
		transcript.line('{"type":"tool_execution_end","isError":true}');
		transcript.stderr("a warning");

		const written = transcript.write(dir, transcriptResult({ toolErrors: 1 }), { cwd: "/repo", readOnly: true });

		expect(written.error).toBeUndefined();
		expect(written.path?.startsWith(join(dir, "20261015-143012-"))).toBe(true);
		const events = readFileSync(join(written.path!, "events.jsonl"), "utf-8");
		expect(events).toContain("message_end");
		expect(events).toContain("tool_execution_end");
		expect(readFileSync(join(written.path!, "stderr.log"), "utf-8")).toBe("a warning");
		const meta = JSON.parse(readFileSync(join(written.path!, "meta.json"), "utf-8"));
		expect(meta).toMatchObject({
			agent: "explorer",
			agentSource: "builtin",
			cwd: "/repo",
			readOnly: true,
			timedOut: false,
			toolErrors: 1,
			model: "claude-sonnet-4-5",
		});
		expect(meta.runId.startsWith("20261015-143012-")).toBe(true);
	});

	test("createTranscript stops at the size cap and marks the truncation", () => {
		const dir = store();
		const transcript = createTranscript({ maxBytes: 40 });
		transcript.line("a".repeat(30));
		transcript.line("b".repeat(30));

		const written = transcript.write(dir, transcriptResult(), { cwd: "/repo", readOnly: false });

		expect(written.truncated).toBe(true);
		const events = readFileSync(join(written.path!, "events.jsonl"), "utf-8");
		expect(events).toContain('"transcript-truncated"');
		expect(events).not.toContain("bbbb");
		expect(JSON.parse(readFileSync(join(written.path!, "meta.json"), "utf-8")).transcript.truncated).toBe(true);
	});

	test("createTranscript reports an unwritable store instead of throwing", () => {
		const blocker = join(store(), "file");
		writeFileSync(blocker, "");

		const written = createTranscript().write(blocker, transcriptResult(), { cwd: "/repo", readOnly: false });

		expect(written.path).toBeUndefined();
		expect(written.error).toBeTruthy();
	});

	test("pruneTranscripts removes runs past the retention window and keeps the rest", () => {
		const dir = store();
		const aged = makeRun(dir, "20260101-000000-aaaaaa", 30 * DAY_MS);
		const fresh = makeRun(dir, "20260110-000000-bbbbbb", DAY_MS);

		const outcome = pruneTranscripts(dir, { retentionDays: 14, maxRuns: 100, now: FIXED_START });

		expect(outcome.removed).toEqual(["20260101-000000-aaaaaa"]);
		expect(existsSync(aged)).toBe(false);
		expect(existsSync(fresh)).toBe(true);
	});

	test("pruneTranscripts keeps only the newest runs beyond the count cap", () => {
		const dir = store();
		makeRun(dir, "20260101-000000-aaaaaa", 3 * DAY_MS);
		makeRun(dir, "20260102-000000-bbbbbb", 2 * DAY_MS);
		const newest = makeRun(dir, "20260103-000000-cccccc", DAY_MS);

		const outcome = pruneTranscripts(dir, { retentionDays: 3650, maxRuns: 1, now: FIXED_START });

		expect(outcome.removed).toEqual(["20260101-000000-aaaaaa", "20260102-000000-bbbbbb"]);
		expect(outcome.kept).toBe(1);
		expect(existsSync(newest)).toBe(true);
	});

	test("pruneTranscripts never touches a directory that is not a run id", () => {
		const dir = store();
		const notes = makeRun(dir, "notes", 30 * DAY_MS);

		const outcome = pruneTranscripts(dir, { retentionDays: 1, maxRuns: 1, now: FIXED_START });

		expect(outcome.removed).toEqual([]);
		expect(existsSync(notes)).toBe(true);
	});

	test("pruneTranscripts returns quietly when the store does not exist yet", () => {
		const missing = join(store(), "absent");
		expect(pruneTranscripts(missing, { retentionDays: 14, maxRuns: 10, now: FIXED_START })).toEqual({
			removed: [],
			kept: 0,
		});
	});
});

const AGENT = BUILTIN_AGENTS[0]!.name;

/** One recorded custom entry. */
function entry(data: unknown): unknown {
	return { type: "custom", customType: BACKGROUND_ENTRY, data };
}

/** A finished run with one turn of usage. */
function backgroundResult(text = "done", overrides: Partial<SingleResult> = {}): SingleResult {
	const usage: UsageStats = {
		input: 10,
		output: 5,
		cacheRead: 0,
		cacheWrite: 0,
		cost: 0.01,
		contextTokens: 20,
		turns: 1,
	};
	return {
		...createResult("explorer", "task"),
		exitCode: 0,
		usage,
		stderr: text,
		finishedAt: 2000,
		...overrides,
	};
}

/** A runtime with one deferred child. */
function harness(options: { appendEntry?: (type: string, data: unknown) => void; max?: number } = {}) {
	const clock = makeClock(1000);
	const records: unknown[] = [];
	const finished: BackgroundRun[] = [];
	let seen: RunOptions | undefined;
	let resolveRun: ((value: SingleResult) => void) | undefined;
	const run = (next: RunOptions): Promise<SingleResult> => {
		seen = next;
		return new Promise((resolve) => {
			resolveRun = resolve;
		});
	};
	const runtime = createBackgroundRuntime({
		appendEntry: options.appendEntry ?? ((_type, data) => records.push(entry(data))),
		onFinish: (run) => finished.push(run),
		now: clock.now,
	});
	const deps = {
		run,
		agents: BUILTIN_AGENTS,
		defaults: {},
		defaultCwd: "/repo",
		timeoutMs: 1000,
		backgroundMax: options.max ?? 2,
	};
	const start = (branch: readonly unknown[] = [], input: Partial<BackgroundStartInput> = {}) =>
		runtime.start({ agent: AGENT, task: "do the task", cwd: "/repo", ...input }, branch, deps);
	return {
		runtime,
		records,
		clock,
		finished,
		start,
		run: () => seen,
		resolve: (value: SingleResult) => resolveRun?.(value),
	};
}

describe("background runtime", () => {
	test("starts immediately, appends a start entry, and lists it as running", async () => {
		const h = harness();
		const started = h.start();
		expect(started.ok).toBe(true);
		if (!started.ok) return;
		// The runtime canonicalizes the working directory, so the assertion does too.
		expect(started.run).toMatchObject({ id: "a1", agent: AGENT, status: "running", cwd: resolve("/repo") });
		await settle();

		const run = h.run();
		expect(run?.abortAsResult).toBe(true);
		expect(run?.signal).toBeDefined();
		expect(h.runtime.list([])).toEqual([started.run]);
		expect(h.records).toHaveLength(1);
	});

	test("finishes, appends a finish entry, and collects the output and usage", async () => {
		const h = harness();
		h.start();
		await settle();
		h.clock.advance(1500);
		h.resolve(backgroundResult("finished output"));
		await settle();

		const runs = h.runtime.list([]);
		expect(runs[0]).toMatchObject({ status: "finished", exitCode: 0, output: "finished output" });
		expect(h.records).toHaveLength(2);
		expect(h.finished).toHaveLength(1);
		expect(h.finished[0]).toMatchObject({ id: "a1", status: "finished", output: "finished output" });
		const collected = h.runtime.collect("a1", []);
		expect(collected).toMatchObject({ ok: true });
		if (!collected.ok) return;
		expect(collected.text).toContain("Background subagent a1");
		expect(collected.text).toContain("finished output");
		expect(collected.text).toContain("Usage:");
	});

	test("updates a running row with a bounded live preview", async () => {
		const h = harness();
		h.start();
		await settle();
		const partial = backgroundResult("", { exitCode: -1 });
		applyEvent(partial, {
			type: "message_end",
			message: { role: "assistant", content: [{ type: "text", text: "Reading auth..." }] },
		});
		h.run()?.onUpdate?.({ content: [], details: { mode: "single", results: [partial] } });
		h.run()?.onUpdate?.({
			content: [],
			details: { mode: "single", results: [backgroundResult("", { exitCode: -1 })] },
		});

		expect(h.runtime.list([])[0]).toMatchObject({ status: "running", output: "Reading auth..." });
	});

	test("keeps a long live preview bounded at the tail", async () => {
		const h = harness();
		h.start();
		await settle();
		const partial = backgroundResult("", { exitCode: -1 });
		const text = `${"x".repeat(9_000)}tail`;
		applyEvent(partial, {
			type: "message_end",
			message: { role: "assistant", content: [{ type: "text", text }] },
		});
		h.run()?.onUpdate?.({ content: [], details: { mode: "single", results: [partial] } });

		const output = h.runtime.list([])[0]?.output ?? "";
		expect(output.startsWith("… earlier output omitted")).toBe(true);
		expect(output.endsWith("tail")).toBe(true);
		expect(output.length).toBeLessThan(text.length);
	});

	test("cancels one run and reports it as cancelled", async () => {
		const h = harness();
		h.start();
		await settle();
		expect(h.runtime.cancel("a1")).toBe(true);
		h.resolve(backgroundResult("", { exitCode: 1, stopReason: "aborted", errorMessage: "Aborted" }));
		await settle();

		expect(h.runtime.list([])[0]).toMatchObject({ status: "cancelled", errorMessage: "Aborted" });
	});

	test("refuses to collect a run that is still running", async () => {
		const h = harness();
		h.start();
		await settle();

		expect(h.runtime.collect("a1", [])).toEqual({ ok: false, reason: "a1 is still running." });
	});

	test("refuses more than the configured number of running runs", async () => {
		const h = harness({ max: 1 });
		expect(h.start().ok).toBe(true);
		await settle();
		const second = h.start();
		expect(second).toEqual({
			ok: false,
			error: "Too many background runs (1); wait for one to finish or cancel it.",
		});
	});

	test("refuses an unknown agent and records nothing", () => {
		const h = harness();
		const started = h.start([], { agent: "ghost" });
		expect(started).toEqual({ ok: false, error: 'Unknown agent: "ghost".' });
		expect(h.records).toEqual([]);
	});

	test("rolls back a start whose entry cannot be recorded", () => {
		const h = harness({
			appendEntry: () => {
				throw new Error("disk full");
			},
		});
		expect(h.start()).toEqual({ ok: false, error: "Could not record the background run." });
		expect(h.runtime.list([])).toEqual([]);
	});

	test("replays start-only entries as interrupted", () => {
		const h = harness();
		const branch = [
			entry({
				phase: "start",
				runId: "a7",
				agent: "explorer",
				task: "old task",
				cwd: "/repo",
				startedAt: 500,
			}),
		];

		expect(h.runtime.list(branch)).toEqual([
			{
				id: "a7",
				agent: "explorer",
				task: "old task",
				cwd: "/repo",
				startedAt: 500,
				status: "interrupted",
			},
		]);
		expect(h.runtime.collect("a7", branch)).toEqual({ ok: false, reason: "a7 was interrupted before it finished." });
	});

	test("replays a finished start/finish pair from the branch", () => {
		const h = harness();
		const branch = [
			entry({
				phase: "start",
				runId: "a3",
				agent: "explorer",
				task: "old task",
				cwd: "/repo",
				startedAt: 500,
			}),
			entry({
				phase: "finish",
				runId: "a3",
				finishedAt: 1500,
				status: "finished",
				exitCode: 0,
				usage: {
					input: 1,
					output: 1,
					cacheRead: 0,
					cacheWrite: 0,
					cost: 0,
					contextTokens: 2,
					turns: 1,
				},
				output: "old output",
			}),
		];

		expect(h.runtime.list(branch)[0]).toMatchObject({
			id: "a3",
			status: "finished",
			output: "old output",
			finishedAt: 1500,
		});
		expect(h.runtime.collect("a3", branch)).toMatchObject({ ok: true, text: expect.stringContaining("old output") });
	});

	test("continues the aN sequence after runs already on the branch", () => {
		const h = harness();
		const branch = [
			entry({
				phase: "start",
				runId: "a7",
				agent: "explorer",
				task: "old task",
				cwd: "/repo",
				startedAt: 500,
			}),
		];

		const started = h.start(branch);
		expect(started.ok && started.run.id).toBe("a8");
	});

	test("reset clears a shutdown for a new session", () => {
		const h = harness();
		h.runtime.shutdown();
		expect(h.start().ok).toBe(false);
		h.runtime.reset();
		expect(h.start().ok).toBe(true);
	});

	test("shutdown aborts a live child and drops it from the live list", async () => {
		const h = harness();
		h.start();
		await settle();
		const signal = h.run()?.signal;
		expect(signal?.aborted).toBe(false);
		h.runtime.shutdown();
		expect(signal?.aborted).toBe(true);
		expect(h.runtime.list([])).toEqual([]);
	});

	test("reports duration and collectability", () => {
		const run = {
			id: "a1",
			agent: "explorer",
			task: "task",
			cwd: "/repo",
			startedAt: 1000,
			status: "finished" as const,
		};
		expect(formatBackgroundDuration(run, 2500)).toBe("1.5s");
		expect(canCollect(run)).toBe(true);
		expect(canCollect({ ...run, status: "running" })).toBe(false);
		expect(canCollect({ ...run, status: "interrupted" })).toBe(false);
	});
});

const USAGE = {
	input: 1200,
	output: 800,
	cacheRead: 0,
	cacheWrite: 0,
	cost: 0.01,
	contextTokens: 2000,
	turns: 1,
};

const RUNS: BackgroundRun[] = [
	{ id: "a2", agent: "explorer", task: "Map the auth module", cwd: "/repo", startedAt: 1000, status: "running" },
	{
		id: "a1",
		agent: "reviewer",
		task: "Review",
		cwd: "/repo",
		startedAt: 0,
		finishedAt: 62_000,
		status: "finished",
		usage: USAGE,
		output: "The diff is coherent.",
	},
	{
		id: "a0",
		agent: "worker",
		task: "Fix the parser",
		cwd: "/repo",
		startedAt: 0,
		finishedAt: 1_000,
		status: "failed",
		exitCode: 1,
		errorMessage: "exit 1",
		output: "boom",
	},
];

/** Mount the board. */
function board(overrides: Partial<ConstructorParameters<typeof AgentsBoardComponent>[0]> = {}) {
	const actions = { collect: [] as string[], cancel: [] as string[], close: 0 };
	const component = new AgentsBoardComponent({
		runs: () => RUNS,
		theme: fakeTheme,
		now: () => 12_000,
		onCollect: (id) => actions.collect.push(id),
		onCancel: (id) => actions.cancel.push(id),
		onClose: () => {
			actions.close += 1;
		},
		requestRender: () => {},
		viewportRows: () => 40,
		...overrides,
	});
	return { component, actions };
}

describe("agents board", () => {
	test("lists runs with status, task, duration, and usage", () => {
		const text = screenText(board().component);

		expect(text).toContain("Agents");
		expect(text).toContain("3 runs · 1 running");
		expect(text).toContain("a2 explorer");
		expect(text).toContain("Map the auth module");
		expect(text).toContain("a1 reviewer");
		expect(text).toContain("Review");
		expect(text).toContain("finished");
		expect(text).toContain("1m02s");
		expect(text).toContain("↑1.2k");
	});

	test("the detail pane states the run's task, cwd, status, duration, and usage", () => {
		const { component } = board();
		component.handleInput("\r");

		const detail = screenText(component);
		expect(detail).toContain("Run · a2 explorer");
		expect(detail).toContain("running · 11.0s");
		expect(detail).toContain("Task");
		expect(detail).toContain("Map the auth module");
		expect(detail).toContain("Cwd");
		expect(detail).toContain("/repo");
		expect(detail).toContain("Usage");
		expect(detail).toContain("Esc back");
	});

	test("the detail pane adds the error and transcript rows when the run has them", () => {
		const failed: BackgroundRun[] = [
			{
				id: "a4",
				agent: "worker",
				task: "Fix the parser",
				cwd: "/repo",
				startedAt: 0,
				finishedAt: 1_000,
				status: "failed",
				errorMessage: "exit 1",
				artifactPath: "/repo/.pi/subagents/20261015-143012-abcdef",
			},
		];
		const { component } = board({ runs: () => failed });
		component.handleInput("\r");

		const detail = screenText(component);
		expect(detail).toContain("Error");
		expect(detail).toContain("exit 1");
		expect(detail).toContain("Transcript");
		expect(detail).toContain("/repo/.pi/subagents/20261015-143012-abcdef");
	});

	test("c collects a finished run and x cancels a running one", () => {
		const { component, actions } = board();
		component.handleInput("x"); // a2, running
		expect(actions.cancel).toEqual(["a2"]);

		component.handleInput("j"); // a1, finished
		component.handleInput("c");
		expect(actions.collect).toEqual(["a1"]);
		component.handleInput("x"); // a1 is finished, no-op
		expect(actions.cancel).toEqual(["a2"]);
	});

	test("shows the board's empty state", () => {
		const { component } = board({ runs: () => [] });
		expect(screenText(component)).toContain("No background subagents yet.");
	});

	test("shows a live preview and falls back before output arrives", () => {
		let runs: BackgroundRun[] = [{ ...RUNS[0]! }];
		const { component } = board({ runs: () => runs });
		component.handleInput("\r");
		expect(screenText(component)).toContain("Still running…");

		runs = [{ ...runs[0]!, output: "Reading auth..." }];
		const detail = screenText(component);
		expect(detail).toContain("Reading auth...");
		expect(detail).not.toContain("Still running…");
	});

	test("reflects a finish without rebuilding", () => {
		let runs: BackgroundRun[] = [{ ...RUNS[0]! }];
		const { component } = board({ runs: () => runs });
		expect(screenText(component)).toContain("running");
		runs = [{ ...runs[0]!, status: "finished", finishedAt: 5_000, output: "done" }];
		const text = screenText(component);
		expect(text).toContain("finished");
		expect(text).not.toContain("1 running");
	});
});
