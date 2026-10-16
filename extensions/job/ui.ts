/**
 * Presentation for the jobs extension: the footer status chips.
 *
 * Kept separate from the runtime so the runtime owns lifecycle (the job table,
 * registry, clock) and this owns "how jobs are shown". The chips themselves come
 * from the shared `lib/tui/status-controller.ts`, so only the vocabulary — the
 * keys, glyphs, and counts — is job-specific.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
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
	// The notification also needs the context, so it is mirrored here.
	let ctx: ExtensionContext | undefined;

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
		const target = ctx;
		if (!target) return;
		const exit = job.exitCode !== null ? ` (exit ${job.exitCode})` : "";
		try {
			target.ui.notify(`Job ${job.id} failed: ${shortLabel(job)}${exit}`, "error");
		} catch {
			// UI may be unavailable in non-interactive modes.
		}
	};

	return {
		attach: (next) => {
			ctx = next;
			controller.attach(next);
		},
		detach: () => {
			ctx = undefined;
			controller.detach();
		},
		paint: () => {
			controller.paint();
		},
		setStatus: (next) => {
			if (next) ctx = next;
			controller.setStatus(next);
		},
		notifyFailure,
	};
}
