import { afterEach, describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
	formatCallText,
	formatCompletion,
	formatJobList,
	formatJobOutcomeLine,
	formatJobStatus,
	formatLogs,
	jobOutcome,
	pendingFailures,
	tailLines,
} from "./format.ts";
import jobs from "./index.ts";
import { TOOL_NAME } from "./tools.ts";
import type { JobRecord } from "./types.ts";
import { createFakePi, fakeTheme as theme } from "../../test/helpers/fakes.ts";
import { makeCtx, makeHarnessSuite, readLog } from "../../test/helpers/fixtures/job.ts";
import { waitFor } from "../../test/helpers/process.ts";

const suite = makeHarnessSuite();
afterEach(() => suite.cleanup());

function record(overrides: Partial<JobRecord> = {}): JobRecord {
	return {
		id: "j1",
		label: "tests",
		command: "bun test",
		cwd: "/repo",
		pid: 1234,
		status: "running",
		exitCode: null,
		signal: null,
		startedAt: 1000,
		finishedAt: null,
		logPath: "/tmp/j1.log",
		detached: false,
		wake: false,
		stdin: false,
		sessionId: "s1",
		seen: false,
		lastLine: "",
		statusPath: null,
		startToken: null,
		...overrides,
	};
}

async function setup(options: Parameters<typeof suite.makeHarness>[0] = {}) {
	const h = suite.makeHarness(options);
	const { pi, tools } = createFakePi();
	jobs(pi, { runtime: h.runtime });
	const { ctx } = makeCtx();
	await h.runtime.load(ctx);
	const tool = tools.get(TOOL_NAME);
	const call = (params: Record<string, unknown>) =>
		tool.execute("t", params, undefined, undefined, ctx) as Promise<any>;
	return { h, tool, call, ctx };
}

describe("job tool", () => {
	test("starts a job and returns its id", async () => {
		const { call } = await setup();
		const result = await call({ action: "start", command: "sleep 1" });
		expect(result.content[0].text).toContain("Started j1");
		expect(result.details.action).toBe("start");
		expect(result.details.job.id).toBe("j1");
	});

	test("returns the Windows detach refusal as a tool error", async () => {
		const { call, h } = await setup({ isWindows: () => true });

		const result = await call({ action: "start", command: "sleep 60", detached: true });

		// The model reads the error, not a crash: it names every way out.
		expect(result.content[0].text).toContain("cannot outlive the session on Windows");
		expect(result.content[0].text).toContain("subagent");
		expect(h.children).toHaveLength(0);
	});

	test("lists jobs", async () => {
		const { call } = await setup();
		await call({ action: "start", command: "sleep 1" });
		const result = await call({ action: "list" });
		expect(result.content[0].text).toContain("j1");
		expect(result.details.jobs).toHaveLength(1);
		// The transcript tags rows another session owns, so the call records which
		// session made it.
		expect(typeof result.details.sessionId).toBe("string");
	});

	test("status returns the job", async () => {
		const { call } = await setup();
		await call({ action: "start", command: "sleep 1" });
		const result = await call({ action: "status", id: "j1" });
		expect(result.content[0].text).toContain("running");
		expect(result.details.job.id).toBe("j1");
	});

	test("logs returns the sanitized tail", async () => {
		const { h, call } = await setup();
		await call({ action: "start", command: "sleep 1" });
		h.children[0].write("\u001b[31mred\u001b[0m\nsecond\n");
		await waitFor(() => h.runtime.get("j1")?.lastLine === "second");
		await waitFor(() => readLog(h.runtime.get("j1")!.logPath).includes("second"));
		const result = await call({ action: "logs", id: "j1", lines: 5 });
		expect(result.content[0].text).toContain("second");
		expect(result.content[0].text).not.toContain("\u001b");
		// The transcript reads `details.logs`, so it must carry the sanitized tail,
		// not the model-facing header block.
		expect(result.details.logs).toContain("second");
		expect(result.details.logs).not.toContain("output:");
	});

	test("kill signals the process", async () => {
		const { h, call } = await setup();
		await call({ action: "start", command: "sleep 1" });
		const result = await call({ action: "kill", id: "j1", signal: "SIGTERM" });
		expect(result.details.signalled).toBe(true);
		expect(result.details.signal).toBe("SIGTERM");
		expect(h.kills[0].signal).toBe("SIGTERM");
	});

	test("wait reports a timeout without killing the job", async () => {
		const { h, call } = await setup();
		await call({ action: "start", command: "sleep 1" });
		const result = await call({ action: "wait", id: "j1", timeoutMs: 0 });
		expect(result.details.timedOut).toBe(true);
		expect(h.runtime.get("j1")?.status).toBe("running");
	});

	test("wait reports progress while it blocks", async () => {
		const { tool, ctx } = await setup();
		await tool.execute("t", { action: "start", command: "sleep 1" }, undefined, undefined, ctx);
		const updates: Array<{ content?: Array<{ text?: string }> }> = [];
		await tool.execute(
			"t",
			{ action: "wait", id: "j1", timeoutMs: 0 },
			undefined,
			(update: unknown) => updates.push(update as { content?: Array<{ text?: string }> }),
			ctx,
		);
		expect(updates[0]?.content?.[0]?.text).toContain("Waiting on j1");
	});

	test("clear removes finished jobs", async () => {
		const { h, call } = await setup();
		await call({ action: "start", command: "sleep 1" });
		h.children[0].close(0);
		const result = await call({ action: "clear" });
		expect(result.details.cleared).toBe(1);
	});

	test("id actions report an unknown job as an error result", async () => {
		const { call } = await setup();
		for (const params of [
			{ action: "status", id: "j9" },
			{ action: "logs", id: "j9" },
			{ action: "kill", id: "j9" },
			{ action: "wait", id: "j9" },
			{ action: "clear", id: "j9" },
		]) {
			const result = await call(params);
			expect(result.isError, params.action).toBe(true);
			expect(result.content[0].text).toContain('no job "j9"');
		}
	});

	test("clear refuses a running job as an error result", async () => {
		const { call } = await setup();
		await call({ action: "start", command: "sleep 1" });
		const result = await call({ action: "clear", id: "j1" });
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("still running");
	});

	test("rejects an unknown action with an error result", async () => {
		const { call } = await setup();
		const result = await call({ action: "explode" });
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("action must be one of");
	});

	test("forwards wake, detached, and timeoutMs on start", async () => {
		// Detaching exists on POSIX only, and Windows refuses it, so pin the host.
		const { call } = await setup({ isWindows: () => false });
		const result = await call({ action: "start", command: "sleep 1", wake: true, detached: true, timeoutMs: 5000 });
		expect(result.details.job.wake).toBe(true);
		expect(result.details.job.detached).toBe(true);
		expect(result.details.job.id).toBe("j1");
	});

	test("sends input to a job started with stdin", async () => {
		const { h, call } = await setup();
		await call({ action: "start", command: "cat", stdin: true });
		const result = await call({ action: "send", id: "j1", input: "hello" });
		expect(result.content[0].text).toContain("Sent 5 characters to j1");
		expect(result.details.action).toBe("send");
		expect(result.details.sent).toBe(5);
		expect(result.details.stdinClosed).toBe(false);
		expect(h.children[0].stdinSink?.text).toBe("hello\n");
	});

	test("send reports EOF and refuses a write after it", async () => {
		const { call } = await setup();
		await call({ action: "start", command: "cat", stdin: true });
		const closed = await call({ action: "send", id: "j1", eof: true });
		expect(closed.content[0].text).toBe("Closed j1's stdin.");
		expect(closed.details.stdinClosed).toBe(true);
		const refused = await call({ action: "send", id: "j1", input: "more" });
		expect(refused.isError).toBe(true);
		expect(refused.content[0].text).toContain("closed its stdin");
	});

	test("send without stdin is an error result", async () => {
		const { call } = await setup();
		await call({ action: "start", command: "sleep 1" });
		const result = await call({ action: "send", id: "j1", input: "x" });
		expect(result.isError).toBe(true);
		expect(result.details.error).toContain("was not started with stdin");
	});
});

describe("job format", () => {
	test("formatJobList lists jobs with ids and status", async () => {
		const text = formatJobList([record(), record({ id: "j2", status: "exited", exitCode: 0 })], 5000);
		expect(text).toContain("j1");
		expect(text).toContain("j2");
		expect(text).toMatch(/Jobs \(2\)/);
	});

	test("formatJobList reports no jobs", async () => {
		expect(formatJobList([])).toBe("No jobs.");
	});

	test("formatJobList marks a job another session owns", async () => {
		const entries = [record({ id: "j1", sessionId: "me" }), record({ id: "j9", sessionId: "peer" })];
		const text = formatJobList(entries, 5000, "me");
		const rows = text.split("\n").slice(1);
		expect(rows[0]).not.toContain("another session");
		expect(rows[1]).toContain("(another session)");
	});

	test("formatJobStatus names the session when another owns the job", async () => {
		expect(formatJobStatus(record({ sessionId: "peer" }), 5000, "me")).toContain("session: another session");
		expect(formatJobStatus(record({ sessionId: "me" }), 5000, "me")).not.toContain("another session");
	});

	test("formatCompletion names the status and label", async () => {
		const text = formatCompletion(record({ status: "failed", exitCode: 2, lastLine: "boom" }), 5000);
		expect(text).toContain("failed (exit 2)");
		expect(text).toContain("tests");
		expect(text).toContain("boom");
	});

	test("tailLines keeps only the last N lines", async () => {
		expect(tailLines(["a", "b", "c"], 2)).toEqual(["b", "c"]);
		expect(tailLines(["a"], 0)).toEqual([]);
	});

	test("formatLogs returns a no-output note with the log path", async () => {
		expect(formatLogs(record(), [], 1000).text).toContain("no output yet");
	});

	test("formatLogs truncates long output and points at the full log", async () => {
		const result = formatLogs(record(), ["y".repeat(50), "z".repeat(50)], 20);
		expect(result.truncated).toBe(true);
		expect(result.text).toContain("/tmp/j1.log");
	});

	test("pendingFailures lists only unseen failures", async () => {
		const entries = [
			record({ id: "a", status: "failed", seen: false }),
			record({ id: "b", status: "failed", seen: true }),
			record({ id: "c", status: "exited", seen: false }),
		];
		expect(pendingFailures(entries).map((entry) => entry.id)).toEqual(["a"]);
	});

	test("jobOutcome names pid, exit code, and signal", async () => {
		expect(jobOutcome(record({ status: "running", pid: 42 }))).toBe("pid 42");
		expect(jobOutcome(record({ status: "exited", exitCode: 0 }))).toBe("exit 0");
		expect(jobOutcome(record({ status: "failed", exitCode: 2 }))).toBe("exit 2");
		expect(jobOutcome(record({ status: "killed", signal: "SIGKILL" }))).toBe("SIGKILL");
		expect(jobOutcome(record({ status: "unknown" }))).toBe("—");
	});

	test("formatJobOutcomeLine summarizes each status", async () => {
		expect(formatJobOutcomeLine(record({ status: "running", pid: 1234 }), theme, 4200)).toBe(
			"▸ j1 tests · pid 1234 · 3.2s",
		);
		expect(
			formatJobOutcomeLine(record({ status: "exited", exitCode: 0, pid: null, finishedAt: 3000 }), theme, 3000),
		).toBe("✓ j1 tests · exit 0 · 2.0s");
		expect(
			formatJobOutcomeLine(record({ status: "failed", exitCode: 1, pid: null, finishedAt: 3000 }), theme, 3000),
		).toBe("✗ j1 tests · exit 1 · 2.0s");
		expect(
			formatJobOutcomeLine(record({ status: "killed", signal: "SIGTERM", pid: null, finishedAt: 3000 }), theme, 3000),
		).toBe("⊝ j1 tests · SIGTERM · 2.0s");
	});

	test("formatCallText previews a start command", async () => {
		expect(formatCallText("start", { command: "bun test" })).toBe("start → bun test");
	});

	test("formatCallText names the target for status/logs/kill/wait", async () => {
		expect(formatCallText("kill", { id: "j3" })).toBe("kill j3");
		expect(formatCallText("wait", { id: "j3" })).toBe("wait j3");
	});

	test("formatCallText previews the input a send writes, and its EOF", async () => {
		expect(formatCallText("send", { id: "j3", input: "hello" })).toBe("send j3 → hello");
		expect(formatCallText("send", { id: "j3", input: "hello", eof: true })).toBe("send j3 → hello + EOF");
		expect(formatCallText("send", { id: "j3", eof: true })).toBe("send j3 → EOF");
	});

	test("formatCallText collapses a multi-line send input to one sanitized line", async () => {
		expect(formatCallText("send", { id: "j3", input: "one\ntwo\u001b[31m" })).toBe("send j3 → one two");
	});

	test("formatCallText clips a wide-character command by display column", async () => {
		const text = formatCallText("start", { command: "界".repeat(40) });
		expect(text.startsWith("start → ")).toBe(true);
		expect(visibleWidth(text.slice("start → ".length))).toBeLessThanOrEqual(48);
	});
});

describe("job transcript rendering", () => {
	test("an expanded list shows every job with no cap hint", async () => {
		const { tool } = await setup();
		const entries = Array.from({ length: 10 }, (_, i) => record({ id: `j${i + 1}`, label: `job ${i + 1}` }));
		const result = { content: [{ type: "text", text: "model" }], details: { action: "list", jobs: entries } };
		const text = tool
			.renderResult(result, { expanded: true, isPartial: false }, theme, { lastComponent: undefined })
			.render(80)
			.join("\n");
		expect(text).toContain("j10");
		expect(text).not.toContain("more");
	});

	test("collapsed logs cap at the result rows and expanded logs show all", async () => {
		const { tool } = await setup();
		const logs = Array.from({ length: 12 }, (_, i) => `line ${i}`).join("\n");
		const result = { content: [{ type: "text", text: "model" }], details: { action: "logs", logs, job: record() } };
		const collapsed = tool
			.renderResult(result, { expanded: false, isPartial: false }, theme, { lastComponent: undefined })
			.render(80);
		expect(collapsed[0]).toBe("");
		expect(collapsed[1]).toContain("… 4 earlier lines");
		expect(collapsed.at(-1)).toContain("line 11");

		const expanded = tool
			.renderResult(result, { expanded: true, isPartial: false }, theme, { lastComponent: undefined })
			.render(80);
		expect(expanded.some((line: string) => line.includes("earlier"))).toBe(false);
		expect(expanded).toHaveLength(1 + 12);
	});

	test("empty list and clear render a muted status", async () => {
		const { tool } = await setup();
		const empty = { content: [{ type: "text", text: "No jobs." }], details: { action: "list", jobs: [] } };
		const emptyText = tool
			.renderResult(empty, { expanded: false, isPartial: false }, theme, { lastComponent: undefined })
			.render(80)
			.join("\n");
		expect(emptyText).toContain("No jobs.");

		const cleared = {
			content: [{ type: "text", text: "Cleared 2 jobs." }],
			details: { action: "clear", cleared: 2 },
		};
		const clearedText = tool
			.renderResult(cleared, { expanded: false, isPartial: false }, theme, { lastComponent: undefined })
			.render(80)
			.join("\n");
		expect(clearedText).toContain("Cleared 2 jobs.");
	});

	test("empty logs render a muted note", async () => {
		const { tool } = await setup();
		const result = { content: [{ type: "text", text: "model" }], details: { action: "logs", logs: "", job: record() } };
		const text = tool
			.renderResult(result, { expanded: false, isPartial: false }, theme, { lastComponent: undefined })
			.render(80)
			.join("\n");
		expect(text).toContain("No output yet.");
	});

	test("kill confirms the signal instead of the stale running row", async () => {
		const { tool } = await setup();
		const result = {
			content: [{ type: "text", text: "model" }],
			details: { action: "kill", job: record({ status: "running", pid: 321 }), signalled: true, signal: "SIGKILL" },
		};
		const text = tool
			.renderResult(result, { expanded: false, isPartial: false }, theme, { lastComponent: undefined })
			.render(80)
			.join("\n");
		expect(text).toContain("j1");
		expect(text).toContain("SIGKILL sent");
	});

	test("start surfaces detached and wake badges", async () => {
		const { tool } = await setup();
		const result = {
			content: [{ type: "text", text: "model" }],
			details: { action: "start", job: record({ status: "running", detached: true, wake: true }) },
		};
		const text = tool
			.renderResult(result, { expanded: false, isPartial: false }, theme, { lastComponent: undefined })
			.render(80)
			.join("\n");
		expect(text).toContain("detached");
		expect(text).toContain("wake");
	});

	test("send surfaces how much it wrote and whether stdin closed", async () => {
		const { tool } = await setup();
		const result = {
			content: [{ type: "text", text: "model" }],
			details: { action: "send", job: record({ status: "running" }), sent: 5, stdinClosed: true },
		};
		const text = tool
			.renderResult(result, { expanded: false, isPartial: false }, theme, { lastComponent: undefined })
			.render(80)
			.join("\n");
		expect(text).toContain("sent 5");
		expect(text).toContain("stdin closed");
	});

	test("status renders a compact outcome line", async () => {
		const { tool } = await setup();
		const entry = record({ id: "j1", label: "tests", status: "exited", exitCode: 0, pid: null, finishedAt: 100 });
		const result = { content: [{ type: "text", text: "model" }], details: { action: "status", job: entry } };
		const text = tool
			.renderResult(result, { expanded: false, isPartial: false }, theme, { lastComponent: undefined })
			.render(80)
			.join("\n");
		expect(text).toContain("✓ j1 tests");
		expect(text).toContain("exit 0");
	});

	test("wait notes a timeout", async () => {
		const { tool } = await setup();
		const result = {
			content: [{ type: "text", text: "model" }],
			details: { action: "wait", job: record(), timedOut: true },
		};
		const text = tool
			.renderResult(result, { expanded: false, isPartial: false }, theme, { lastComponent: undefined })
			.render(80)
			.join("\n");
		expect(text).toContain("still running after the timeout");
	});

	test("wait notes a cancelled wait", async () => {
		const { tool } = await setup();
		const result = {
			content: [{ type: "text", text: "model" }],
			details: { action: "wait", job: record(), cancelled: true },
		};
		const text = tool
			.renderResult(result, { expanded: false, isPartial: false }, theme, { lastComponent: undefined })
			.render(80)
			.join("\n");
		expect(text).toContain("wait cancelled; job still running");
	});

	test("partial renders the waiting state", async () => {
		const { tool } = await setup();
		const result = {
			content: [{ type: "text", text: "Waiting on j1…" }],
			details: { action: "wait", job: record() },
		};
		const text = tool
			.renderResult(result, { expanded: false, isPartial: true }, theme, { lastComponent: undefined })
			.render(80)
			.join("\n");
		expect(text).toContain("Waiting on j1…");
	});

	test("a job-supplied error detail is sanitized", async () => {
		const { tool } = await setup();
		const result = {
			content: [{ type: "text", text: "Error: no job" }],
			details: { action: "status", error: 'no job "j1\u001b[31m".' },
			isError: true,
		};
		const text = tool
			.renderResult(result, { expanded: false, isPartial: false }, theme, { lastComponent: undefined })
			.render(80)
			.join("\n");
		expect(text).toContain("no job");
		expect(text).not.toContain("\u001b");
	});
});
