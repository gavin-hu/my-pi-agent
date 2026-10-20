import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
	compareJobs,
	elapsedMs,
	formatCallText,
	formatCompletion,
	formatJobDetail,
	formatJobList,
	formatJobOutcomeLine,
	formatJobStatus,
	formatLogs,
	jobCounts,
	jobOutcome,
	pendingFailures,
	shortLabel,
	statusGlyph,
	tailLines,
} from "./format.ts";
import type { JobRecord } from "./types.ts";
import { fakeTheme } from "../../test/helpers/fakes.ts";

const job = (overrides: Partial<JobRecord> = {}): JobRecord => ({
	id: "j1",
	label: "build",
	command: "npm run build",
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
});

describe("tailLines", () => {
	test("keeps only the last N lines", () => {
		expect(tailLines(["a", "b", "c"], 2)).toEqual(["b", "c"]);
		expect(tailLines(["a"], 0)).toEqual([]);
	});
});

describe("status glyphs", () => {
	test("are one terminal column wide", () => {
		for (const status of ["running", "exited", "killed", "failed", "unknown"] as const) {
			expect(visibleWidth(statusGlyph(status, fakeTheme as any))).toBe(1);
		}
	});
});

describe("job summaries", () => {
	test("elapsed stops at finishedAt", () => {
		expect(elapsedMs(job({ startedAt: 100, finishedAt: 300 }), 9999)).toBe(200);
	});

	test("lists jobs with ids and status", () => {
		const text = formatJobList([job(), job({ id: "j2", status: "exited", exitCode: 0 })], 5000);
		expect(text).toContain("j1");
		expect(text).toContain("j2");
		expect(text).toMatch(/Jobs \(2\)/);
	});

	test("reports no jobs", () => {
		expect(formatJobList([])).toBe("No jobs.");
	});

	test("marks a job another session owns", () => {
		const jobs = [job({ id: "j1", sessionId: "me" }), job({ id: "j9", sessionId: "peer" })];
		const text = formatJobList(jobs, 5000, "me");
		const rows = text.split("\n").slice(1);
		expect(rows[0]).not.toContain("another session");
		expect(rows[1]).toContain("(another session)");
	});

	test("names the session in a single-job status", () => {
		expect(formatJobStatus(job({ sessionId: "peer" }), 5000, "me")).toContain("session: another session");
		expect(formatJobStatus(job({ sessionId: "me" }), 5000, "me")).not.toContain("another session");
	});

	test("names the owner in the detail pane", () => {
		expect(formatJobDetail(job({ sessionId: "peer" }), 5000, "me").join("\n")).toContain("owner: another session");
		expect(formatJobDetail(job({ sessionId: "me" }), 5000, "me").join("\n")).not.toContain("owner:");
	});

	test("completion text names the status and label", () => {
		const text = formatCompletion(job({ status: "failed", exitCode: 2, lastLine: "boom" }), 5000);
		expect(text).toContain("failed (exit 2)");
		expect(text).toContain("build");
		expect(text).toContain("boom");
	});
});

describe("formatLogs", () => {
	test("returns a no-output note with the log path", () => {
		expect(formatLogs(job(), [], 1000).text).toContain("no output yet");
	});

	test("truncates long output and points at the full log", () => {
		const result = formatLogs(job(), ["y".repeat(50), "z".repeat(50)], 20);
		expect(result.truncated).toBe(true);
		expect(result.text).toContain("/tmp/j1.log");
	});
});

describe("shortLabel", () => {
	test("clips wide characters by display column, not code unit", () => {
		const label = "界".repeat(40); // 80 columns
		expect(visibleWidth(shortLabel(job({ label })))).toBeLessThanOrEqual(48);
	});
});

describe("compareJobs", () => {
	test("sorts running before finished, then newest first", () => {
		const running = job({ id: "a", status: "running" });
		const old = job({ id: "b", status: "exited", startedAt: 1 });
		const recent = job({ id: "c", status: "exited", startedAt: 99 });
		expect([old, running, recent].sort(compareJobs).map((j) => j.id)).toEqual(["a", "c", "b"]);
	});
});

describe("jobCounts / pendingFailures", () => {
	test("counts totals, running, finished, and failed in one pass", () => {
		const jobs = [
			job({ id: "a", status: "running" }),
			job({ id: "b", status: "exited", exitCode: 0 }),
			job({ id: "c", status: "failed", exitCode: 1 }),
			job({ id: "d", status: "killed", signal: "SIGTERM" }),
		];
		expect(jobCounts(jobs)).toEqual({ total: 4, running: 1, failed: 1 });
	});

	test("pendingFailures lists only unseen failures", () => {
		const jobs = [
			job({ id: "a", status: "failed", seen: false }),
			job({ id: "b", status: "failed", seen: true }),
			job({ id: "c", status: "exited", seen: false }),
		];
		expect(pendingFailures(jobs).map((j) => j.id)).toEqual(["a"]);
	});
});

describe("jobOutcome / formatJobDetail", () => {
	test("names pid, exit code, and signal", () => {
		expect(jobOutcome(job({ status: "running", pid: 42 }))).toBe("pid 42");
		expect(jobOutcome(job({ status: "exited", exitCode: 0 }))).toBe("exit 0");
		expect(jobOutcome(job({ status: "failed", exitCode: 2 }))).toBe("exit 2");
		expect(jobOutcome(job({ status: "killed", signal: "SIGKILL" }))).toBe("SIGKILL");
		expect(jobOutcome(job({ status: "unknown" }))).toBe("—");
	});

	test("formatJobOutcomeLine summarizes each status", () => {
		expect(formatJobOutcomeLine(job({ status: "running", pid: 1234 }), fakeTheme, 4200)).toBe(
			"▸ j1 build · pid 1234 · 3.2s",
		);
		expect(
			formatJobOutcomeLine(job({ status: "exited", exitCode: 0, pid: null, finishedAt: 3000 }), fakeTheme, 3000),
		).toBe("✓ j1 build · exit 0 · 2.0s");
		expect(
			formatJobOutcomeLine(job({ status: "failed", exitCode: 1, pid: null, finishedAt: 3000 }), fakeTheme, 3000),
		).toBe("✗ j1 build · exit 1 · 2.0s");
		expect(
			formatJobOutcomeLine(job({ status: "killed", signal: "SIGTERM", pid: null, finishedAt: 3000 }), fakeTheme, 3000),
		).toBe("⊝ j1 build · SIGTERM · 2.0s");
	});

	test("builds command, cwd+outcome+elapsed, and last lines", () => {
		const detail = formatJobDetail(job({ startedAt: 1000, finishedAt: 3200, lastLine: "compiled" }), 9000);
		expect(detail[0]).toBe("command: npm run build");
		expect(detail[1]).toBe("cwd: /repo · pid 1234 · 2.2s");
		expect(detail[2]).toBe("last: compiled");
	});

	test("omits the last line when empty", () => {
		expect(formatJobDetail(job({ lastLine: "" }), 5000)).toHaveLength(2);
	});

	test("strips ANSI from a malicious last line", () => {
		const detail = formatJobDetail(job({ lastLine: "\u001b[31mowned\u001b[0m" }), 5000);
		expect(detail[2]).toBe("last: owned");
		expect(detail[2]).not.toContain("\u001b");
	});
});

describe("formatCallText", () => {
	test("previews a start command", () => {
		expect(formatCallText("start", { command: "bun test" })).toBe("start → bun test");
	});

	test("names the target for status/logs/kill/wait", () => {
		expect(formatCallText("kill", { id: "j3" })).toBe("kill j3");
		expect(formatCallText("wait", { id: "j3" })).toBe("wait j3");
	});

	test("previews the input a send writes, and its EOF", () => {
		expect(formatCallText("send", { id: "j3", input: "hello" })).toBe("send j3 → hello");
		expect(formatCallText("send", { id: "j3", input: "hello", eof: true })).toBe("send j3 → hello + EOF");
		expect(formatCallText("send", { id: "j3", eof: true })).toBe("send j3 → EOF");
	});

	test("collapses a multi-line send input to one sanitized line", () => {
		expect(formatCallText("send", { id: "j3", input: "one\ntwo\u001b[31m" })).toBe("send j3 → one two");
	});

	test("clips a wide-character command by display column", () => {
		const text = formatCallText("start", { command: "界".repeat(40) });
		expect(text.startsWith("start → ")).toBe(true);
		expect(visibleWidth(text.slice("start → ".length))).toBeLessThanOrEqual(48);
	});
});
