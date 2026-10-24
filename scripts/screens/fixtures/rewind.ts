/**
 * The rewind timeline and the review list: the two screens that read a
 * snapshot store.
 *
 * `root: repo` is the real package root on purpose — the timeline renders the
 * store it would actually read — while the paths inside are invented.
 */

import type { ReviewEntry } from "../../../extensions/rewind/text/paths.ts";
import type { RewindPoint } from "../../../extensions/rewind/state/timeline.ts";
import { now } from "./shared.ts";
import { repo } from "../../theme.ts";

export const REWIND_POINTS: RewindPoint[] = [
	{
		entryId: "e5",
		prompt: "Refresh the README screenshots",
		summary: "Refresh the README screenshots",
		timestamp: now - 4 * 60_000,
		snapshot: {
			id: "s5",
			ref: "refs/pi/rewind/s5",
			commit: "a1b2c3d",
			reason: "auto",
			timestamp: now - 4 * 60_000,
			root: repo,
			head: "a1b2c3d",
			clean: true,
			includeUntracked: true,
			sessionId: "s1",
			entryId: "e5",
		},
	},
	{
		entryId: "e4",
		prompt: "Draw the plan review overlay from the kit",
		summary: "Draw the plan review overlay from the kit",
		timestamp: now - 46 * 60_000,
		snapshot: {
			id: "s4",
			ref: "refs/pi/rewind/s4",
			commit: "9f8e7d6",
			reason: "auto",
			timestamp: now - 46 * 60_000,
			root: repo,
			head: "9f8e7d6",
			clean: false,
			includeUntracked: true,
			sessionId: "s1",
			entryId: "e4",
		},
	},
	{
		entryId: "e3",
		prompt: "Fix the header rule on narrow terminals",
		summary: "Fix the header rule on narrow terminals",
		timestamp: now - 3 * 60 * 60_000,
	},
	{
		entryId: "e2",
		prompt: "Merge the job and watch list screens",
		summary: "Merge the job and watch list screens",
		timestamp: now - 5 * 60 * 60_000,
	},
	{
		entryId: "e1",
		prompt: "Start the design system sweep",
		summary: "Start the design system sweep",
		timestamp: now - 26 * 60 * 60_000,
		snapshot: {
			id: "s1",
			ref: "refs/pi/rewind/s1",
			commit: "1a2b3c4",
			reason: "auto",
			timestamp: now - 26 * 60 * 60_000,
			root: repo,
			head: "1a2b3c4",
			clean: true,
			includeUntracked: true,
			sessionId: "s1",
			entryId: "e1",
		},
	},
];

/** The changed files the review screen shows after a documentation turn. */
export const REVIEW_ENTRIES: ReviewEntry[] = [
	{ path: "extensions/rewind/commands/review.ts", change: "modified", added: 42, removed: 3 },
	{ path: "extensions/rewind/view/review-tui.ts", change: "added", added: 180, removed: 0 },
	{ path: "extensions/rewind/commands/commands.ts", change: "modified", added: 6, removed: 1 },
	{ path: "assets/review.png", change: "added", added: null, removed: null },
];
