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

import {
	checkOrigin,
	isLocalHostHeader,
	jsonError,
	jsonHeaders,
	jsonResponse,
	pageHeaders,
	parseRequestUrl,
	postOnly,
	requireJsonBody,
	scriptHeaders,
	type LoopbackHandler,
	type LoopbackRequest,
	type ServeResponse,
} from "../../../lib/http/index.ts";
import { THEME_JS, THEME_JS_PATH } from "../../../lib/web/index.ts";
import type { ReviewReader, ReviewSnapshot } from "../git/diff.ts";
import {
	type Review,
	type ReviewComment,
	type ReviewPageState,
	type ReviewStore,
	type WriteOp,
} from "../review/store.ts";
import { parseScope, type ReviewScope } from "../scope.ts";
import { REVIEW_CLIENT_JS } from "../view/client.ts";
import { renderReviewPage, renderReviewProblem } from "../view/page.ts";

/** The page's script, beside the shared theme. */
export const CLIENT_JS_PATH = "/client.js";

/** The page's refusal when a scope names no review to show. */
const NO_REVIEW = "that review is not open on this session — run /review";

/** What the router needs of the session it serves. */
export interface ReviewHandlerDeps {
	store: ReviewStore;
	reader: ReviewReader;
	/** The mount prefix, `/review`. */
	base: string;
	/** The repository's name. */
	repo: string;
	/** The repository's path, for the header's hover. */
	root: string;
	/** The configured base ref. */
	baseRef: string;
	/** Called after a send has marked comments sent, so the session can be told. */
	onSent?: (sent: ReadonlyArray<ReviewComment>, id: string) => void;
}

/** The snapshot an open page renders, or the sentence the page prints instead. */
async function currentSnapshot(
	reader: ReviewReader,
	page: ReviewPageState,
): Promise<{ kind: "snapshot"; snapshot: ReviewSnapshot } | { kind: "failed"; message: string }> {
	return reader.snapshot(page.scope, page.base);
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
	const { store, reader, base } = deps;

	/** The page's shell for a scope, minting a token when the scope changed. */
	const pageFor = async (scope: ReviewScope): Promise<ServeResponse> => {
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
			page.base = (await reader.baseRef()) ?? "";
		}
		const outcome = await currentSnapshot(reader, page);
		if (outcome.kind === "failed") {
			return {
				status: 200,
				headers: pageHeaders(),
				body: renderReviewProblem(base, "No diff to review", outcome.message),
			};
		}
		return {
			status: 200,
			headers: pageHeaders(),
			body: renderReviewPage({
				base,
				repo: deps.repo,
				root: deps.root,
				token: page.token,
				snapshot: outcome.snapshot,
				...(page.review === undefined ? {} : { review: page.review }),
			}),
		};
	};

	/** One write: read the state, compare the snapshot, apply, answer. */
	const write = async (pathname: string, request: LoopbackRequest): Promise<ServeResponse> => {
		if (!WRITE_ROUTES.has(pathname)) return jsonError(404, "That route does not exist.");
		const methodRefusal = postOnly(request.method, "change this review");
		if (methodRefusal) return methodRefusal;
		const origin = checkOrigin(request.headers);
		if (origin) return origin;
		const json = requireJsonBody(request.headers["content-type"]);
		if (json) return json;
		const page = store.current();
		if (page === undefined) return jsonError(409, "this session has no review page open — run /review first");
		const snapshot = await currentSnapshot(reader, page);
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
		const outcome = store.write(
			typeof body.token === "string" ? body.token : "",
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
		if (method !== "GET" && method !== "HEAD" && method !== "POST") {
			return {
				result: {
					...jsonError(405, "Only GET, HEAD, and POST are served."),
					headers: { ...jsonHeaders(), Allow: "GET, HEAD, POST" },
				},
			};
		}
		if (!isLocalHostHeader(request.headers, { required: true })) {
			return { result: jsonError(403, "Unexpected Host header.") };
		}
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
		if (pathname === "/" || pathname === "/new" || pathname === "/new/" || pathname === "/index.html") {
			return { result: await pageFor(scope) };
		}
		const id = pathname.replace(/^\//, "").replace(/\/$/, "");
		const token = search.get("token") ?? "";
		const held = store.resume(id, token);
		if (held === undefined) return { result: jsonError(403, NO_REVIEW) };
		const outcome = await currentSnapshot(reader, held);
		if (outcome.kind === "failed") {
			return {
				result: {
					status: 200,
					headers: pageHeaders(),
					body: renderReviewProblem(base, "No diff to review", outcome.message),
				},
			};
		}
		return {
			result: {
				status: 200,
				headers: pageHeaders(),
				body: renderReviewPage({
					base,
					repo: deps.repo,
					root: deps.root,
					token: held.token,
					snapshot: outcome.snapshot,
					...(held.review === undefined ? {} : { review: held.review }),
				}),
			},
		};
	};
}
