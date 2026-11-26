/**
 * The review as one request reads it: the session's root, its reader, and its page.
 *
 * A page lives for the session while its tree can move under it — `worktree enter` changes
 * `ctx.cwd` — so the root is resolved per request and the reader rebuilt only when it moved.
 * One seam, because the page route, the write route and the whole-file view read the same
 * three facts, and a copy in each is how they drift apart.
 */

import { effectiveRealCwd } from "../../../lib/env.ts";
import { lastSegment } from "../../../lib/path.ts";
import type { ReviewConfig } from "../config/config.ts";
import { createReviewReader, type ReviewReader, type SnapshotOutcome } from "../git/diff.ts";
import type { ReviewPreset, ReviewScope } from "../scope.ts";
import { NO_PAGE, type ReviewPageState, type ReviewStore } from "./store.ts";

/** What the seam needs of the session it serves. */
export interface ReviewCurrentDeps {
	store: ReviewStore;
	/** The host's exec, for the reader's git calls. */
	exec: Parameters<typeof createReviewReader>[0];
	/** The config to read with, until an open names its own base. */
	config: ReviewConfig;
	/** The session's working directory, as it is now. */
	cwd: () => string;
}

/** The review at the moment one request reads it. */
export interface ReviewCurrent {
	/** The checkout this request reads, and the repository's name. */
	place(): { root: string; repo: string };
	/** The reader for the root this request reads — rebuilt when the root moved. */
	reader(): ReviewReader;
	/** The session's page, or undefined when no review is open. */
	page(): ReviewPageState | undefined;
	/** One page's snapshot, or the sentence a scope with no answer owes. */
	snapshotOf(page: ReviewPageState): Promise<SnapshotOutcome>;
	/** The open page's snapshot, or the sentence a session with no page owes. */
	snapshot(): Promise<SnapshotOutcome>;
	/** Mint the page for a scope — and the preset that names it, when one does. */
	openPage(scope: ReviewScope, preset?: ReviewPreset): Promise<ReviewPageState>;
}

export function createReviewCurrent(deps: ReviewCurrentDeps): ReviewCurrent {
	let config = deps.config;
	/** The reader built for one root and one base; rebuilt when either moves. */
	let held: { key: string; reader: ReviewReader } | undefined;

	const place = (): { root: string; repo: string } => {
		const root = effectiveRealCwd(deps.cwd());
		return { root, repo: lastSegment(root) ?? root };
	};

	const reader = (): ReviewReader => {
		const { root } = place();
		const key = `${root}\0${config.base}`;
		if (held?.key !== key) {
			held = {
				key,
				reader: createReviewReader(deps.exec, root, {
					base: config.base,
					context: config.diffContext,
					maxLines: config.maxDiffLines,
					maxFiles: config.maxFiles,
				}),
			};
		}
		return held.reader;
	};

	return {
		place,
		reader,
		page: () => deps.store.current(),
		snapshotOf: (page) => reader().snapshot(page.scope),
		async snapshot() {
			const page = deps.store.current();
			return page === undefined ? { kind: "failed", message: NO_PAGE } : reader().snapshot(page.scope);
		},
		async openPage(scope, preset) {
			// The opening mints the page and nothing else: the snapshot a page draws is read per
			// request, so an eager read here would be a second git call for an answer nobody kept.
			return deps.store.open(scope, preset);
		},
	};
}
