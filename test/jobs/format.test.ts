import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
	compareJobs,
	elapsedMs,
	formatCallText,
	formatCompletion,
	formatDuration,
	formatJobList,
	formatLogs,
	sanitizeLogLine,
	sanitizeLogText,
	statusGlyph,
	tailLines,
} from "../../extensions/jobs/format.ts";
import type { JobRecord } from "../../extensions/jobs/types.ts";
import { fakeTheme } from "../helpers/fakes.ts";

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
	sessionId: "s1",
	seen: false,
	lastLine: "",
	...overrides,
});

describe("sanitizeLogLine", () => {
	test("strips ANSI colour and OSC sequences", () => {
		expect(sanitizeLogLine("\u001b[31mred\u001b[0m")).toBe("red");
		expect(sanitizeLogLine("\u001b]0;title\u0007after")).toBe("after");
	});

	test("resolves carriage-return progress to the final segment", () => {
		expect(sanitizeLogLine("10%\r50%\r100% done")).toBe("100% done");
	});

	test("replaces control characters and collapses whitespace", () => {
		expect(sanitizeLogLine("a\u0007b\tc   d")).toBe("a b c d");
	});

	test("clips very long lines", () => {
		const line = sanitizeLogLine("x".repeat(500));
		expect(line.length).toBeLessThanOrEqual(200);
		expect(line.endsWith("…")).toBe(true);
	});
});

describe("sanitizeLogText / tailLines", () => {
	test("sanitizes each line independently", () => {
		expect(sanitizeLogText("ok\n\u001b[32mgreen\u001b[0m\n")).toEqual(["ok", "green", ""]);
	});

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

describe("formatDuration", () => {
	test("formats milliseconds, seconds, minutes, and hours", () => {
		expect(formatDuration(450)).toBe("450ms");
		expect(formatDuration(3200)).toBe("3.2s");
		expect(formatDuration(65_000)).toBe("1m05s");
		expect(formatDuration(7_380_000)).toBe("2h03m");
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

describe("compareJobs", () => {
	test("sorts running before finished, then newest first", () => {
		const running = job({ id: "a", status: "running" });
		const old = job({ id: "b", status: "exited", startedAt: 1 });
		const recent = job({ id: "c", status: "exited", startedAt: 99 });
		expect([old, running, recent].sort(compareJobs).map((j) => j.id)).toEqual(["a", "c", "b"]);
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
});
