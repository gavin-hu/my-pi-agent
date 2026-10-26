/**
 * The transcript fixture both doc captures draw (dev tooling).
 *
 * The chrome preview and the tool gallery are two pictures of the same session,
 * so the notice a finished job posts is written once here: a copy in each script
 * is how a gallery refresh would come to show a different notice than the hero.
 *
 * The two frames around it stay separate, because they are different jobs: the
 * gallery draws one surface at a time at the model's pad, and the chrome preview
 * draws a whole padded transcript under the header.
 */

import type { NoticeDetails } from "../lib/notice.ts";
import { JOB_RECORDS } from "./tools/fixtures/jobs.ts";

/**
 * The notice the captures show: the shape `job` and `watch` post to a transcript.
 *
 * The rows are read off the jobs the gallery's `job` block lists, so the event and the
 * table name the same two runs. Written by hand they said `j1 build · exit 0` about the
 * run the table calls `j1 bun test`, which is the kind of drift a picture cannot show.
 */
export const TRANSCRIPT_NOTICE: NoticeDetails = {
	source: "job",
	title: `${JOB_RECORDS.length} background jobs finished`,
	items: JOB_RECORDS.map((job) => ({
		label: `${job.id} ${job.label}`,
		detail: `exit ${job.exitCode ?? 0}`,
		severity: job.status === "exited" ? "ok" : "bad",
	})),
};
