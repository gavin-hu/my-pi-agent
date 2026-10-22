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

/** The notice the captures show: the shape `job` and `watch` post to a transcript. */
export const TRANSCRIPT_NOTICE: NoticeDetails = {
	source: "job",
	title: "2 background jobs finished",
	items: [
		{ label: "j1 build", detail: "exit 0", severity: "ok" },
		{ label: "j2 test", detail: "exit 1", severity: "bad" },
	],
};
