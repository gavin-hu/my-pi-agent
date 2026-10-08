/**
 * Presentation for the jobs extension: the footer chip and the above-editor
 * widget.
 *
 * Kept separate from the runtime so the runtime owns lifecycle (the job table,
 * registry, clock) and this owns "how jobs are shown". It holds only the last
 * context it was attached to and the live widget handle; the runtime re-attaches
 * on load and start, and every method no-ops if nothing is attached or the UI is
 * unavailable in the current mode.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { GLYPHS, STATUS_KEYS } from "../_shared/ui.ts";
import type { JobsConfig } from "./config.ts";
import { pendingFailures } from "./format.ts";
import { JobsWidget, WIDGET_KEY } from "./tui.ts";
import type { JobRecord } from "./types.ts";

export interface UiController {
	/** Remember the live context; later calls use it when no context is passed. */
	attach(ctx: ExtensionContext): void;
	/** Forget the context and widget handle, for example on shutdown or reload. */
	detach(): void;
	/** Repaint the chip and widget using the attached context. */
	paint(): void;
	/** Publish the footer chip (and attach `ctx` when given). */
	setStatus(ctx?: ExtensionContext): void;
	/** Mount or unmount the widget (and attach `ctx` when given). */
	syncWidget(ctx?: ExtensionContext): void;
	/** Re-assert the widget after a rail above re-inserted itself. */
	reassertWidget(): void;
	/** Hide the rails while a dock screen owns the editor. */
	setSuppressed(value: boolean): void;
	/** Whether the rails are currently suppressed. */
	suppressed(): boolean;
	/** Ask the TUI to repaint, if a widget handle exists. */
	requestRender(): void;
}

export interface UiOptions {
	getJobs(): Iterable<JobRecord>;
	getConfig(): JobsConfig;
}

export function createUiController(options: UiOptions): UiController {
	const { getJobs, getConfig } = options;
	let ctx: ExtensionContext | undefined;
	/** Handle for the mounted widget, so the clock can request renders. */
	let tui: { requestRender(): void } | undefined;
	let suppressed = false;

	const theme = (target: ExtensionContext, color: "accent" | "error" | "dim", text: string): string => {
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
				return;
			}
			const jobs = [...getJobs()];
			const running = jobs.filter((job) => job.status === "running").length;
			const unseenFailures = jobs.filter((job) => !job.seen && job.status === "failed").length;
			const runningBadge = theme(target, "accent", `${GLYPHS.jobsRunning}${running}`);
			const failureBadge = theme(target, "error", `${GLYPHS.jobsFailure}${unseenFailures}`);
			if (running > 0 && unseenFailures > 0) {
				// One whitespace-free token so the compact status bar keeps both counts
				// (it otherwise collapses the chip to its first token).
				target.ui.setStatus(STATUS_KEYS.jobs, `${runningBadge}${theme(target, "dim", "·")}${failureBadge}`);
			} else if (running > 0) {
				target.ui.setStatus(STATUS_KEYS.jobs, runningBadge);
			} else if (unseenFailures > 0) {
				target.ui.setStatus(STATUS_KEYS.jobs, failureBadge);
			} else {
				target.ui.setStatus(STATUS_KEYS.jobs, undefined);
			}
		} catch {
			// UI may be unavailable in non-interactive modes.
		}
	};

	const syncWidget = (next?: ExtensionContext): void => {
		if (next) ctx = next;
		const target = ctx;
		if (!target) return;
		try {
			if (target.mode !== "tui" || !getConfig().showWidget || suppressed) {
				if (target.mode === "tui") target.ui.setWidget(WIDGET_KEY, undefined);
				return;
			}
			// Keep the widget mounted while an unreported failure is waiting, even
			// after the process is gone, so the failure is not silently dropped.
			const jobs = [...getJobs()];
			const hasRunning = jobs.some((job) => job.status === "running");
			const hasPendingFailure = pendingFailures(jobs).length > 0;
			if (!hasRunning && !hasPendingFailure) {
				target.ui.setWidget(WIDGET_KEY, undefined);
				return;
			}
			target.ui.setWidget(WIDGET_KEY, (handle, widgetTheme) => {
				tui = handle;
				return new JobsWidget(getJobs, widgetTheme);
			});
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
			tui = undefined;
		},
		paint: () => {
			setStatus();
			syncWidget();
		},
		setStatus,
		syncWidget,
		reassertWidget: () => {
			syncWidget();
		},
		setSuppressed: (value) => {
			suppressed = value;
		},
		suppressed: () => suppressed,
		requestRender: () => tui?.requestRender(),
	};
}
