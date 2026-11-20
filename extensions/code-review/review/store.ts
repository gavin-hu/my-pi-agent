/**
 * The session's one review page: its token, and the review its first write mints.
 *
 * A page is opened for a scope and mints a write token at once, because a write
 * cannot carry a credential the server has never handed out. The review itself —
 * the id, the comments, the marks — is minted by the first write, so opening a
 * page to look at a diff costs no identity; `/review/new` may be opened by a
 * hundred readers and only the one that comments creates a record.
 *
 * Every mutation is one call that reads the token and the snapshot the page
 * rendered, and answers either the new state or the refusal that changed
 * nothing. Value-only: all state lives in the returned closure.
 */

import { tokenMatches } from "../../../lib/http/token.ts";
import { mintToken as defaultMint } from "../../../lib/http/token.ts";
import type { ReviewScope } from "../scope.ts";

/** One comment a reviewer wrote on a line. */
export interface ReviewComment {
	id: string;
	/** Root-relative path the comment anchors to. */
	rel: string;
	/** The line number on `side`. */
	line: number;
	/** Which side of the diff the number counts: the new file or the old. */
	side: "new" | "old";
	/** Text the reviewer selected, for the thread's head. */
	quote?: string;
	/** What the reviewer wrote, one block, already trimmed. */
	body: string;
	/** `draft` until the reviewer sends it; `sent` once the session was told. */
	state: "draft" | "sent";
	at: number;
}

/** One page's review. */
export interface Review {
	id: string;
	/** The comparison the comments were written on, fixed for the review's life. */
	scope: ReviewScope;
	base: string;
	label: string;
	comments: ReviewComment[];
	/** Paths the reviewer marked read. */
	reviewed: string[];
	createdAt: number;
	updatedAt: number;
	/** When the drafts were last sent. */
	sentAt?: number;
	/** The snapshot the first write rendered, so a page can say the tree moved since. */
	rev: string;
}

/** One session's page, as the router reads it. */
export interface ReviewPageState {
	scope: ReviewScope;
	base: string;
	label: string;
	/** The page's write credential, minted when the page opened. */
	token: string;
	review?: Review;
}

/** A write the page may make. */
export type WriteOp =
	| { kind: "comment"; rel: string; line: number; side: "new" | "old"; quote?: string; body: string }
	| { kind: "drop"; id: string }
	| { kind: "reviewed"; rel: string; reviewed: boolean }
	| { kind: "send" };

/** What a write answered: the page's id, or the refusal that left the state alone. */
export type WriteOutcome =
	| { ok: true; id: string; sent: ReviewComment[]; review: Review }
	| { ok: false; status: number; message: string };

/** Most comments one review holds. */
export const MAX_COMMENTS = 200;
/** Longest comment, after trimming. */
export const MAX_COMMENT_LENGTH = 2000;
/** Longest selection quote kept. */
export const MAX_QUOTE_LENGTH = 500;
/** Longest path a comment may name. */
export const MAX_PATH_LENGTH = 4096;

/** The refusal a write gets when the tree moved under the page. */
export const SNAPSHOT_MOVED =
	"the diff moved since this page rendered — reload the page, then comment on the line again";
/** The refusal a stale token gets. */
export const BAD_TOKEN = "this page's write token is not the one it was opened with — reload the page";
/** The refusal a page that was closed gets. */
export const NO_PAGE = "this session has no review page open — run /review first";

export interface ReviewStore {
	/** The session's page, or undefined when none is open. */
	current(): ReviewPageState | undefined;
	/** Start a page for a scope, replacing whatever the session held. */
	open(scope: ReviewScope, base: string, label: string): ReviewPageState;
	/** The page a review id and token name, or undefined when they do not. */
	resume(id: string, token: string): ReviewPageState | undefined;
	/**
	 * Apply one write. `rev` is the snapshot the page rendered; it must equal
	 * `current`, or the write is refused and nothing changes.
	 */
	write(token: string, rev: string, current: string, op: WriteOp): WriteOutcome;
	/** End the page; idempotent. */
	close(): void;
}

export interface ReviewStoreOptions {
	/** The token and id generator; a case injects one. */
	mint?: () => string;
	/** Wall-clock seam. */
	now?: () => number;
}

/** A trimmed comment body, or the refusal it owes. */
function bodyOf(raw: unknown): { body: string } | { message: string } {
	const text = typeof raw === "string" ? raw.replace(/\r\n/g, "\n").trim() : "";
	if (text === "") return { message: "a comment needs something written in it" };
	if (text.length > MAX_COMMENT_LENGTH) {
		return { message: `a comment holds at most ${MAX_COMMENT_LENGTH} characters` };
	}
	return { body: text };
}

/** One review's state, and the page that holds it. */
export function createReviewStore(options: ReviewStoreOptions = {}): ReviewStore {
	const mint = options.mint ?? defaultMint;
	const now = options.now ?? (() => Date.now());
	let page: ReviewPageState | undefined;

	/** A fresh id, unique among the comments already stored. */
	const freshId = (taken: ReadonlySet<string>): string => {
		for (let attempt = 0; attempt < 8; attempt++) {
			const candidate = mint().slice(0, 8);
			if (!taken.has(candidate)) return candidate;
		}
		return `${mint().slice(0, 8)}-${taken.size}`;
	};

	/** The page a token names, or the refusal. */
	const byToken = (token: string): ReviewPageState | { message: string } => {
		if (!page) return { message: NO_PAGE };
		if (!tokenMatches(page.token, token)) return { message: BAD_TOKEN };
		return page;
	};

	return {
		current: () => page,
		open(scope, base, label) {
			page = { scope, base, label, token: mint() };
			return page;
		},
		resume(id, token) {
			if (!page?.review) return undefined;
			if (page.review.id !== id) return undefined;
			return tokenMatches(page.token, token) ? page : undefined;
		},
		write(token, rev, current, op) {
			const held = byToken(token);
			if ("message" in held)
				return { ok: false, status: held.message === BAD_TOKEN ? 403 : 409, message: held.message };
			if (rev !== current) return { ok: false, status: 409, message: SNAPSHOT_MOVED };

			// The first write is where the review starts: no id before it, so a page
			// nobody commented on leaves nothing behind.
			if (!held.review) {
				held.review = {
					id: freshId(new Set()),
					scope: held.scope,
					base: held.base,
					label: held.label,
					comments: [],
					reviewed: [],
					createdAt: now(),
					updatedAt: now(),
					rev: current,
				};
			}
			const review = held.review;

			if (op.kind === "comment") {
				if (review.comments.length >= MAX_COMMENTS) {
					return { ok: false, status: 400, message: `one review holds at most ${MAX_COMMENTS} comments` };
				}
				const text = bodyOf(op.body);
				if ("message" in text) return { ok: false, status: 400, message: text.message };
				const rel = typeof op.rel === "string" ? op.rel.trim() : "";
				if (rel === "" || rel.length > MAX_PATH_LENGTH) {
					return { ok: false, status: 400, message: "a comment names one file in the diff" };
				}
				if (!Number.isInteger(op.line) || op.line < 1) {
					return { ok: false, status: 400, message: "a comment names a line number" };
				}
				const comment: ReviewComment = {
					id: freshId(new Set(review.comments.map((entry) => entry.id))),
					rel,
					line: op.line,
					side: op.side === "old" ? "old" : "new",
					...(typeof op.quote === "string" && op.quote.trim() !== ""
						? { quote: op.quote.trim().slice(0, MAX_QUOTE_LENGTH) }
						: {}),
					body: text.body,
					state: "draft",
					at: now(),
				};
				review.comments.push(comment);
				review.updatedAt = comment.at;
				return { ok: true, id: review.id, sent: [], review };
			}

			if (op.kind === "drop") {
				const index = review.comments.findIndex((entry) => entry.id === op.id);
				if (index < 0) return { ok: false, status: 404, message: "that comment is not on this review" };
				review.comments.splice(index, 1);
				review.updatedAt = now();
				return { ok: true, id: review.id, sent: [], review };
			}

			if (op.kind === "reviewed") {
				const rel = typeof op.rel === "string" ? op.rel.trim() : "";
				if (rel === "") return { ok: false, status: 400, message: "a mark names one file in the diff" };
				const marked = new Set(review.reviewed);
				if (op.reviewed) marked.add(rel);
				else marked.delete(rel);
				review.reviewed = [...marked];
				review.updatedAt = now();
				return { ok: true, id: review.id, sent: [], review };
			}

			const sent = review.comments.filter((entry) => entry.state === "draft");
			for (const comment of sent) comment.state = "sent";
			if (sent.length > 0) {
				review.sentAt = now();
				review.updatedAt = review.sentAt;
			}
			return { ok: true, id: review.id, sent, review };
		},
		close() {
			page = undefined;
		},
	};
}
