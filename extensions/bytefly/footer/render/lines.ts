/**
 * Turn a `StatusSnapshot` into the two footer lines.
 *
 * Line 1 — identity: left `pwd`, right `⎇ branch · ⑂ worktree · ◉ browse`.
 * Line 2 — resources: left the plan/alert statuses then the context gauge and
 * usage meters, right the model and thinking level.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	branchSegment,
	cacheSegment,
	contextSegment,
	costSegment,
	delegationSegment,
	modelSegment,
	modesSegment,
	pwdSegment,
	browseSegment,
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

/** Build the identity and resources lines for a snapshot. */
export function buildLines(snapshot: StatusSnapshot, theme: Theme, home: string | undefined): LineSpec[] {
	const line1: LineSpec = {
		left: defined([pwdSegment(snapshot, theme, home), sessionSegment(snapshot, theme)]),
		right: defined([branchSegment(snapshot, theme), worktreeSegment(snapshot, theme), browseSegment(snapshot, theme)]),
	};

	const line2Left = defined([
		contextSegment(snapshot, theme),
		windowSegment(snapshot, theme),
		costSegment(snapshot, theme),
		delegationSegment(snapshot, theme),
		tokensSegment(snapshot, theme),
		cacheSegment(snapshot, theme),
		modesSegment(snapshot, theme),
	]);

	const line2Right = defined([modelSegment(snapshot, theme), thinkingSegment(snapshot, theme)]);

	return [line1, { left: line2Left, right: line2Right }];
}
