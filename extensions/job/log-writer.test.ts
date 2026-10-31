import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { settle, waitFor } from "../../test/helpers/process.ts";
import { makeCtx, readLog, makeHarnessSuite, type Harness } from "../../test/helpers/fixtures/job.ts";

const suite = makeHarnessSuite();
afterEach(() => {
	suite.cleanup();
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

		h.children[0].close(0);
		h.runtime.clear("j1", false);
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
