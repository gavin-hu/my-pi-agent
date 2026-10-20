/**
 * Presentation for the jobs extension: the footer status chips and the failure
 * alert.
 *
 * The chips and the context they paint through come from the shared
 * `lib/tui/status-controller.ts`, so only the vocabulary — the keys, glyphs,
 * counts, and message text — is job-specific.
 */

import { GLYPHS, STATUS_KEYS } from "../../lib/tui/glyphs.ts";
import { createStatusController, type StatusChip, type StatusController } from "../../lib/tui/status-controller.ts";
import type { JobsConfig } from "./config.ts";
import { pendingFailures, shortLabel } from "./format.ts";
import type { JobRecord } from "./types.ts";

export interface UiController extends StatusController {
	/** Notify the user that a job failed, when a UI is attached. */
	notifyFailure(job: JobRecord): void;
}

export interface UiOptions {
	getJobs(): Iterable<JobRecord>;
	getConfig(): JobsConfig;
}

export function createUiController(options: UiOptions): UiController {
	const { getJobs, getConfig } = options;

	const controller = createStatusController({
		keys: [STATUS_KEYS.jobs, STATUS_KEYS.jobsFailure],
		enabled: () => getConfig().showStatus,
		chips: (): StatusChip[] => {
			const jobs = [...getJobs()];
			const running = jobs.filter((job) => job.status === "running").length;
			return [
				{ key: STATUS_KEYS.jobs, glyph: GLYPHS.jobsRunning, count: running, role: "accent" },
				{ key: STATUS_KEYS.jobsFailure, glyph: GLYPHS.jobsFailure, count: pendingFailures(jobs).length, role: "bad" },
			];
		},
	});

	const notifyFailure = (job: JobRecord): void => {
		const exit = job.exitCode !== null ? ` (exit ${job.exitCode})` : "";
		controller.notify(`Job ${job.id} failed: ${shortLabel(job)}${exit}`, "error");
	};

	return { ...controller, notifyFailure };
}
