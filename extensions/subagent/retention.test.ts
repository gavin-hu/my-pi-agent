/**
 * The transcript store on a session start.
 *
 * The sweep is deferred off the first frame — Pi awaits every `session_start` handler, and
 * pruning resolves the repository with git — so this suite proves both halves: the start
 * returns while the sweep is still waiting on its repository answer, and the sweep still
 * removes what the retention window expired.
 */

import { existsSync, mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { fakeCtx } from "../../test/helpers/context.ts";
import { withAgentDir } from "../../test/helpers/env.ts";
import { emit, makeFakePi } from "../../test/helpers/fakes.ts";
import { waitFor } from "../../test/helpers/process.ts";
import subagent from "./index.ts";

/** A fixed instant in the past: older than any retention window, and read from no clock. */
const OLD_SECONDS = 1_700_000_000;

describe("transcript retention", () => {
	test("sweeps the store beside the first frame instead of in front of it", async () => {
		await withAgentDir(async (dir) => {
			writeFileSync(
				join(dir, "bytefly.json"),
				JSON.stringify({ subagent: { transcripts: "failed", retentionDays: 1, maxRuns: 10 } }),
			);
			const run = join(dir, "subagents", "20260101-000000-abcdef");
			mkdirSync(run, { recursive: true });
			utimesSync(run, OLD_SECONDS, OLD_SECONDS);

			// A `git` that never answers is the worst case for an awaited sweep.
			let answer: ((value: { stdout: string; stderr: string; code: number }) => void) | undefined;
			const { pi } = makeFakePi({
				exec: () =>
					new Promise((resolve) => {
						answer = resolve;
					}),
			});
			subagent(pi, { run: () => new Promise(() => {}) });
			const { ctx } = fakeCtx({ cwd: dir, mode: "tui" });

			await emit(pi, "session_start", {}, ctx);
			// The start returned while the sweep is still waiting on its repository answer.
			expect(existsSync(run)).toBe(true);

			answer?.({ stdout: "", stderr: "", code: 0 });
			await waitFor(() => !existsSync(run));
		});
	});

	test("leaves the store alone while transcripts are off", async () => {
		await withAgentDir(async (dir) => {
			writeFileSync(join(dir, "bytefly.json"), JSON.stringify({ subagent: { transcripts: "off" } }));
			const run = join(dir, "subagents", "20260101-000000-abcdef");
			mkdirSync(run, { recursive: true });
			utimesSync(run, OLD_SECONDS, OLD_SECONDS);

			let asked = 0;
			const { pi } = makeFakePi({
				exec: async () => {
					asked += 1;
					return { stdout: "", stderr: "", code: 0 };
				},
			});
			subagent(pi, { run: () => new Promise(() => {}) });
			await emit(pi, "session_start", {}, fakeCtx({ cwd: dir, mode: "tui" }).ctx);
			expect(asked).toBe(0);
			expect(existsSync(run)).toBe(true);
		});
	});
});
