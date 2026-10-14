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
import { codeBody, fenceInfo, planBlocks, planHeadings } from "./blocks.ts";
import { parseFeedback, stripFeedback, type PlanAnnotation } from "./feedback.ts";
import { planTitle, type PlanStore, type StoredPlan } from "./plans.ts";
import { extractPlanSteps } from "./steps.ts";
import { handleReviewRequest, type ReviewContext, type ServeResponse, type SaveResult } from "./web-router.ts";
import type { ReviewPageData } from "./web-page.ts";

/** How a browser review ended. */
export type PlanReviewResult =
	| { status: "saved"; plan: StoredPlan; annotations: PlanAnnotation[] }
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

/** Starts and tracks review sessions. */
export interface PlanWebReview {
	start(cwd: string, plan: StoredPlan, signal?: AbortSignal): Promise<PlanReviewSession | undefined>;
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
}

/** Largest feedback body accepted, in bytes. */
const MAX_BODY_BYTES = 1024 * 1024;
/** Grace period before an empty client set counts as a closed tab. */
const DROP_GRACE_MS = 1500;

function readBody(request: IncomingMessage): Promise<string | undefined> {
	return new Promise((resolve) => {
		const chunks: Buffer[] = [];
		let size = 0;
		request.on("data", (chunk: Buffer) => {
			size += chunk.length;
			if (size > MAX_BODY_BYTES) {
				resolve(undefined);
				request.destroy();
				return;
			}
			chunks.push(chunk);
		});
		request.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
		request.on("error", () => resolve(undefined));
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

	const start = async (cwd: string, plan: StoredPlan, signal?: AbortSignal): Promise<PlanReviewSession | undefined> => {
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
		let baseline = stripFeedback(plan.content);
		let savedPlan: StoredPlan | undefined;

		const page = async (): Promise<ReviewPageData> => {
			const current = (await store.read(cwd, plan.path)) ?? plan;
			baseline = stripFeedback(current.content);
			const blocks = planBlocks(baseline);
			const steps = extractPlanSteps(baseline);
			// Highlight code blocks once, at the boundary: the client copies only the
			// tok-* spans out of the server-escaped HTML.
			const code: Record<string, string[]> = {};
			for (const block of blocks) {
				if (block.kind !== "code") continue;
				const language = fenceLanguage(fenceInfo(block.lines[0] ?? ""));
				if (language) code[String(block.start)] = highlightLines(codeBody(block), language);
			}
			return {
				title: planTitle(basename(current.path)),
				relativePath: current.relativePath,
				blocks,
				annotations: parseFeedback(current.content),
				steps: { done: steps.filter((step) => step.status === "completed").length, total: steps.length },
				outline: planHeadings(blocks).map((heading) => ({
					id: `s-${heading.line}`,
					line: heading.line,
					level: heading.level,
					text: heading.text,
				})),
				code,
				token,
			};
		};

		const save = async (annotations: PlanAnnotation[]): Promise<SaveResult> => {
			const current = await store.read(cwd, plan.path);
			if (!current) return { ok: false, status: 404, message: "The plan file is gone." };
			if (stripFeedback(current.content) !== baseline) {
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
			page,
			save,
			onSaved: (annotations) => {
				if (savedPlan) finish({ status: "saved", plan: savedPlan, annotations });
				else finish({ status: "cancelled" });
			},
			onCancel: () => finish({ status: "cancelled" }),
		};

		// Live event streams, used only to notice a closed tab. The explicit Cancel
		// button and the abort signal are the deterministic paths.
		const clients = new Set<ServerResponse>();
		let hadClient = false;
		const scheduleDrop = (): void => {
			if (clients.size > 0 || !hadClient || settled || dropTimer) return;
			dropTimer = setTimeout(() => {
				dropTimer = undefined;
				if (clients.size === 0) finish({ status: "cancelled" });
			}, DROP_GRACE_MS);
			(dropTimer as { unref?: () => void }).unref?.();
		};

		const server = createServer((request, response) => {
			void (async () => {
				const method = request.method ?? "GET";
				const body = method.toUpperCase() === "POST" ? await readBody(request) : "";
				if (body === undefined) {
					response.writeHead(413, { "Content-Type": "application/json" });
					response.end(JSON.stringify({ error: "The request body is too large." }));
					return;
				}
				let result: ServeResponse;
				try {
					result = await handleReviewRequest(context, method, request.url ?? "/", request.headers, body);
				} catch {
					result = {
						status: 500,
						headers: { "Content-Type": "application/json" },
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
				response.end(result.body ?? "");
			})();
		});

		let port: number;
		try {
			port = await listen(server, deps.port ?? 0);
		} catch {
			server.close();
			return undefined;
		}

		const url = `http://127.0.0.1:${port}/?token=${token}`;
		let closed = false;
		const close = async (): Promise<void> => {
			if (closed) return;
			closed = true;
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
			const onAbort = (): void => void close();
			if (signal.aborted) void close();
			else signal.addEventListener("abort", onAbort, { once: true });
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
