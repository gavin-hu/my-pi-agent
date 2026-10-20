/**
 * Footer status and finish notices for background subagent runs.
 *
 * The runtime owns lifecycle and results; this owns the running-count chip and
 * the notice that points back at `/agents`. A cancelled run stays silent because
 * the user initiated it.
 */

import { sanitizeLine } from "../../lib/format.ts";
import { GLYPHS, STATUS_KEYS } from "../../lib/tui/glyphs.ts";
import { createStatusController, type StatusController } from "../../lib/tui/status-controller.ts";
import type { BackgroundRun } from "./background.ts";

export interface SubagentUiOptions {
	/** The current runs, read fresh on every paint. */
	runs(): readonly BackgroundRun[];
}

export interface SubagentUiController extends StatusController {
	notifyFinished(run: BackgroundRun): void;
}

/** A status word a notice can read without exposing the type's spelling. */
function statusText(status: BackgroundRun["status"]): string {
	return status === "timedout" ? "timed out" : status;
}

export function createSubagentUi(options: SubagentUiOptions): SubagentUiController {
	const controller = createStatusController({
		keys: [STATUS_KEYS.agents],
		enabled: () => true,
		chips: () => {
			const running = options.runs().filter((run) => run.status === "running").length;
			return [{ key: STATUS_KEYS.agents, glyph: GLYPHS.delegation, count: running, role: "accent" }];
		},
	});

	const notifyFinished = (run: BackgroundRun): void => {
		// A cancelled run stays silent because the user initiated it.
		if (run.status === "cancelled") return;
		const failed = run.status === "failed" || run.status === "timedout";
		const action = run.status === "finished" ? "collect" : "inspect";
		controller.notify(
			`Background subagent ${run.id} (${sanitizeLine(run.agent)}) ${statusText(run.status)}. Use /agents to ${action} it.`,
			failed ? "error" : "info",
		);
	};

	return { ...controller, notifyFinished };
}
