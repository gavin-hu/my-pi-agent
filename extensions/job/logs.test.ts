import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { readLogTail } from "./logs.ts";
import { tempDir } from "../../test/helpers/env.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { waitFor } from "../../test/helpers/process.ts";
import { readLog, makeHarnessSuite, startJob } from "../../test/helpers/fixtures/job.ts";

const suite = makeHarnessSuite();
const temps = makeTempTracker();
afterEach(() => {
	suite.cleanup();
	temps.flush();
});

describe("job log tails", () => {
	test("a missing path yields an empty tail", async () => {
		const dir = temps.track(tempDir("pi-jobs-missing-"));
		expect(readLogTail(join(dir, "log"), 10)).toEqual({
			lines: [],
			truncated: false,
			more: false,
		});
	});

	test("tails the requested lines and sanitizes escapes", async () => {
		const dir = temps.track(tempDir("pi-jobs-logs-"));
		const path = join(dir, "j1.log");
		writeFileSync(path, "\u001b[31mred\u001b[0m\nsecond\nthird\n");
		const tail = readLogTail(path, 2);
		expect(tail.lines).toEqual(["second", "third"]);
		expect(tail.truncated).toBe(false);
		expect(tail.more).toBe(true);
	});

	test("flags that earlier lines exist beyond the returned window", async () => {
		const dir = temps.track(tempDir("pi-jobs-logs-"));
		const path = join(dir, "j1.log");
		writeFileSync(path, "a\nb\nc\nd\ne\n");
		const tail = readLogTail(path, 2);
		expect(tail.lines).toEqual(["d", "e"]);
		expect(tail.more).toBe(true);
	});
});

describe("job runtime — logs", () => {
	test("returns a sanitized tail", async () => {
		const h = suite.makeHarness();
		await startJob(h);
		h.children[0].write("a\nb\nc\n");
		await waitFor(() => h.runtime.get("j1")?.lastLine === "c");
		await waitFor(() => readLog(h.runtime.get("j1")!.logPath).includes("c"));
		const result = h.runtime.logs("j1", 2);
		expect(result?.text).toContain("b");
		expect(result?.text).toContain("c");
		expect(result?.text).not.toContain("\na\n");
		expect(result?.lines).toEqual(["b", "c"]);
		expect(result?.lines.join("\n")).not.toContain("output:");
	});

	test("keeps a multi-byte character that a read boundary splits", async () => {
		const h = suite.makeHarness();
		await startJob(h);
		const bytes = Buffer.from("héllo\n", "utf8");
		// é is two bytes; cut between them, as a pipe read can.
		const cut = bytes.indexOf(0xc3) + 1;
		h.children[0].writeBytes(bytes.subarray(0, cut));
		h.children[0].writeBytes(bytes.subarray(cut));
		await waitFor(() => h.runtime.get("j1")?.lastLine === "héllo");
		await waitFor(() => readLog(h.runtime.get("j1")!.logPath).includes("héllo"));
		expect(h.runtime.logs("j1")?.lines).toContain("héllo");
	});

	test("defaults to the configured maxLogLines", async () => {
		const h = suite.makeHarness({ config: { maxLogLines: 2 } });
		await startJob(h);
		h.children[0].write("a\nb\nc\nd\n");
		await waitFor(() => h.runtime.get("j1")?.lastLine === "d");
		await waitFor(() => readLog(h.runtime.get("j1")!.logPath).includes("d"));
		const result = h.runtime.logs("j1");
		expect(result?.text).toContain("c");
		expect(result?.text).toContain("d");
		expect(result?.text).not.toContain("\na\n");
	});

	test("flags that earlier lines exist beyond the returned window", async () => {
		const h = suite.makeHarness({ config: { maxLogLines: 2 } });
		await startJob(h);
		h.children[0].write("a\nb\nc\nd\ne\n");
		await waitFor(() => h.runtime.get("j1")?.lastLine === "e");
		await waitFor(() => readLog(h.runtime.get("j1")!.logPath).includes("e"));
		expect(h.runtime.logs("j1")?.more).toBe(true);
	});
});
