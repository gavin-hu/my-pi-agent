import { afterEach, describe, expect, test } from "bun:test";
import jobs from "./index.ts";
import { TOOL_NAME } from "./tools.ts";
import { createFakePi, fakeTheme as theme } from "../../test/helpers/fakes.ts";
import { makeCtx, makeHarnessSuite, readLog } from "../../test/helpers/fixtures/job.ts";
import { waitFor } from "../../test/helpers/process.ts";
import type { JobRecord } from "./types.ts";

const suite = makeHarnessSuite();
const makeHarness = suite.makeHarness;
afterEach(() => suite.cleanup());

function setup() {
	const h = makeHarness();
	const { pi, tools } = createFakePi();
	jobs(pi, { runtime: h.runtime });
	const { ctx } = makeCtx();
	h.runtime.load(ctx);
	const tool = tools.get(TOOL_NAME);
	const call = (params: Record<string, unknown>) =>
		tool.execute("t", params, undefined, undefined, ctx) as Promise<any>;
	return { h, tool, call, ctx };
}

describe("job tool", () => {
	test("starts a job and returns its id", async () => {
		const { call } = setup();
		const result = await call({ action: "start", command: "sleep 1" });
		expect(result.content[0].text).toContain("Started j1");
		expect(result.details.action).toBe("start");
		expect(result.details.job.id).toBe("j1");
	});

	test("lists jobs", async () => {
		const { call } = setup();
		await call({ action: "start", command: "sleep 1" });
		const result = await call({ action: "list" });
		expect(result.content[0].text).toContain("j1");
		expect(result.details.jobs).toHaveLength(1);
		// The transcript tags rows another session owns, so the call records which
		// session made it.
		expect(typeof result.details.sessionId).toBe("string");
	});

	test("status returns details and errors on an unknown id", async () => {
		const { call } = setup();
		await call({ action: "start", command: "sleep 1" });
		const ok = await call({ action: "status", id: "j1" });
		expect(ok.content[0].text).toContain("running");
	});

	test("status errors on an unknown id", async () => {
		const { call } = setup();
		const missing = await call({ action: "status", id: "j9" });
		expect(missing.isError).toBe(true);
	});

	test("logs returns the sanitized tail", async () => {
		const { h, call } = setup();
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
		const { h, call } = setup();
		await call({ action: "start", command: "sleep 1" });
		const result = await call({ action: "kill", id: "j1", signal: "SIGTERM" });
		expect(result.details.signalled).toBe(true);
		expect(result.details.signal).toBe("SIGTERM");
		expect(h.kills[0].signal).toBe("SIGTERM");
	});

	test("wait reports a timeout without killing the job", async () => {
		const { h, call } = setup();
		await call({ action: "start", command: "sleep 1" });
		const result = await call({ action: "wait", id: "j1", timeoutMs: 0 });
		expect(result.details.timedOut).toBe(true);
		expect(h.runtime.get("j1")?.status).toBe("running");
	});

	test("wait reports progress while it blocks", async () => {
		const { tool, ctx } = setup();
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
		const { h, call } = setup();
		await call({ action: "start", command: "sleep 1" });
		h.children[0].close(0);
		const result = await call({ action: "clear" });
		expect(result.details.cleared).toBe(1);
	});

	test("rejects an unknown action with an error result", async () => {
		const { call } = setup();
		const result = await call({ action: "explode" });
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("action must be one of");
	});

	test("forwards wake, detached, and timeoutMs on start", async () => {
		const { call } = setup();
		const result = await call({ action: "start", command: "sleep 1", wake: true, detached: true, timeoutMs: 5000 });
		expect(result.details.job.wake).toBe(true);
		expect(result.details.job.detached).toBe(true);
		expect(result.details.job.id).toBe("j1");
	});

	test("sends input to a job started with stdin", async () => {
		const { h, call } = setup();
		await call({ action: "start", command: "cat", stdin: true });
		const result = await call({ action: "send", id: "j1", input: "hello" });
		expect(result.content[0].text).toContain("Sent 5 characters to j1");
		expect(result.details.action).toBe("send");
		expect(result.details.sent).toBe(5);
		expect(result.details.stdinClosed).toBe(false);
		expect(h.children[0].stdinSink?.text).toBe("hello\n");
	});

	test("send reports EOF and refuses a write after it", async () => {
		const { call } = setup();
		await call({ action: "start", command: "cat", stdin: true });
		const closed = await call({ action: "send", id: "j1", eof: true });
		expect(closed.content[0].text).toBe("Closed j1's stdin.");
		expect(closed.details.stdinClosed).toBe(true);
		const refused = await call({ action: "send", id: "j1", input: "more" });
		expect(refused.isError).toBe(true);
		expect(refused.content[0].text).toContain("closed its stdin");
	});

	test("send without stdin is an error result", async () => {
		const { call } = setup();
		await call({ action: "start", command: "sleep 1" });
		const result = await call({ action: "send", id: "j1", input: "x" });
		expect(result.isError).toBe(true);
		expect(result.details.error).toContain("was not started with stdin");
	});
});

const record = (overrides: Partial<JobRecord> = {}): JobRecord => ({
	id: "j1",
	label: "tests",
	command: "bun test",
	cwd: "/work",
	pid: 123,
	status: "running",
	exitCode: null,
	signal: null,
	startedAt: 0,
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
});

describe("job transcript rendering", () => {
	test("call line reuses the slot Text", () => {
		const { tool } = setup();
		const first = tool.renderCall({ action: "start", command: "bun test" }, theme, {
			argsComplete: true,
			lastComponent: undefined,
		});
		const second = tool.renderCall({ action: "start", command: "bun test --watch" }, theme, {
			argsComplete: true,
			lastComponent: first,
		});
		expect(second).toBe(first);
		expect(first.render(80).join("\n")).toContain("job start → bun test --watch");
	});

	test("sanitizes a model-supplied id in the error line", () => {
		const { tool } = setup();
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

	test("sanitizes an unknown action in the call line", () => {
		const { tool } = setup();
		const text = tool
			.renderCall({ action: "bogus\u001b[31m" }, theme, { argsComplete: true, lastComponent: undefined })
			.render(80)
			.join("\n");
		expect(text).not.toContain("\u001b");
	});

	test("list renders a themed rail with a cap note and reuses the view", () => {
		const { tool } = setup();
		const jobs = Array.from({ length: 10 }, (_, i) => record({ id: `j${i + 1}`, label: `job ${i + 1}` }));
		const result = { content: [{ type: "text", text: "model" }], details: { action: "list", jobs } };
		const lines = tool
			.renderResult(result, { expanded: false, isPartial: false }, theme, { lastComponent: undefined })
			.render(80);
		expect(lines[0]).toBe("");
		expect(lines.some((line: string) => line.includes("▸ j1"))).toBe(true);
		expect(lines.at(-1)).toContain("… 2 more");

		const view = tool.renderResult(result, { expanded: false, isPartial: false }, theme, { lastComponent: undefined });
		const again = tool.renderResult(result, { expanded: false, isPartial: false }, theme, { lastComponent: view });
		expect(again).toBe(view);
	});

	test("an expanded list shows every job with no cap hint", () => {
		const { tool } = setup();
		const jobs = Array.from({ length: 10 }, (_, i) => record({ id: `j${i + 1}`, label: `job ${i + 1}` }));
		const result = { content: [{ type: "text", text: "model" }], details: { action: "list", jobs } };
		const text = tool
			.renderResult(result, { expanded: true, isPartial: false }, theme, { lastComponent: undefined })
			.render(80)
			.join("\n");
		expect(text).toContain("j10");
		expect(text).not.toContain("more");
	});

	test("logs render a blank line, the earlier note, and themed lines", () => {
		const { tool } = setup();
		const logs = Array.from({ length: 12 }, (_, i) => `line ${i}`).join("\n");
		const result = { content: [{ type: "text", text: "model" }], details: { action: "logs", logs, job: record() } };
		const lines = tool
			.renderResult(result, { expanded: false, isPartial: false }, theme, { lastComponent: undefined })
			.render(80);
		expect(lines[0]).toBe("");
		expect(lines[1]).toContain("… 4 earlier lines");
		expect(lines.at(-1)).toContain("line 11");

		const expanded = tool
			.renderResult(result, { expanded: true, isPartial: false }, theme, { lastComponent: undefined })
			.render(80);
		expect(expanded.some((line: string) => line.includes("earlier"))).toBe(false);
		expect(expanded).toHaveLength(1 + 12);
	});

	test("empty list and clear render a muted status", () => {
		const { tool } = setup();
		const empty = { content: [{ type: "text", text: "No jobs." }], details: { action: "list", jobs: [] } };
		const emptyText = tool
			.renderResult(empty, { expanded: false, isPartial: false }, theme, { lastComponent: undefined })
			.render(80)
			.join("\n");
		expect(emptyText).toContain("No jobs.");

		const cleared = { content: [{ type: "text", text: "Cleared 2 jobs." }], details: { action: "clear", cleared: 2 } };
		const clearedText = tool
			.renderResult(cleared, { expanded: false, isPartial: false }, theme, { lastComponent: undefined })
			.render(80)
			.join("\n");
		expect(clearedText).toContain("Cleared 2 jobs.");
	});

	test("empty logs render a muted note", () => {
		const { tool } = setup();
		const result = { content: [{ type: "text", text: "model" }], details: { action: "logs", logs: "", job: record() } };
		const text = tool
			.renderResult(result, { expanded: false, isPartial: false }, theme, { lastComponent: undefined })
			.render(80)
			.join("\n");
		expect(text).toContain("No output yet.");
	});

	test("kill confirms the signal instead of the stale running row", () => {
		const { tool } = setup();
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

	test("start surfaces detached and wake badges", () => {
		const { tool } = setup();
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

	test("status renders a compact outcome line", () => {
		const { tool } = setup();
		const job = record({ id: "j1", label: "tests", status: "exited", exitCode: 0, pid: null, finishedAt: 100 });
		const result = { content: [{ type: "text", text: "model" }], details: { action: "status", job } };
		const text = tool
			.renderResult(result, { expanded: false, isPartial: false }, theme, { lastComponent: undefined })
			.render(80)
			.join("\n");
		expect(text).toContain("✓ j1 tests");
		expect(text).toContain("exit 0");
	});

	test("wait notes a timeout", () => {
		const { tool } = setup();
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

	test("partial renders the waiting state", () => {
		const { tool } = setup();
		const result = { content: [{ type: "text", text: "Waiting on j1…" }], details: { action: "wait", job: record() } };
		const text = tool
			.renderResult(result, { expanded: false, isPartial: true }, theme, { lastComponent: undefined })
			.render(80)
			.join("\n");
		expect(text).toContain("Waiting on j1…");
	});

	test("error renders a sanitized error line", () => {
		const { tool } = setup();
		const result = {
			content: [{ type: "text", text: "Error: no job" }],
			details: { action: "status", error: 'no job "j9".' },
		};
		const text = tool
			.renderResult(result, { expanded: false, isPartial: false }, theme, { lastComponent: undefined })
			.render(80)
			.join("\n");
		expect(text).toContain('Error: no job "j9".');
	});
});
