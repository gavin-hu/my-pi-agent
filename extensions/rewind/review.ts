/**
 * The `/review` orchestration.
 *
 * The latest prompt with an `auto` snapshot on the active branch is the review
 * target. `runtime.plan` already knows how to diff that snapshot against the
 * working tree and how to restore a subset, so this module only coordinates:
 * the file list, the per-file patch, the confirmations, the restore, and the
 * refresh afterwards. No state is persisted; every open re-derives the review
 * from git and the session branch.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { sanitizeLine } from "../../lib/format.ts";
import { isPlanModeEnabled } from "../../lib/plan-state.ts";
import { withRailsSuppressed } from "../../lib/rails.ts";
import {
	boundDiff,
	formatRevertAllBody,
	formatRevertOneBody,
	formatRevertSelectedBody,
	formatReviewListText,
	formatReviewRevertText,
} from "./format.ts";
import { toReviewEntries, type ReviewEntry } from "./paths.ts";
import {
	ReviewDiffComponent,
	ReviewListComponent,
	type ReviewDiffAction,
	type ReviewListResult,
} from "./review-tui.ts";
import type { RestorePlan } from "./restore.ts";
import type { RewindRuntime } from "./runtime.ts";
import { buildRewindPoints, type RewindPoint } from "./timeline.ts";
import type { Snapshot, RestoreSummary } from "./types.ts";

/** One reviewable view of the working tree. */
interface ReviewView {
	plan: RestorePlan;
	entries: ReviewEntry[];
	/** Tree id of HEAD when the view was read, or undefined without a commit. */
	headTree?: string;
}

/** Whether the working tree is clean against HEAD, so the diff is all committed. */
function isCommitted(view: ReviewView): boolean {
	return view.headTree !== undefined && view.plan.currentTree === view.headTree;
}

/** A loaded review: where it is, which prompt it follows, and what changed. */
interface LoadedReview {
	root: string;
	point: RewindPoint;
	snapshot: Snapshot;
	view: ReviewView;
}

type LoadResult = { ok: true; review: LoadedReview } | { ok: false; kind: "info" | "warning"; message: string };

type RefreshResult = { kind: "ok"; view: ReviewView } | { kind: "empty" } | { kind: "error"; message: string };

type RevertResult =
	| { kind: "ok"; summary: RestoreSummary; next: ReviewView }
	| { kind: "empty"; summary: RestoreSummary }
	| { kind: "error"; message: string };

/** One-line error text for a notification. */
function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** The latest prompt on the branch with a code snapshot, or a reason there is none. */
async function loadReview(runtime: RewindRuntime, ctx: ExtensionCommandContext): Promise<LoadResult> {
	if (!ctx.isIdle()) await ctx.waitForIdle();
	if (isPlanModeEnabled(ctx.sessionManager.getBranch())) {
		return {
			ok: false,
			kind: "warning",
			message: "Plan mode is read-only. Approve the plan before reviewing and reverting its changes.",
		};
	}

	const root = await runtime.rootFor(ctx);
	if (!root) return { ok: false, kind: "warning", message: "Review needs a git repository." };

	const snapshots = await runtime.list(root);
	const point = buildRewindPoints(ctx.sessionManager.getBranch(), snapshots, ctx.sessionManager.getSessionId()).find(
		(candidate) => candidate.snapshot,
	);
	if (!point?.snapshot) {
		return { ok: false, kind: "info", message: "No prompt with a code snapshot to review yet." };
	}

	const planned = await runtime.plan(root, point.snapshot);
	if (!planned.ok) return { ok: false, kind: "warning", message: planned.reason };
	if (planned.plan.paths.length === 0) {
		const label = point.summary || "this prompt";
		return { ok: false, kind: "info", message: `No changes since the snapshot for "${label}".` };
	}

	const stats = await runtime.numStat(root, point.snapshot, planned.plan.currentTree);
	const headTree = await runtime.headTree(root);
	return {
		ok: true,
		review: {
			root,
			point,
			snapshot: point.snapshot,
			view: { plan: planned.plan, entries: toReviewEntries(planned.plan.paths, stats), headTree },
		},
	};
}

/** Re-plan after a revert, so the list and counts reflect the tree that is left. */
async function refreshView(runtime: RewindRuntime, root: string, snapshot: Snapshot): Promise<RefreshResult> {
	const planned = await runtime.plan(root, snapshot);
	if (!planned.ok) return { kind: "error", message: planned.reason };
	if (planned.plan.paths.length === 0) return { kind: "empty" };
	const stats = await runtime.numStat(root, snapshot, planned.plan.currentTree);
	const headTree = await runtime.headTree(root);
	return { kind: "ok", view: { plan: planned.plan, entries: toReviewEntries(planned.plan.paths, stats), headTree } };
}

/** Restore one or more paths, then re-read the review. */
async function revertPaths(
	runtime: RewindRuntime,
	ctx: ExtensionCommandContext,
	review: LoadedReview,
	paths: readonly string[],
): Promise<RevertResult> {
	let summary: RestoreSummary;
	try {
		summary = await runtime.restore(ctx, review.root, review.snapshot, runtime.configFor(review.root), paths);
	} catch (error) {
		return { kind: "error", message: `Revert failed: ${errorText(error)}` };
	}
	try {
		await runtime.setStatus(ctx);
	} catch {
		// The status chip is best-effort; a failed repaint must not report the
		// restore itself as failed.
	}

	let refreshed: RefreshResult;
	try {
		refreshed = await refreshView(runtime, review.root, review.snapshot);
	} catch (error) {
		return { kind: "error", message: `Reverted, but could not refresh the review: ${errorText(error)}` };
	}
	if (refreshed.kind === "error") return { kind: "error", message: refreshed.message };
	if (refreshed.kind === "empty") return { kind: "empty", summary };
	return { kind: "ok", summary, next: refreshed.view };
}

/** Ask before reverting one file. */
async function confirmRevertOne(
	ctx: ExtensionCommandContext,
	review: LoadedReview,
	entry: ReviewEntry,
	safety: boolean,
	committed: boolean,
): Promise<boolean> {
	return ctx.ui.confirm(
		`Revert ${sanitizeLine(entry.path)}?`,
		formatRevertOneBody(entry, review.point.prompt, safety, committed),
	);
}

/** Ask before reverting one or more selected files. */
async function confirmRevertSelected(
	ctx: ExtensionCommandContext,
	review: LoadedReview,
	entries: readonly ReviewEntry[],
	safety: boolean,
	committed: boolean,
): Promise<boolean> {
	const files = `${entries.length} selected file${entries.length === 1 ? "" : "s"}`;
	return ctx.ui.confirm(`Revert ${files}?`, formatRevertSelectedBody(entries, review.point.prompt, safety, committed));
}

/** Ask before reverting every changed path in the review. */
async function confirmRevertAll(
	ctx: ExtensionCommandContext,
	review: LoadedReview,
	entries: readonly ReviewEntry[],
	safety: boolean,
	committed: boolean,
): Promise<boolean> {
	const files = `${entries.length} file${entries.length === 1 ? "" : "s"}`;
	return ctx.ui.confirm(`Revert all ${files}?`, formatRevertAllBody(entries, review.point.prompt, safety, committed));
}

/** The interactive loop: list, diff, confirm, restore, refresh. */
async function reviewLoop(runtime: RewindRuntime, ctx: ExtensionCommandContext, review: LoadedReview): Promise<void> {
	const label = review.point.summary || review.point.prompt || "this prompt";
	const safety = runtime.configFor(review.root).safetySnapshot;
	let view = review.view;
	let index = 0;
	let selected: string[] = [];

	while (true) {
		const committed = isCommitted(view);
		const screen = await ctx.ui.custom<ReviewListResult | undefined>(
			(tui, theme, _keybindings, done) =>
				new ReviewListComponent({
					entries: view.entries,
					prompt: label,
					theme,
					initialIndex: index,
					initialSelected: selected,
					committed,
					onClose: (result) => done(result),
					requestRender: () => tui.requestRender(),
					viewportRows: () => tui.terminal?.rows,
				}),
		);
		if (!screen) return;
		selected = screen.selected;
		const action = screen.action;
		if (!action) return;

		if (action.kind === "revertAll") {
			if (!(await confirmRevertAll(ctx, review, view.entries, safety, committed))) continue;
			const result = await revertPaths(
				runtime,
				ctx,
				review,
				view.plan.paths.map((entry) => entry.path),
			);
			if (result.kind === "error") {
				ctx.ui.notify(result.message, "error");
				return;
			}
			if (result.kind === "empty") {
				ctx.ui.notify(formatReviewRevertText(result.summary, 0), "info");
				return;
			}
			ctx.ui.notify(formatReviewRevertText(result.summary, result.next.entries.length), "info");
			view = result.next;
			selected = [];
			index = Math.min(index, view.entries.length - 1);
			continue;
		}

		if (action.kind === "revert") {
			const entries = action.paths
				.map((path) => view.entries.find((candidate) => candidate.path === path))
				.filter((entry): entry is ReviewEntry => entry !== undefined);
			if (entries.length === 0) continue;
			const paths = entries.map((entry) => entry.path);
			const approved =
				entries.length === 1
					? await confirmRevertOne(ctx, review, entries[0], safety, committed)
					: await confirmRevertSelected(ctx, review, entries, safety, committed);
			if (!approved) continue;
			const result = await revertPaths(runtime, ctx, review, paths);
			if (result.kind === "error") {
				ctx.ui.notify(result.message, "error");
				return;
			}
			if (result.kind === "empty") {
				ctx.ui.notify(formatReviewRevertText(result.summary, 0), "info");
				return;
			}
			ctx.ui.notify(formatReviewRevertText(result.summary, result.next.entries.length), "info");
			view = result.next;
			selected = [];
			index = Math.min(index, view.entries.length - 1);
			continue;
		}

		const entry = view.entries.find((candidate) => candidate.path === action.path);
		if (!entry) continue;
		let patch: string;
		try {
			patch = await runtime.patch(review.root, review.snapshot, view.plan.currentTree, [entry.path]);
		} catch (error) {
			ctx.ui.notify(`Could not read the diff: ${errorText(error)}`, "error");
			continue;
		}
		const decision = await ctx.ui.custom<ReviewDiffAction | undefined>(
			(tui, theme, _keybindings, done) =>
				new ReviewDiffComponent({
					entry,
					prompt: label,
					lines: boundDiff(patch),
					committed,
					theme,
					onClose: (chosen) => done(chosen),
					requestRender: () => tui.requestRender(),
					viewportRows: () => tui.terminal?.rows,
				}),
		);
		if (decision !== "revert") continue;
		if (!(await confirmRevertOne(ctx, review, entry, safety, committed))) continue;
		const result = await revertPaths(runtime, ctx, review, [entry.path]);
		if (result.kind === "error") {
			ctx.ui.notify(result.message, "error");
			return;
		}
		if (result.kind === "empty") {
			ctx.ui.notify(formatReviewRevertText(result.summary, 0), "info");
			return;
		}
		ctx.ui.notify(formatReviewRevertText(result.summary, result.next.entries.length), "info");
		view = result.next;
		selected = [];
		index = Math.min(index, view.entries.length - 1);
	}
}

/**
 * Open `/review`: the latest turn's changes, with per-file diffs and reverts.
 *
 * The TUI gets the two screens. RPC, print, and JSON print the changed-file
 * list, because custom components cannot be forwarded; that keeps the command
 * useful without pretending the review actions exist there.
 */
export async function openReview(
	pi: ExtensionAPI,
	runtime: RewindRuntime,
	ctx: ExtensionCommandContext,
): Promise<void> {
	let loaded: LoadResult;
	try {
		loaded = await loadReview(runtime, ctx);
	} catch (error) {
		ctx.ui.notify(`Review failed: ${errorText(error)}`, "error");
		return;
	}
	if (!loaded.ok) {
		ctx.ui.notify(loaded.message, loaded.kind);
		return;
	}
	if (ctx.mode !== "tui") {
		ctx.ui.notify(
			formatReviewListText(loaded.review.view.entries, loaded.review.point.prompt, isCommitted(loaded.review.view)),
			"info",
		);
		return;
	}
	await withRailsSuppressed(pi, () => reviewLoop(runtime, ctx, loaded.review));
}
