/**
 * Browser plan review: a loopback HTTP server plus the session that waits for
 * the user to save or close it.
 *
 * `createPlanWebReview` is the extension-facing seam. `start` binds one server
 * for one plan, opens the default browser at a tokenized URL, and resolves
 * `done` when the user saves feedback, cancels, closes the tab (detected by the
 * event stream dropping), or aborts the turn. The route logic lives in the pure
 * `web-router.ts`; this module is the only part that owns a socket and timers,
 * and it takes injected seams so tests can run one on `127.0.0.1:0`.
 */

import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { basename } from "node:path";
import { openInBrowser } from "../../lib/browser.ts";
import { fenceLanguage, highlightLines } from "../../lib/highlight.ts";
import { codeBody, fenceInfo, planBlocks } from "./blocks.ts";
import {
	MAX_ANNOTATIONS,
	MAX_COMMENT_LENGTH,
	MAX_QUOTE_LENGTH,
	parseFeedback,
	stripFeedback,
	type PlanAnnotation,
} from "./feedback.ts";
import { planTitle, type PlanStore, type StoredPlan } from "./plans.ts";
import { changedSections, type SectionDigest } from "./plan-text.ts";
import { extractPlanSections, extractPlanSteps } from "./steps.ts";
import {
	handleReviewRequest,
	JSON_HEADERS,
	type ReviewContext,
	type ServeResponse,
	type SaveResult,
} from "./web-router.ts";
import type { ReviewPageData } from "./web-page.ts";

/** How a browser review ended. */
export type PlanReviewResult =
	| { status: "saved"; plan: StoredPlan; annotations: PlanAnnotation[] }
	| { status: "approved"; plan: StoredPlan; annotations: PlanAnnotation[] }
	| { status: "cancelled" };

/** A running review the caller awaits and then closes. */
export interface PlanReviewSession {
	/** Tokenized URL to open or print. */
	url: string;
	/** Bound loopback port. */
	port: number;
	/** Resolves once, when the review ends. */
	done: Promise<PlanReviewResult>;
	/** Stop the server. Safe to call more than once. */
	close(): Promise<void>;
}

/** Per-session options for {@link PlanWebReview.start}. */
export interface PlanReviewOptions {
	/** Abort signal; aborting closes the session as cancelled. */
	signal?: AbortSignal;
	/** Whether the browser may approve the plan (only the `exit_plan_mode` flow). */
	canApprove?: boolean;
	/** The section digests the previous review showed, so this page can mark changed sections. */
	baseline?: SectionDigest[];
}

/** Starts and tracks review sessions. */
export interface PlanWebReview {
	start(cwd: string, plan: StoredPlan, options?: PlanReviewOptions): Promise<PlanReviewSession | undefined>;
	/** Stop every running session (session shutdown). */
	closeAll(): Promise<void>;
}

export interface PlanWebReviewDeps {
	/** Override the browser opener (tests). */
	open?: (url: string) => void;
	/** Override the session token (tests). */
	token?: () => string;
	/** Override the bind port; the default `0` lets the OS pick. */
	port?: number;
	/** Override the closed-tab grace; the default leaves a reload time to reconnect. */
	dropGraceMs?: number;
	/** Override the accepted body size; a test keeps it small. */
	maxBodyBytes?: number;
}

/** Largest feedback body accepted, in bytes. */
const MAX_BODY_BYTES = 1024 * 1024;
/** Grace period before an empty client set counts as a closed tab. */
const DROP_GRACE_MS = 1500;

/** A request body, or the fact that it was too large to read. */
type BodyResult = { ok: true; body: string } | { ok: false };

/**
 * Read a request body, stopping at {@link MAX_BODY_BYTES}. An oversize body is
 * reported rather than destroyed here, so the handler can still answer 413 over
 * the open socket instead of the client seeing a dropped connection.
 */
function readBody(request: IncomingMessage, limit: number): Promise<BodyResult> {
	return new Promise((resolve) => {
		const chunks: Buffer[] = [];
		let size = 0;
		let done = false;
		const settle = (result: BodyResult): void => {
			if (done) return;
			done = true;
			resolve(result);
		};
		request.on("data", (chunk: Buffer) => {
			if (done) return;
			size += chunk.length;
			if (size > limit) {
				chunks.length = 0;
				request.pause();
				settle({ ok: false });
				return;
			}
			chunks.push(chunk);
		});
		request.on("end", () => settle({ ok: true, body: Buffer.concat(chunks).toString("utf-8") }));
		request.on("error", () => settle({ ok: false }));
	});
}

async function listen(server: Server, port: number): Promise<number> {
	await new Promise<void>((resolve, reject) => {
		const onError = (error: Error) => reject(error);
		server.once("error", onError);
		server.listen(port, "127.0.0.1", () => {
			server.off("error", onError);
			resolve();
		});
	});
	const address = server.address();
	return typeof address === "object" && address ? address.port : port;
}

export function createPlanWebReview(store: PlanStore, deps: PlanWebReviewDeps = {}): PlanWebReview {
	const sessions = new Set<PlanReviewSession>();
	// Last bound port per plan path, so the same plan keeps one origin across
	// review turns (and its saved browser theme with it).
	const ports = new Map<string, number>();

	const start = async (
		cwd: string,
		plan: StoredPlan,
		options: PlanReviewOptions = {},
	): Promise<PlanReviewSession | undefined> => {
		const { signal } = options;
		const canApprove = options.canApprove === true;
		const maxBody = deps.maxBodyBytes ?? MAX_BODY_BYTES;
		const token = (deps.token ?? (() => randomBytes(16).toString("hex")))();
		let settled = false;
		let resolveDone!: (result: PlanReviewResult) => void;
		const done = new Promise<PlanReviewResult>((resolve) => {
			resolveDone = resolve;
		});
		let dropTimer: NodeJS.Timeout | undefined;
		const finish = (result: PlanReviewResult): void => {
			if (settled) return;
			settled = true;
			clearTimeout(dropTimer);
			dropTimer = undefined;
			resolveDone(result);
		};

		// The stripped plan the page last rendered; a save must anchor against a file
		// that still matches it, or the comments land beside the wrong text.
		let pageText = stripFeedback(plan.content);
		let savedPlan: StoredPlan | undefined;
		// Set by `onSaved`/`onCancel`; resolved once the HTTP response has flushed,
		// so the caller cannot close the socket before the browser sees the reply.
		let pendingResult: PlanReviewResult | undefined;

		/**
		 * Re-read the plan into `pageText` and return it. Named apart from the page
		 * build because it writes the state a later save validates against, so a `GET`
		 * does not hide that write inside what looks like a read.
		 */
		const refreshPageText = async (): Promise<StoredPlan> => {
			const current = (await store.read(cwd, plan.path)) ?? plan;
			pageText = stripFeedback(current.content);
			return current;
		};

		const page = async (): Promise<ReviewPageData> => {
			const stored = await refreshPageText();
			const current = pageText;
			const blocks = planBlocks(current);
			const sections = extractPlanSections(current);
			// Per-occurrence change flags, aligned with the sections list: the same shape
			// the terminal review renders, so duplicate headings cannot both light up.
			const changed = changedSections(options.baseline, current);
			const outline = sections.flatMap((section, index) =>
				section.title === ""
					? []
					: [
							{
								id: `s-${section.line}`,
								line: section.line,
								level: section.level,
								text: section.title,
								...(changed[index] ? { changed: true } : {}),
							},
						],
			);
			// The same step list approval seeds and set_plan_steps indexes, so the page's
			// progress cannot disagree with the todo list.
			const stepList = extractPlanSteps(current);
			// Highlight code blocks once, at the boundary: the client copies only the
			// tok-* spans out of the server-escaped HTML.
			const code: Record<string, string[]> = {};
			for (const block of blocks) {
				if (block.kind !== "code") continue;
				const language = fenceLanguage(fenceInfo(block.lines[0] ?? ""));
				if (language) code[String(block.start)] = highlightLines(codeBody(block), language);
			}
			return {
				// The document's own H1 reads better than the file-name slug, and the
				// slug is still the fallback for a plan that starts with something else.
				title: sections.find((section) => section.level === 1)?.title || planTitle(basename(plan.path)),
				blocks,
				annotations: parseFeedback(stored.content),
				outline,
				steps: {
					done: stepList.filter((step) => step.status === "completed").length,
					total: stepList.length,
				},
				code,
				limits: { comments: MAX_ANNOTATIONS, comment: MAX_COMMENT_LENGTH, quote: MAX_QUOTE_LENGTH },
				token,
				canApprove,
			};
		};

		const save = async (annotations: PlanAnnotation[]): Promise<SaveResult> => {
			const current = await store.read(cwd, plan.path);
			if (!current) return { ok: false, status: 404, message: "The plan file is gone." };
			if (stripFeedback(current.content) !== pageText) {
				return { ok: false, status: 409, message: "The plan changed on disk; reload the page and review again." };
			}
			try {
				savedPlan = await store.saveFeedback(cwd, plan.path, annotations);
				return { ok: true };
			} catch (error) {
				return { ok: false, status: 500, message: error instanceof Error ? error.message : String(error) };
			}
		};

		const context: ReviewContext = {
			token,
			canApprove,
			page,
			save,
			onSaved: (annotations) => {
				pendingResult = savedPlan ? { status: "saved", plan: savedPlan, annotations } : { status: "cancelled" };
			},
			onApprove: (annotations) => {
				pendingResult = savedPlan ? { status: "approved", plan: savedPlan, annotations } : { status: "cancelled" };
			},
			onCancel: () => {
				pendingResult = { status: "cancelled" };
			},
		};

		// Live event streams, used only to notice a closed tab. The explicit Cancel
		// button and the abort signal are the deterministic paths.
		const clients = new Set<ServerResponse>();
		let hadClient = false;
		const dropGrace = deps.dropGraceMs ?? DROP_GRACE_MS;
		const scheduleDrop = (): void => {
			if (clients.size > 0 || !hadClient || settled || dropTimer) return;
			dropTimer = setTimeout(() => {
				dropTimer = undefined;
				if (clients.size === 0) finish({ status: "cancelled" });
			}, dropGrace);
			(dropTimer as { unref?: () => void }).unref?.();
		};

		const server = createServer((request, response) => {
			void (async () => {
				const method = request.method ?? "GET";
				const read =
					method.toUpperCase() === "POST" ? await readBody(request, maxBody) : { ok: true as const, body: "" };
				if (!read.ok) {
					response.writeHead(413, { ...JSON_HEADERS, Connection: "close" });
					response.end(JSON.stringify({ error: "The request body is too large." }));
					return;
				}
				const body = read.body;
				let result: ServeResponse;
				try {
					result = await handleReviewRequest(context, method, request.url ?? "/", request.headers, body);
				} catch {
					result = {
						status: 500,
						headers: { ...JSON_HEADERS },
						body: JSON.stringify({ error: "Internal error" }),
					};
				}
				if (result.stream) {
					response.writeHead(result.status, result.headers);
					response.write("retry: 2000\n\n");
					hadClient = true;
					clients.add(response);
					if (dropTimer) {
						clearTimeout(dropTimer);
						dropTimer = undefined;
					}
					request.on("close", () => {
						clients.delete(response);
						scheduleDrop();
					});
					return;
				}
				response.writeHead(result.status, result.headers);
				if (method.toUpperCase() === "HEAD") {
					response.end();
					return;
				}
				// A save or cancel only resolves the session after its response is on the
				// wire; otherwise `close()` would force-close the socket mid-reply. The
				// `close` path covers a client that walks away before the flush callback
				// runs, so a settle cannot be lost with the socket.
				const settlePending = (): void => {
					const terminal = pendingResult;
					if (!terminal) return;
					pendingResult = undefined;
					finish(terminal);
				};
				response.end(result.body ?? "", settlePending);
				response.on("close", settlePending);
			})();
		});

		// An accept-level error (EMFILE and friends) is emitted on the server, and an
		// `error` event with no listener would take the host down mid-review. The
		// review still ends through its own paths: cancel, abort, drop, or shutdown.
		server.on("error", () => {});

		const preferred = deps.port ?? ports.get(plan.path) ?? 0;
		let port: number | undefined;
		try {
			port = await listen(server, preferred);
		} catch {
			// The remembered port may have been taken between turns; fall back once.
			if (preferred !== 0) {
				try {
					port = await listen(server, 0);
				} catch {
					port = undefined;
				}
			}
		}
		if (port === undefined) {
			server.close();
			return undefined;
		}
		ports.set(plan.path, port);

		const url = `http://127.0.0.1:${port}/?token=${token}`;
		let closed = false;
		let abortHandler: (() => void) | undefined;
		const close = async (): Promise<void> => {
			if (closed) return;
			closed = true;
			if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
			sessions.delete(session);
			for (const client of clients) client.end();
			clients.clear();
			finish({ status: "cancelled" });
			await new Promise<void>((resolve) => {
				server.close(() => resolve());
				(server as { closeAllConnections?: () => void }).closeAllConnections?.();
			});
		};

		const session: PlanReviewSession = { url, port, done, close };
		sessions.add(session);

		if (signal) {
			abortHandler = (): void => void close();
			if (signal.aborted) void close();
			else signal.addEventListener("abort", abortHandler, { once: true });
		}

		(deps.open ?? openInBrowser)(url);
		return session;
	};

	return {
		start,
		closeAll: async () => {
			await Promise.all([...sessions].map((session) => session.close()));
		},
	};
}
