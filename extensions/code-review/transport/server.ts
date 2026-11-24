/**
 * The review page's server: one mount on the session's own port.
 *
 * Nothing binds here — the page asks `serve`'s registry for a prefix, as every
 * served page does — so the review answers on the session's one origin and
 * closes with its last mount. Idle is not armed: a review waits for the person
 * who opened it, and `/review stop` or the session's end is the way it closes.
 *
 * The root, the reader and the page are the session's (`review/current.ts`), not
 * this mount's: a page that lives for an opening would read the tree it opened on
 * after a worktree switch.
 */

import type { MountOutcome, MountSpec } from "../../../lib/http/index.ts";
import { createStreams } from "../../../lib/web/streams.ts";
import type { SnapshotOutcome } from "../git/diff.ts";
import { REVIEW_BASE } from "../links.ts";
import type { ReviewCurrent } from "../review/current.ts";
import type { ReviewStore } from "../review/store.ts";
import type { ReviewScope } from "../scope.ts";
import { createReviewHandler, type ReviewHandlerDeps } from "./router.ts";

/** The largest write body the page accepts. */
export const MAX_BODY_BYTES = 256 * 1024;

/** What a mount needs of the session it serves. */
export interface ReviewServerDeps {
	/** The review's state, which outlives one mount. */
	store: ReviewStore;
	/** The session's root, reader and page. */
	current: ReviewCurrent;
	/** The Pi session the mount lands on. */
	session: string;
	mount: (spec: MountSpec) => Promise<MountOutcome>;
	/** Told after a send, so the session reads the comments at its next turn. */
	onSent?: ReviewHandlerDeps["onSent"];
}

/** A running review page. */
export interface ReviewServer {
	/** The address to open, `/review/new` on the session's origin. */
	url: string;
	base: string;
	store: ReviewStore;
	current: ReviewCurrent;
	/** The scope the page is showing. */
	scope(): ReviewScope;
	/** Read the page's current snapshot. */
	snapshot(): Promise<SnapshotOutcome>;
	/** Release the prefix; idempotent. The page it served is the session's to drop. */
	close(): Promise<void>;
}

/**
 * Mount one review page, or say why the session has none.
 *
 * A refused mount leaves the store untouched: the caller reports the reason and the
 * session is exactly as it was.
 */
export async function createReviewPage(
	deps: ReviewServerDeps,
): Promise<{ kind: "page"; page: ReviewServer } | { kind: "refused"; reason: string }> {
	const streams = createStreams({});
	const handler = createReviewHandler({
		store: deps.store,
		current: deps.current,
		base: REVIEW_BASE,
		streams,
		notify: {
			review: (review) => streams.broadcast(JSON.stringify({ review })),
			moved: () => streams.broadcast(JSON.stringify({ moved: true })),
		},
		...(deps.onSent === undefined ? {} : { onSent: deps.onSent }),
	});
	const outcome = await deps.mount({
		session: deps.session,
		prefix: REVIEW_BASE,
		handler,
		maxBodyBytes: MAX_BODY_BYTES,
	});
	if (outcome.kind === "refused") return { kind: "refused", reason: outcome.reason };
	const mount = outcome.mount;
	let closed = false;
	return {
		kind: "page",
		page: {
			url: `${mount.origin}${REVIEW_BASE}/new`,
			base: REVIEW_BASE,
			store: deps.store,
			current: deps.current,
			scope: () => deps.store.current()?.scope ?? "base",
			snapshot: () => deps.current.snapshot(),
			close: async () => {
				if (closed) return;
				closed = true;
				await mount.release();
			},
		},
	};
}
