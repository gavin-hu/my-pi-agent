import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LineSplitter } from "../../lib/lines.ts";
import { type Harness, job, makeCtx, makeHarnessSuite, readLog, startJob } from "../../test/helpers/fixtures/job.ts";
import { settle, waitFor } from "../../test/helpers/process.ts";
import { createLogWriter } from "./log-writer.ts";

const suite = makeHarnessSuite();
/** Temp directories this file's unit cases made, removed at teardown. */
const scratch: string[] = [];
afterEach(() => {
	suite.cleanup();
	for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * How long a rotation case waits for a write to reach the log.
 *
 * The write reaches the file through the child's pipe, asynchronously; 200 ms was
 * tight enough to fail once in a full `--parallel` run on a loaded machine, while
 * the budget only bounds a genuine failure. It matches `waitFor`'s own default.
 */
const ROTATE_BUDGET_MS = 2000;

describe("job runtime — log rotation", () => {
	/** Start a job with a cap small enough that a couple of lines rotate it. */
	async function startCapped(h: Harness): Promise<string> {
		const { ctx } = makeCtx();
		await h.runtime.load(ctx);
		await h.runtime.start({ command: "chatty" }, ctx);
		const logPath = h.runtime.get("j1")?.logPath;
		if (!logPath) throw new Error("expected a log path");
		return logPath;
	}

	test("moves the live segment aside once it reaches the cap", async () => {
		const h = suite.makeHarness({ config: { maxLogBytes: 8 } });
		const logPath = await startCapped(h);
		const rotated = join(h.dir, "j1.log.1");

		// Each write waits for the file, so the stream's byte count matches the file
		// and the third line deterministically crosses the 8-byte cap.
		h.children[0].write("aaaa\n");
		await waitFor(() => readLog(logPath) === "aaaa\n", ROTATE_BUDGET_MS);
		h.children[0].write("bbbb\n");
		await waitFor(() => readLog(logPath) === "aaaa\nbbbb\n", ROTATE_BUDGET_MS);
		h.children[0].write("cccc\n");
		// The rename lands before the reopened stream flushes its queued chunk, so
		// wait for both halves rather than asserting on an empty live segment.
		await waitFor(() => readLog(rotated) === "aaaa\nbbbb\n" && readLog(logPath) === "cccc\n", ROTATE_BUDGET_MS);
	});

	test("keeps one previous segment and replaces it on the next rotation", async () => {
		const h = suite.makeHarness({ config: { maxLogBytes: 8 } });
		const logPath = await startCapped(h);
		const rotated = join(h.dir, "j1.log.1");

		for (const line of ["aaaa", "bbbb", "cccc", "dddd", "eeee"]) {
			h.children[0].write(`${line}\n`);
			await waitFor(() => readLog(logPath).includes(line) || readLog(rotated).includes(line), ROTATE_BUDGET_MS);
		}

		// Two rotations by the fifth line: the first pair moves to `.1`, the second
		// pair replaces it, and the newest line starts the live segment again.
		await waitFor(() => readLog(rotated) === "cccc\ndddd\n" && readLog(logPath) === "eeee\n", ROTATE_BUDGET_MS);
		expect(existsSync(rotated)).toBe(true);
		expect(existsSync(`${rotated}.1`)).toBe(false);
		// The oldest line was rotated out of the only previous segment.
		expect(readLog(rotated)).not.toContain("aaaa");
		expect(readLog(logPath)).toContain("eeee");
	});

	test("drains a rotation backlog through the cap instead of one oversized segment", async () => {
		const h = suite.makeHarness({ config: { maxLogBytes: 8 } });
		const logPath = await startCapped(h);
		const rotated = join(h.dir, "j1.log.1");

		h.children[0].write("aaaa\n");
		await waitFor(() => readLog(logPath) === "aaaa\n", ROTATE_BUDGET_MS);

		// The first chunk starts a rotation; the next two arrive while it is in
		// flight. They are replayed through the cap check, so the new segment is
		// bounded and the order across the two segments is unchanged.
		h.children[0].write("bbbb\n");
		h.children[0].write("cccc\n");
		h.children[0].write("dddd\n");
		await waitFor(() => existsSync(rotated) && readLog(logPath).includes("dddd"), ROTATE_BUDGET_MS);
		await settle(20);

		expect(readLog(rotated) + readLog(logPath)).toBe("aaaa\nbbbb\ncccc\ndddd\n");
		expect(readLog(logPath).length).toBeLessThanOrEqual(8 + "dddd\n".length);
	});

	test("logs reads across the rotated segment", async () => {
		const h = suite.makeHarness({ config: { maxLogBytes: 8, maxLogLines: 10 } });
		const logPath = await startCapped(h);

		h.children[0].write("aaaa\n");
		await waitFor(() => readLog(logPath) === "aaaa\n", ROTATE_BUDGET_MS);
		h.children[0].write("bbbb\n");
		await waitFor(() => readLog(logPath) === "aaaa\nbbbb\n", ROTATE_BUDGET_MS);
		h.children[0].write("cccc\n");
		await waitFor(() => readLog(logPath) === "cccc\n" && existsSync(join(h.dir, "j1.log.1")), ROTATE_BUDGET_MS);

		expect(h.runtime.logs("j1", 10)?.lines).toEqual(["aaaa", "bbbb", "cccc"]);
	});

	test("clear removes both segments", async () => {
		const h = suite.makeHarness({ config: { maxLogBytes: 8 } });
		const logPath = await startCapped(h);
		const rotated = join(h.dir, "j1.log.1");

		h.children[0].write("aaaa\n");
		await waitFor(() => readLog(logPath) === "aaaa\n", ROTATE_BUDGET_MS);
		h.children[0].write("bbbb\n");
		await waitFor(() => readLog(logPath) === "aaaa\nbbbb\n", ROTATE_BUDGET_MS);
		h.children[0].write("cccc\n");
		await waitFor(() => existsSync(rotated), ROTATE_BUDGET_MS);
		// The rotation reopened synchronously, so the live segment is back already and
		// nothing is left scheduled to create it.
		expect(existsSync(logPath)).toBe(true);

		h.children[0].close(0);
		h.runtime.clear("j1", false);
		expect(existsSync(logPath)).toBe(false);
		expect(existsSync(rotated)).toBe(false);
		// A deferred reopen would land on a later tick and undo the clear.
		await settle(20);
		expect(existsSync(logPath)).toBe(false);
		expect(existsSync(rotated)).toBe(false);
	});

	test("a detached job writes its own log and is not rotated", async () => {
		const h = suite.makeHarness({ config: { maxLogBytes: 8 } });
		if (process.platform === "win32") return;
		const { ctx } = makeCtx();
		await h.runtime.load(ctx);
		const entry = await h.runtime.start({ command: "serve", detached: true }, ctx);
		expect(h.children[0].options?.detachOutput).toBe(true);

		// The parent holds no stream for it, so no chunk is seen and nothing rotates.
		h.children[0].write("aaaaaaaaaaaaaaaaaaaa\n");
		h.children[0].write("bbbbbbbbbbbbbbbbbbbb\n");
		expect(existsSync(join(h.dir, "j1.log.1"))).toBe(false);
		expect(entry.detached).toBe(true);
	});

	test("a finished job never leaves a reopened stream behind", async () => {
		const h = suite.makeHarness({ config: { maxLogBytes: 8 } });
		const logPath = await startCapped(h);
		const rotated = join(h.dir, "j1.log.1");

		h.children[0].write("aaaa\n");
		await waitFor(() => readLog(logPath) === "aaaa\n", ROTATE_BUDGET_MS);
		h.children[0].write("bbbb\n");
		await waitFor(() => readLog(logPath) === "aaaa\nbbbb\n", ROTATE_BUDGET_MS);

		// The third line starts a rotation; the close arrives before the stream's own
		// `close`, so the pending callback must bail instead of renaming and reopening.
		h.children[0].write("cccc\n");
		h.children[0].close(0);
		await settle(20);

		expect(existsSync(rotated)).toBe(false);
		expect(readLog(logPath)).toBe("aaaa\nbbbb\n");
	});
});

describe("job runtime — log writer accounting", () => {
	/** A writer over a real file, with a cap small enough for one rotation. */
	function makeWriter(dir: string, logPath: () => string) {
		return createLogWriter({
			now: () => 0,
			newSplitter: () => new LineSplitter(),
			logPath,
			rotatedPath: () => join(dir, "j1.log.1"),
			maxBytes: () => 4,
			repaintMs: () => 1_000_000,
			onLine: () => {},
			onPaint: () => {},
		});
	}

	test("counts the bytes a failed reopen loses, and nothing for a detached job", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-jobs-writer-"));
		scratch.push(dir);
		const live = join(dir, "j1.log");
		// The segment's directory is gone by the time the cap is reached, so the
		// rotation's rename and its reopen both fail: no stream, and no later one.
		let logPath = live;
		const writer = makeWriter(dir, () => logPath);
		const handle = writer.create(live);
		const record = job();

		writer.write(handle, record, Buffer.from("aaaa\n"));
		logPath = join(dir, "gone", "j1.log");
		writer.write(handle, record, Buffer.from("bbbb\n"));
		// The chunk that started the rotation drains once the reopen has failed.
		await waitFor(() => handle.droppedBytes === 5);
		expect(handle.stream).toBeUndefined();

		writer.write(handle, record, Buffer.from("cccc\n"));
		expect(handle.droppedBytes).toBe(10);

		// A detached job has no stream by design, and loses nothing to report.
		const detached = writer.create(undefined);
		writer.write(detached, record, Buffer.from("dddd\n"));
		expect(detached.droppedBytes).toBe(0);
	});

	test("reports the bytes its log dropped after the handle is gone", async () => {
		const h = suite.makeHarness({ config: { maxLogBytes: 4 } });
		await startJob(h);
		h.children[0].write("aaaa\n");
		// The registry directory goes away, so the rotation's rename and its reopen both
		// fail: the job runs on, and every byte after that is lost.
		rmSync(h.dir, { recursive: true, force: true });
		h.children[0].write("bbbb\n");
		// Waited on the live handle, which is the only count until the job settles.
		await waitFor(() => h.runtime.logs("j1")?.text.includes("bytes dropped") === true);
		h.children[0].close(0);
		// Settling disposes the handle, so the record has to carry the count from here.
		expect(h.runtime.get("j1")?.droppedBytes).toBeGreaterThan(0);
		expect(h.runtime.logs("j1")?.text).toContain("bytes dropped");
	});

	test("reopens a rotation whose stream had already closed", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-jobs-writer-"));
		scratch.push(dir);
		const online = join(dir, "live");
		const logPath = () => join(online, "j1.log");
		// The segment's directory does not exist yet, so the stream's open fails and the
		// stream closes before any rotation starts: a rotation that armed a `close` it
		// has already had would queue every later chunk and never reopen.
		const writer = makeWriter(dir, logPath);
		const handle = writer.create(logPath());
		await waitFor(() => handle.stream?.closed === true);
		mkdirSync(online, { recursive: true });

		const record = job();
		writer.write(handle, record, Buffer.from("aaaa\n"));
		writer.write(handle, record, Buffer.from("bbbb\n"));
		expect(handle.rotating).toBe(false);
		expect(handle.droppedBytes).toBe(0);
		await waitFor(() => readLog(logPath()).includes("bbbb"));
	});

	test("clear unlinks a log whose stream is still closing", async () => {
		const h = suite.makeHarness();
		await startJob(h);
		const logPath = h.runtime.get("j1")?.logPath;
		if (!logPath) throw new Error("expected a log path");
		h.children[0].write("aaaa\n");
		// `all` clears a running job in one tick: its stream is ended and its file
		// unlinked together, which Windows refuses until the stream's close.
		expect(h.runtime.clear(undefined, true).cleared).toBe(1);
		// Waited on the invariant, not on a fixed tick: the retry runs from the stream's
		// close, so a loaded machine reaches the same state later and asserts the same thing.
		await waitFor(() => !existsSync(logPath));
	});
});
