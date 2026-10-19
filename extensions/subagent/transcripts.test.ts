import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, realpathSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
import { createTranscript, pruneTranscripts, runIdFor, transcriptsDirFor } from "./transcripts.ts";
import type { SingleResult } from "./types.ts";
import { tempDir, withAgentDir } from "../../test/helpers/env.ts";
import { createFakePi } from "../../test/helpers/fakes.ts";

const FIXED_START = Date.parse("2026-10-15T14:30:12Z");
const DAY_MS = 86_400_000;

function result(overrides: Partial<SingleResult> = {}): SingleResult {
	return {
		agent: "explorer",
		agentSource: "builtin",
		task: "inspect the loader",
		exitCode: 0,
		messages: [],
		stderr: "",
		usage: { input: 7, output: 3, cacheRead: 0, cacheWrite: 0, cost: 0.02, contextTokens: 10, turns: 1 },
		model: "claude-sonnet-4-5",
		startedAt: FIXED_START,
		finishedAt: FIXED_START + 4_000,
		...overrides,
	};
}

/** A Pi double whose only git answer is the repository root. */
function piIn(root: string | undefined) {
	return createFakePi({
		exec: async () => (root ? { stdout: `${root}\n`, stderr: "", code: 0 } : { stdout: "", stderr: "no", code: 128 }),
	}).pi;
}

/** Create a run directory with a fixed age, as `worktree/prune.test.ts` does. */
function makeRun(dir: string, name: string, ageMs: number): string {
	const path = join(dir, name);
	mkdirSync(path, { recursive: true });
	const seconds = (FIXED_START - ageMs) / 1000;
	utimesSync(path, seconds, seconds);
	return path;
}

describe("runIdFor", () => {
	test("renders the start time in UTC with a hex suffix", () => {
		expect(runIdFor(FIXED_START, "a1b2c3")).toBe("20261015-143012-a1b2c3");
	});

	test("sorts chronologically as a plain string", () => {
		const first = runIdFor(FIXED_START, "ffffff");
		const second = runIdFor(FIXED_START + 1_000, "000000");
		expect(first < second).toBe(true);
	});
});

describe("transcriptsDirFor", () => {
	test("resolves the repository's .pi/subagents", async () => {
		const repo = realpathSync.native(tempDir("subagent-repo-"));
		expect(await transcriptsDirFor(piIn(repo), repo)).toBe(join(repo, CONFIG_DIR_NAME, "subagents"));
	});

	test("falls back to the agent directory outside a repository", async () => {
		await withAgentDir(async (agentDir) => {
			expect(await transcriptsDirFor(piIn(undefined), tempDir("subagent-cwd-"))).toBe(join(agentDir, "subagents"));
			expect(getAgentDir()).toBe(agentDir);
		}, "subagent-global-");
	});
});

describe("createTranscript", () => {
	test("writes the stream, stderr, and metadata for one run", () => {
		const dir = tempDir("subagent-store-");
		const transcript = createTranscript();
		transcript.line('{"type":"message_end"}');
		transcript.line('{"type":"tool_execution_end","isError":true}');
		transcript.stderr("a warning");

		const written = transcript.write(dir, result({ toolErrors: 1 }), { cwd: "/repo", readOnly: true });

		expect(written.error).toBeUndefined();
		expect(written.path?.startsWith(join(dir, "20261015-143012-"))).toBe(true);
		const events = readFileSync(join(written.path!, "events.jsonl"), "utf-8");
		expect(events).toContain("message_end");
		expect(events).toContain("tool_execution_end");
		expect(readFileSync(join(written.path!, "stderr.log"), "utf-8")).toBe("a warning");
		const meta = JSON.parse(readFileSync(join(written.path!, "meta.json"), "utf-8"));
		expect(meta).toMatchObject({
			agent: "explorer",
			agentSource: "builtin",
			cwd: "/repo",
			readOnly: true,
			timedOut: false,
			toolErrors: 1,
			model: "claude-sonnet-4-5",
		});
		expect(meta.runId.startsWith("20261015-143012-")).toBe(true);
	});

	test("stops at the size cap and marks the truncation", () => {
		const dir = tempDir("subagent-store-");
		const transcript = createTranscript({ maxBytes: 40 });
		transcript.line("a".repeat(30));
		transcript.line("b".repeat(30));

		const written = transcript.write(dir, result(), { cwd: "/repo", readOnly: false });

		expect(written.truncated).toBe(true);
		const events = readFileSync(join(written.path!, "events.jsonl"), "utf-8");
		expect(events).toContain('"transcript-truncated"');
		expect(events).not.toContain("bbbb");
		expect(JSON.parse(readFileSync(join(written.path!, "meta.json"), "utf-8")).transcript.truncated).toBe(true);
	});

	test("reports an unwritable store instead of throwing", () => {
		const blocker = join(tempDir("subagent-store-"), "file");
		writeFileSync(blocker, "");

		const written = createTranscript().write(blocker, result(), { cwd: "/repo", readOnly: false });

		expect(written.path).toBeUndefined();
		expect(written.error).toBeTruthy();
	});
});

describe("pruneTranscripts", () => {
	test("removes runs past the retention window and keeps the rest", () => {
		const dir = tempDir("subagent-store-");
		const aged = makeRun(dir, "20260101-000000-aaaaaa", 30 * DAY_MS);
		const fresh = makeRun(dir, "20260110-000000-bbbbbb", DAY_MS);

		const outcome = pruneTranscripts(dir, { retentionDays: 14, maxRuns: 100, now: FIXED_START });

		expect(outcome.removed).toEqual(["20260101-000000-aaaaaa"]);
		expect(existsSync(aged)).toBe(false);
		expect(existsSync(fresh)).toBe(true);
	});

	test("keeps only the newest runs beyond the count cap", () => {
		const dir = tempDir("subagent-store-");
		makeRun(dir, "20260101-000000-aaaaaa", 3 * DAY_MS);
		makeRun(dir, "20260102-000000-bbbbbb", 2 * DAY_MS);
		const newest = makeRun(dir, "20260103-000000-cccccc", DAY_MS);

		const outcome = pruneTranscripts(dir, { retentionDays: 3650, maxRuns: 1, now: FIXED_START });

		expect(outcome.removed).toEqual(["20260101-000000-aaaaaa", "20260102-000000-bbbbbb"]);
		expect(outcome.kept).toBe(1);
		expect(existsSync(newest)).toBe(true);
	});

	test("never touches a directory that is not a run id", () => {
		const dir = tempDir("subagent-store-");
		const notes = makeRun(dir, "notes", 30 * DAY_MS);

		const outcome = pruneTranscripts(dir, { retentionDays: 1, maxRuns: 1, now: FIXED_START });

		expect(outcome.removed).toEqual([]);
		expect(existsSync(notes)).toBe(true);
	});

	test("returns quietly when the store does not exist yet", () => {
		const missing = join(tempDir("subagent-store-"), "absent");
		expect(pruneTranscripts(missing, { retentionDays: 14, maxRuns: 10, now: FIXED_START })).toEqual({
			removed: [],
			kept: 0,
		});
	});
});
