import { afterEach, describe, expect, test } from "bun:test";
import jobs from "./index.ts";
import { TOOL_NAME } from "./tools.ts";
import { createFakePi } from "../../test/helpers/fakes.ts";
import { makeCtx, makeHarnessSuite, readLog } from "../../test/helpers/fixtures/job.ts";
import { waitFor } from "../../test/helpers/process.ts";

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
	});

	test("kill signals the process", async () => {
		const { h, call } = setup();
		await call({ action: "start", command: "sleep 1" });
		const result = await call({ action: "kill", id: "j1", signal: "SIGTERM" });
		expect(result.details.signalled).toBe(true);
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
});
