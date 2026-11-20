/**
 * The review page's server: one mount on the session's own port.
 *
 * Nothing binds here — the page asks `serve`'s registry for a prefix, as every
 * served page does — so the review answers on the session's one origin and
 * closes with its last mount. Idle is not armed: a review waits for the person
 * who opened it, and `/review stop` or the session's end is the way it closes.
 */

import type { MountOutcome, MountSpec } from "../../../lib/http/index.ts";
import { createReviewReader, type ReviewReader, type SnapshotOutcome } from "../git/diff.ts";
import type { ReviewConfig } from "../config/config.ts";
import { createReviewStore, type ReviewStore } from "../review/store.ts";
import type { ReviewScope } from "../scope.ts";
import { createReviewHandler, type ReviewHandlerDeps } from "./router.ts";

/** The prefix every review page answers under. */
export const REVIEW_BASE = "/review";

/** The largest write body the page accepts. */
export const MAX_BODY_BYTES = 256 * 1024;

/** What a page needs from the session it serves. */
export interface ReviewServerDeps {
	/** The host's exec, for the reader's git calls. */
	exec: Parameters<typeof createReviewReader>[0];
	/** The Pi session the mount lands on. */
	session: string;
	/** The checkout the review reads, canonicalized by the caller. */
	root: string;
	/** The repository's name, for the header. */
	repo: string;
	config: ReviewConfig;
	/** The comparison the page opens on. */
	scope: ReviewScope;
	mount: (spec: MountSpec) => Promise<MountOutcome>;
	/** Told after a send, so the session reads the comments at its next turn. */
	onSent?: ReviewHandlerDeps["onSent"];
	/** The token and id generator, for a case. */
	mint?: () => string;
	/** Wall-clock seam, for a case. */
	now?: () => number;
}

/** A running review page. */
export interface ReviewServer {
	/** The address to open, `/review/new` on the session's origin. */
	url: string;
	base: string;
	store: ReviewStore;
	reader: ReviewReader;
	/** The scope the page is showing. */
	scope(): ReviewScope;
	/** Read the page's current snapshot. */
	snapshot(): Promise<SnapshotOutcome>;
	/** Release the prefix; idempotent. */
	close(): Promise<void>;
}

/**
 * Mount one review page, or say why the session has none.
 *
 * A refused mount leaves the store unused: the caller reports the reason and the
 * session is exactly as it was.
 */
export async function createReviewPage(
	deps: ReviewServerDeps,
): Promise<{ kind: "page"; page: ReviewServer } | { kind: "refused"; reason: string }> {
	const store = createReviewStore({
		...(deps.mint === undefined ? {} : { mint: deps.mint }),
		...(deps.now === undefined ? {} : { now: deps.now }),
	});
	const reader = createReviewReader(deps.exec, deps.root, {
		base: deps.config.base,
		context: deps.config.diffContext,
		maxLines: deps.config.maxDiffLines,
		maxFiles: deps.config.maxFiles,
	});
	const handler = createReviewHandler({
		store,
		reader,
		base: REVIEW_BASE,
		repo: deps.repo,
		root: deps.root,
		baseRef: deps.config.base,
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
	// The page exists from the mount, so a status read before anybody asks for it
	// already names the comparison it serves.
	const opened = store.open(deps.scope, "", "");
	if (deps.scope === "base") opened.base = (await reader.baseRef()) ?? "";
	const first = await reader.snapshot(deps.scope, opened.base);
	if (first.kind === "snapshot") {
		opened.base = first.snapshot.base;
		opened.label = first.snapshot.label;
	}
	let closed = false;
	return {
		kind: "page",
		page: {
			url: `${mount.origin}${REVIEW_BASE}/new`,
			base: REVIEW_BASE,
			store,
			reader,
			scope: () => store.current()?.scope ?? "base",
			snapshot: async () => {
				const page = store.current();
				return page === undefined
					? { kind: "failed", message: "this session has no review page open" }
					: reader.snapshot(page.scope, page.base);
			},
			close: async () => {
				if (closed) return;
				closed = true;
				store.close();
				await mount.release();
			},
		},
	};
}
