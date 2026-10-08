/**
 * Presentation for the jobs extension: the footer status chips.
 *
 * Kept separate from the runtime so the runtime owns lifecycle (the job table,
 * registry, clock) and this owns "how jobs are shown". It holds only the last
 * context it was attached to; the runtime re-attaches on load and start, and
 * every method no-ops if nothing is attached or the UI is unavailable in the
 * current mode.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { GLYPHS, STATUS_KEYS } from "../_shared/ui.ts";
import type { JobsConfig } from "./config.ts";
import { pendingFailures } from "./format.ts";
import type { JobRecord } from "./types.ts";

export interface UiController {
	/** Remember the live context; later calls use it when no context is passed. */
	attach(ctx: ExtensionContext): void;
	/** Forget the context, for example on shutdown or reload. */
	detach(): void;
	/** Repaint the chips using the attached context. */
	paint(): void;
	/** Publish the footer chips (and attach `ctx` when given). */
	setStatus(ctx?: ExtensionContext): void;
}

export interface UiOptions {
	getJobs(): Iterable<JobRecord>;
	getConfig(): JobsConfig;
}

export function createUiController(options: UiOptions): UiController {
	const { getJobs, getConfig } = options;
	let ctx: ExtensionContext | undefined;

	const theme = (target: ExtensionContext, color: "accent" | "error", text: string): string => {
		try {
			return target.ui.theme.fg(color, text);
		} catch {
			return text;
		}
	};

	const setStatus = (next?: ExtensionContext): void => {
		if (next) ctx = next;
		const target = ctx;
		if (!target) return;
		try {
			if (!getConfig().showStatus) {
				target.ui.setStatus(STATUS_KEYS.jobs, undefined);
				target.ui.setStatus(STATUS_KEYS.jobsFailure, undefined);
				return;
			}
			const jobs = [...getJobs()];
			const running = jobs.filter((job) => job.status === "running").length;
			const unseenFailures = pendingFailures(jobs).length;
			// A space before the count keeps the compact status-bar form (`▸2`),
			// while the two chips stay separate segments in the full form.
			target.ui.setStatus(
				STATUS_KEYS.jobs,
				running > 0 ? theme(target, "accent", `${GLYPHS.jobsRunning} ${running}`) : undefined,
			);
			target.ui.setStatus(
				STATUS_KEYS.jobsFailure,
				unseenFailures > 0 ? theme(target, "error", `${GLYPHS.jobsFailure} ${unseenFailures}`) : undefined,
			);
		} catch {
			// UI may be unavailable in non-interactive modes.
		}
	};

	return {
		attach: (next) => {
			ctx = next;
		},
		detach: () => {
			ctx = undefined;
		},
		paint: () => {
			setStatus();
		},
		setStatus,
	};
}
