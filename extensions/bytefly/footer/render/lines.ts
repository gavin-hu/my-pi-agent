/**
 * Turn a `StatusSnapshot` into the two footer lines.
 *
 * Line 1 — state: left `pwd` and the session name, right the alert, the mode
 * chips, then `⎇ branch · ⑂ worktree · ◉ 4780`. Line 2 — meters: left
 * the context gauge and usage, right the model and thinking level.
 *
 * The split is one job per row. The state chips change while a session runs, so
 * they ride the line with slack; the meters are the dense row, and a fact that
 * moves onto the top row is one the bottom row stops dropping to fit.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	alertSegment,
	branchSegment,
	cacheSegment,
	contextSegment,
	costSegment,
	delegationSegment,
	modelSegment,
	modesSegment,
	portsSegment,
	pwdSegment,
	sessionSegment,
	thinkingSegment,
	tokensSegment,
	windowSegment,
	worktreeSegment,
} from "./segments.ts";
import type { LineSpec, Segment, StatusSnapshot } from "../types.ts";

function defined(segments: Array<Segment | null>): Segment[] {
	return segments.filter((segment): segment is Segment => segment !== null);
}

/** Build the state and meter lines for a snapshot. */
export function buildLines(snapshot: StatusSnapshot, theme: Theme, home: string | undefined): LineSpec[] {
	const line1: LineSpec = {
		left: defined([pwdSegment(snapshot, theme, home), sessionSegment(snapshot, theme)]),
		// The state chips lead the right zone: it is right-aligned, so a chip that
		// appears at its start leaves the location chips where they were, the same
		// stability the gauge gets by sitting at column 0.
		right: defined([
			alertSegment(snapshot, theme),
			modesSegment(snapshot, theme),
			branchSegment(snapshot, theme),
			worktreeSegment(snapshot, theme),
			// Last, so the page port rides behind the location chips. A page starting or
			// stopping then changes the end of the line, and `⎇ branch · ⑂ worktree` stays the
			// adjacent pair a reader scans for where the work lands.
			portsSegment(snapshot, theme),
		]),
	};

	const line2Left = defined([
		contextSegment(snapshot, theme),
		windowSegment(snapshot, theme),
		costSegment(snapshot, theme),
		delegationSegment(snapshot, theme),
		tokensSegment(snapshot, theme),
		cacheSegment(snapshot, theme),
	]);

	const line2Right = defined([modelSegment(snapshot, theme), thinkingSegment(snapshot, theme)]);

	return [line1, { left: line2Left, right: line2Right }];
}
