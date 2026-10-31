import { afterEach, describe, expect, test } from "bun:test";
import { touchSessionMarker } from "./session.ts";
import { Job } from "./types.ts";
import { jobRecord, save, makeCtx, makeHarnessSuite, type Harness, startJob } from "../../test/helpers/fixtures/job.ts";

const suite = makeHarnessSuite();
afterEach(() => {
	suite.cleanup();
});

describe("job runtime — send", () => {
	/** Load the runtime and start a job that opted into a stdin pipe. */
	async function startWithStdin(h: Harness): Promise<Job> {
		const { ctx } = makeCtx();
		await h.runtime.load(ctx);
		return h.runtime.start({ command: "cat", stdin: true }, ctx);
	}

	test("opens a stdin pipe only when the job asks for one", async () => {
		const h = suite.makeHarness();
		await startJob(h);
		expect(h.children[0].options?.stdin).toBe(false);
		expect(h.runtime.get("j1")?.stdin).toBe(false);

		const piped = suite.makeHarness();
		const entry = await startWithStdin(piped);
		expect(piped.children[0].options?.stdin).toBe(true);
		expect(entry.stdin).toBe(true);
	});

	test("writes a line and adds the newline itself", async () => {
		const h = suite.makeHarness();
		await startWithStdin(h);
		const result = h.runtime.send("j1", { input: "hello" });
		expect(result.sent).toBe(5);
		expect(result.closed).toBe(false);
		expect(h.children[0].stdinSink?.text).toBe("hello\n");
	});

	test("writes verbatim when newline is false", async () => {
		const h = suite.makeHarness();
		await startWithStdin(h);
		h.runtime.send("j1", { input: "y", newline: false });
		expect(h.children[0].stdinSink?.text).toBe("y");
	});

	test("ends stdin on eof and refuses a later write", async () => {
		const h = suite.makeHarness();
		await startWithStdin(h);
		const result = h.runtime.send("j1", { input: "bye", eof: true });
		expect(result.closed).toBe(true);
		expect(h.children[0].stdinSink?.text).toBe("bye\n");
		expect(h.children[0].stdinSink?.ended).toBe(true);
		expect(() => h.runtime.send("j1", { input: "again" })).toThrow("closed its stdin");
	});

	test("closes stdin without writing when eof is all it is given", async () => {
		const h = suite.makeHarness();
		await startWithStdin(h);
		h.runtime.send("j1", { eof: true });
		expect(h.children[0].stdinSink?.text).toBe("");
		expect(h.children[0].stdinSink?.ended).toBe(true);
	});

	test("refuses a job started without stdin", async () => {
		const h = suite.makeHarness();
		await startJob(h);
		expect(() => h.runtime.send("j1", { input: "x" })).toThrow("was not started with stdin");
	});

	test("refuses an unknown or finished job", async () => {
		const h = suite.makeHarness();
		await startWithStdin(h);
		expect(() => h.runtime.send("j9", { input: "x" })).toThrow('no job "j9"');
		h.children[0].close(0);
		expect(() => h.runtime.send("j1", { input: "x" })).toThrow("is exited; stdin is closed");
	});

	test("refuses a running job whose pipe belongs to another session", async () => {
		const h = suite.makeHarness();
		touchSessionMarker(h.dir, "peer", 999, 1_000_000);
		save(h, "peer", [jobRecord({ id: "j9", label: "peer", sessionId: "peer", detached: true, stdin: true })], 10);
		await h.runtime.load(makeCtx({ sessionId: "me" }).ctx);
		expect(() => h.runtime.send("j9", { input: "x" })).toThrow("belongs to the session that started it");
	});

	test("reports a closed pipe when the child closed its end", async () => {
		const h = suite.makeHarness();
		await startWithStdin(h);
		const sink = h.children[0].stdinSink;
		if (!sink) throw new Error("expected a stdin pipe");
		sink.failWith = new Error("EPIPE");
		expect(() => h.runtime.send("j1", { input: "x" })).toThrow("closed its stdin");
		// The pipe is dropped, so the next call says the same thing without writing.
		expect(() => h.runtime.send("j1", { input: "x" })).toThrow("closed its stdin");
	});

	test("ends stdin when the job's process closes", async () => {
		const h = suite.makeHarness();
		await startWithStdin(h);
		h.children[0].close(0);
		expect(h.children[0].stdinSink?.ended).toBe(true);
	});

	// Detached stdin is POSIX-only: Windows refuses the detach before the pipe is
	// considered, so these pin the host instead of the one the suite runs on.
	test("rejects stdin on a detached job", async () => {
		const h = suite.makeHarness({ isWindows: () => false });
		const { ctx } = makeCtx();
		await h.runtime.load(ctx);
		await expect(h.runtime.start({ command: "cat", stdin: true, detached: true }, ctx)).rejects.toThrow(
			"cannot take stdin",
		);
	});

	test("rejects stdin when detached is the configured default", async () => {
		const h = suite.makeHarness({ isWindows: () => false, config: { detachedByDefault: true } });
		const { ctx } = makeCtx();
		await h.runtime.load(ctx);
		await expect(h.runtime.start({ command: "cat", stdin: true }, ctx)).rejects.toThrow("cannot take stdin");
	});
});
