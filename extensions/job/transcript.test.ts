/**
 * The job tool's transcript: what a model's result looks like in the TUI, in every state.
 *
 * Split out of `tools.test.ts` by capability — that suite calls the tool and reads what it returns,
 * this one renders a result and reads the lines — because the tool's suite was at its pinned height
 * and the cap case below could not have a line. The split deletes the `LONG_SUITES` entry rather than
 * raising it, which is the direction that rule allows.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { fakeTheme as theme } from "../../test/helpers/fakes.ts";
import { makeJobToolSuite, recordOf } from "../../test/helpers/fixtures/job.ts";

const tools = makeJobToolSuite();
afterEach(() => tools.cleanup());

const setup = tools.setup;
const record = recordOf;

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
		expect(text).toContain("wait cancelled; the job is still running");
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
