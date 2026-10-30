/**
 * The `JobResult` transcript block: the `job` tool's list-or-log-tail result.
 *
 * It maps the job vocabulary onto the shared `TailResult` kit, so the tool's
 * `renderResult` stays a few lines and every row is drawn by `jobRow` in
 * `format.ts`. The `/jobs` screen draws the same rows through the same helper,
 * which is why it lives beside the pure format helpers rather than here: this
 * module is on the registration path, and the screen is not.
 */

import type { TailResultInput } from "../../lib/tui/tool.ts";
import { jobRow } from "./format.ts";
import type { JobRecord } from "./types.ts";

/** Input for the transcript result: a themed job list or a log tail. */
export type JobResultInput =
	| { kind: "list"; jobs: JobRecord[]; more: number; sessionId?: string }
	| { kind: "logs"; lines: string[]; earlier: number };

/** Map the job vocabulary onto the shared transcript tail block. */
export function jobTail(input: JobResultInput): TailResultInput<JobRecord> {
	if (input.kind === "logs") {
		return { kind: "lines", lines: input.lines, earlier: input.earlier, earlierLabel: "lines" };
	}
	return {
		kind: "list",
		rows: input.jobs,
		more: input.more,
		rowLine: (job, width, theme) => {
			const foreign = input.sessionId !== undefined && job.sessionId !== input.sessionId;
			return jobRow(job, theme, width, { marker: false, foreign });
		},
	};
}
