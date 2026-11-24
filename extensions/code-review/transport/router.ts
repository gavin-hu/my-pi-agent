/**
 * The review page's routes: the page, its script, and the four writes.
 *
 * One envelope, then the route: a method allowlist, the `Host` rule, the origin
 * check on a write, a JSON body on every `/api/` route, the page's token compared
 * in constant time, and loopback as the last gate. The page's own GET carries no
 * token — `/review/new` mints one — while every later read and every write names
 * the token it was handed.
 *
 * A GET renders, a POST applies one operation and answers the state it produced,
 * so the client has one shape to read and a refused write changes nothing.
 */

import { join } from "node:path";
import {
	envelopeRefusal,
	jsonError,
	jsonHeaders,
	jsonResponse,
	LOOPBACK_HOSTS,
	type LoopbackHandler,
	type LoopbackRequest,
	pageHeaders,
	parseRequestUrl,
	requireJsonBody,
	type ServeResponse,
	scriptHeaders,
} from "../../../lib/http/index.ts";
import { tokenMatches } from "../../../lib/http/token.ts";
import { isInsideReal } from "../../../lib/path.ts";
import { THEME_JS, THEME_JS_PATH } from "../../../lib/web/index.ts";
import type { ReviewSnapshot } from "../git/diff.ts";
import type { ReviewCurrent } from "../review/current.ts";
import { NO_PAGE, type Review, type ReviewComment, type ReviewStore, type WriteOp } from "../review/store.ts";
import { parseScope, type ReviewScope } from "../scope.ts";
import { REVIEW_CLIENT_JS } from "../view/client.ts";
import { renderReviewFile } from "../view/file.ts";
import { renderReviewPage, renderReviewProblem } from "../view/page.ts";

/** The page's script, beside the shared theme. */
export const CLIENT_JS_PATH = "/client.js";

/** The page's refusal when a scope names no review to show. */
const NO_REVIEW = "that review is not open on this session — run /review";

/** What the router needs of the session it serves. */
export interface ReviewHandlerDeps {
	store: ReviewStore;
	/** The session's root, reader and page, read per request. */
	current: ReviewCurrent;
	/** The mount prefix, `/review`. */
	base: string;
	/** Called after a send has marked comments sent, so the session can be told. */
	onSent?: (sent: ReadonlyArray<ReviewComment>, id: string) => void;
}

/** The state a write answers: the review, narrowed to what the page reads. */
function reviewView(review: { id: string; comments: unknown; reviewed: unknown; sentAt?: number }) {
	return { id: review.id, comments: review.comments, reviewed: review.reviewed, sentAt: review.sentAt };
}

/** One POST's body, or the refusal it owes. */
interface WriteBody {
	token?: unknown;
	rev?: unknown;
	comment?: unknown;
	id?: unknown;
	rel?: unknown;
	reviewed?: unknown;
}

/** The operation a route's body names. */
function opOf(pathname: string, body: WriteBody): WriteOp | { message: string } {
	if (pathname === "/api/comment") {
		const comment = body.comment as Record<string, unknown> | undefined;
		if (comment === undefined || typeof comment !== "object") return { message: "the body names no comment" };
		return {
			kind: "comment",
			rel: typeof comment.rel === "string" ? comment.rel : "",
			line: typeof comment.line === "number" ? comment.line : 0,
			side: comment.side === "old" ? "old" : "new",
			...(typeof comment.quote === "string" ? { quote: comment.quote } : {}),
			body: typeof comment.body === "string" ? comment.body : "",
		};
	}
	if (pathname === "/api/drop") return { kind: "drop", id: typeof body.id === "string" ? body.id : "" };
	if (pathname === "/api/reviewed") {
		return {
			kind: "reviewed",
			rel: typeof body.rel === "string" ? body.rel : "",
			reviewed: body.reviewed === true,
		};
	}
	return { kind: "send" };
}

/** The four routes a write may take. */
const WRITE_ROUTES: ReadonlySet<string> = new Set(["/api/comment", "/api/drop", "/api/reviewed", "/api/send"]);

/**
 * Whether the snapshot draws a line on the side a comment names.
 *
 * The snapshot a write already reads is the only place that knows which lines the page put in
 * front of the reviewer, so this is where an anchor that names no row is refused: the store
 * keeps the shape of a comment, not the diff it was written against.
 */
export function anchorDrawn(
	files: ReviewSnapshot["files"],
	rel: string,
	side: "new" | "old",
	line: number,
): boolean {
	const file = files.find((entry) => entry.rel === rel);
	if (file === undefined) return false;
	return file.lines.some((entry) => (side === "new" ? entry.newNo === line : entry.oldNo === line));
}

/** The work a scope change would discard: comments still in draft, and files marked reviewed. */
export function scopeWork(review: Review): { drafts: number; marks: number } {
	return {
		drafts: review.comments.filter((comment) => comment.state === "draft").length,
		marks: review.reviewed.length,
	};
}

/** The sentence a scope change refuses with, naming only the work it would discard. */
export function scopeRefusal(review: Review, label: string): string {
	const { drafts, marks } = scopeWork(review);
	const has = [
		drafts > 0 ? `${drafts} draft comment${drafts === 1 ? "" : "s"}` : "",
		marks > 0 ? `${marks} file${marks === 1 ? "" : "s"} marked reviewed` : "",
	].filter((part) => part !== "");
	const actions = [drafts > 0 ? "send the drafts" : "", marks > 0 ? "clear the marks" : ""].filter(
		(part) => part !== "",
	);
	// Sent comments are the session's already — the notice and `code_review comments` carry
	// them — so only what a page replacement would destroy is named here, and every action in
	// the sentence is one the reviewer can take from the page.
	const action = actions.join(" and ");
	return `This review has ${has.join(" and ")} on ${label}. ${action.charAt(0).toUpperCase()}${action.slice(1)} before switching scope.`;
}

/** The handler for one mounted review page. */
export function createReviewHandler(deps: ReviewHandlerDeps): LoopbackHandler {
	const { store, current, base } = deps;

	/**
	 * The page's shell for a scope, minting a token when the scope changed. `file` narrows
	 * what is drawn, never what is read: the snapshot is the whole scope, so its fingerprint
	 * — and every write's `rev` — stays the same whether the page shows one file or all.
	 */
	const pageFor = async (scope: ReviewScope, file: string | undefined): Promise<ServeResponse> => {
		const held = store.current();
		if (held !== undefined && held.scope !== scope && held.review !== undefined) {
			const work = scopeWork(held.review);
			if (work.drafts + work.marks > 0) {
				return {
					status: 409,
					headers: pageHeaders(),
					body: renderReviewProblem(base, "This review has work on this scope", scopeRefusal(held.review, held.label)),
				};
			}
		}
		// A page is mounted with a scope, so a same-scope read renders the page it already
		// has — its token, its review, and its comments — rather than minting a second one.
		const page = held !== undefined && held.scope === scope ? held : store.open(scope, "", "");
		if (scope === "base" && page.base === "") {
			page.base = (await current.reader().baseRef()) ?? "";
		}
		const outcome = await current.snapshotOf(page);
		if (outcome.kind === "failed") {
			return {
				status: 200,
				headers: pageHeaders(),
				body: renderReviewProblem(base, "No diff to review", outcome.message),
			};
		}
		const { repo, root } = current.place();
		return {
			status: 200,
			headers: pageHeaders(),
			body: renderReviewPage({
				base,
				repo,
				root,
				token: page.token,
				snapshot: outcome.snapshot,
				...(file === undefined ? {} : { file }),
				...(page.review === undefined ? {} : { review: page.review }),
			}),
		};
	};

	/** A refusal a person reads as a page: the reason, and the way back. */
	const problem = (status: number, title: string, message: string): ServeResponse => ({
		status,
		headers: pageHeaders(),
		body: renderReviewProblem(base, title, message),
	});

	/**
	 * One file's whole text.
	 *
	 * Only a path the snapshot lists is served, so the address cannot name a file this review
	 * does not cover, and only one that resolves inside the root. The view and its way back use
	 * the comparison the page is on, never the one the address asked with: `?scope=` only records
	 * where the link came from, and a stale one must not draw one comparison on another's page.
	 */
	const filePage = async (path: string | null): Promise<ServeResponse> => {
		const page = store.current();
		if (page === undefined) return problem(409, "No review page is open", NO_PAGE);
		const outcome = await current.snapshotOf(page);
		if (outcome.kind === "failed") return problem(409, "No diff to review", outcome.message);
		const rel = path ?? "";
		if (rel === "" || !outcome.snapshot.files.some((entry) => entry.rel === rel)) {
			return problem(404, "That file is not in this review", "Only a file this comparison changes has a text view.");
		}
		const { root } = current.place();
		if (!isInsideReal(root, join(root, rel))) {
			return problem(
				403,
				"That path is outside the reviewed folder",
				"The file resolves outside the checkout this review reads.",
			);
		}
		const text = await current.reader().text(rel);
		if (text.kind === "failed") return problem(404, "That file could not be read", text.message);
		return {
			status: 200,
			headers: pageHeaders(),
			body: renderReviewFile({
				base,
				scope: outcome.snapshot.scope,
				rel,
				lines: text.lines,
				binary: text.binary,
				truncated: text.truncated,
			}),
		};
	};

	/** One write: read the state, compare the snapshot, apply, answer. */
	const write = async (pathname: string, request: LoopbackRequest): Promise<ServeResponse> => {
		if (!WRITE_ROUTES.has(pathname)) return jsonError(404, "That route does not exist.");
		const json = requireJsonBody(request.headers["content-type"]);
		if (json) return json;
		const page = store.current();
		if (page === undefined) return jsonError(409, NO_PAGE);
		const snapshot = await current.snapshotOf(page);
		if (snapshot.kind === "failed") return jsonError(409, snapshot.message);
		// The review records the comparison and its name when it is minted, so the
		// page's own header and a later stale banner read one fact.
		page.base = snapshot.snapshot.base;
		page.label = snapshot.snapshot.label;
		let body: WriteBody;
		try {
			body = JSON.parse(request.body) as WriteBody;
		} catch {
			return jsonError(400, "The request body is not JSON.");
		}
		const op = opOf(pathname, body);
		if ("message" in op) return jsonError(400, op.message);
		const token = typeof body.token === "string" ? body.token : "";
		// The token is read first, so a caller without one learns nothing about the diff; then the
		// anchor, which is the one thing a comment names and the page's rows are the only proof of.
		if (op.kind === "comment" && tokenMatches(page.token, token) && !anchorDrawn(snapshot.snapshot.files, op.rel.trim(), op.side, op.line)) {
			return jsonError(400, "a comment anchors to a line this diff draws");
		}
		const outcome = store.write(
			token,
			typeof body.rev === "string" ? body.rev : "",
			snapshot.snapshot.fingerprint,
			op,
		);
		if (!outcome.ok) return jsonError(outcome.status, outcome.message);
		if (op.kind === "send" && outcome.sent.length > 0) {
			deps.onSent?.(outcome.sent, outcome.id);
		}
		return jsonResponse(200, { id: outcome.id, review: reviewView(outcome.review) });
	};

	return async (request) => {
		const method = request.method.toUpperCase();
		// The envelope the other served pages use: the method allowlist, the fail-closed `Host`
		// rule, and the origin check on a write — whose 405 and `Allow` are the ones this page
		// answered before the two calls became one.
		const refused = envelopeRefusal({ method, headers: request.headers, hosts: LOOPBACK_HOSTS });
		if (refused) return { result: refused };
		const parsed = parseRequestUrl(request.url);
		if (parsed === undefined) return { result: jsonError(400, "Malformed request URL.") };
		const { pathname, search } = parsed;

		if (pathname === CLIENT_JS_PATH) {
			return { result: { status: 200, headers: scriptHeaders(), body: REVIEW_CLIENT_JS } };
		}
		if (pathname === THEME_JS_PATH) {
			return { result: { status: 200, headers: scriptHeaders(), body: THEME_JS } };
		}
		if (pathname.startsWith("/api/")) {
			if (method !== "POST") {
				return {
					result: {
						...jsonError(405, "Use POST to change this review."),
						headers: { ...jsonHeaders(), Allow: "POST" },
					},
				};
			}
			return { result: await write(pathname, request) };
		}
		if (method === "POST") return { result: jsonError(404, "That route does not exist.") };

		const scope = parseScope(search.get("scope")) ?? "base";
		// A focused view is a view: it names a file to draw, and never changes the comparison.
		const file = search.get("file") ?? undefined;
		if (pathname === "/" || pathname === "/new" || pathname === "/new/" || pathname === "/index.html") {
			return { result: await pageFor(scope, file) };
		}
		if (pathname === "/file") return { result: await filePage(search.get("path")) };
		const id = pathname.replace(/^\//, "").replace(/\/$/, "");
		const token = search.get("token") ?? "";
		const held = store.resume(id, token);
		if (held === undefined) return { result: jsonError(403, NO_REVIEW) };
		const outcome = await current.snapshotOf(held);
		if (outcome.kind === "failed") {
			return {
				result: {
					status: 200,
					headers: pageHeaders(),
					body: renderReviewProblem(base, "No diff to review", outcome.message),
				},
			};
		}
		const { repo, root } = current.place();
		return {
			result: {
				status: 200,
				headers: pageHeaders(),
				body: renderReviewPage({
					base,
					repo,
					root,
					token: held.token,
					snapshot: outcome.snapshot,
					...(file === undefined ? {} : { file }),
					...(held.review === undefined ? {} : { review: held.review }),
				}),
			},
		};
	};
}
