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
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { networkInterfaces } from "node:os";
import { basename } from "node:path";
import { openInBrowser } from "../../lib/browser.ts";
import {
	bindLoopback,
	createCloser,
	jsonHeaders,
	openEventStream,
	parseRequestUrl,
	respond,
	type ServeResponse,
} from "../../lib/http/index.ts";
import { fenceLanguage, highlightLines } from "../../lib/highlight.ts";
import { type ArmTimer, defaultTimer } from "../../lib/timer.ts";
import { codeBody, fenceInfo, planBlocks } from "./blocks.ts";
import {
	MAX_ANNOTATIONS,
	MAX_COMMENT_LENGTH,
	MAX_QUOTE_LENGTH,
	normalizeAuthor,
	parseFeedback,
	stripFeedback,
	type PlanAnnotation,
} from "./feedback.ts";
import { planTitle, type PlanStore, type StoredPlan } from "./plans.ts";
import { changedSections, type SectionDigest } from "./plan-text.ts";
import { extractPlanSections, extractPlanSteps } from "./steps.ts";
import type { ReviewFrame, ReviewRole } from "./types.ts";
import { handleReviewRequest, type ReviewContext, type SaveResult } from "./web-router.ts";
import type { ReviewPageData } from "./web-page.ts";
import { createShareSession, type ShareSession } from "./web-share-session.ts";
import type { NetworkInterfaces, ShareResult, ShareState } from "./web-share.ts";

/** How a browser review ended. */
export type PlanReviewResult =
	| { status: "saved"; plan: StoredPlan; annotations: PlanAnnotation[] }
	| { status: "approved"; plan: StoredPlan; annotations: PlanAnnotation[] }
	| { status: "cancelled" };

/** A running review the caller awaits and then closes. */
export interface PlanReviewSession {
	/** Tokenized URL to open or print; the owner's own page. */
	url: string;
	/** Bound loopback port. */
	port: number;
	/** Resolves once, when the review ends. */
	done: Promise<PlanReviewResult>;
	/** Stop the server(s). Safe to call more than once. */
	close(): Promise<void>;
}

/** Per-session options for {@link PlanWebReview.start}. */
export interface PlanReviewOptions {
	/** Abort signal; aborting closes the session as cancelled. */
	signal?: AbortSignal;
	/** Whether the browser may approve the plan (only the `exit_plan_mode` flow). */
	canApprove?: boolean;
	/** A line the page shows the owner, such as why approval belongs in the terminal. */
	note?: string;
	/** The section digests the previous review showed, so this page can mark changed sections. */
	baseline?: SectionDigest[];
}

/** Starts and tracks review sessions. */
export interface PlanWebReview {
	start(cwd: string, plan: StoredPlan, options?: PlanReviewOptions): Promise<PlanReviewSession | undefined>;
	/** The session currently serving a review, if any. */
	current(): PlanReviewSession | undefined;
	/** Start (or re-read) the share link for the running review, if one is open. */
	share(): Promise<ShareResult | undefined>;
	/** Revoke every reviewer token and stop accepting reviewers. */
	stopSharing(): Promise<ShareResult | undefined>;
	/** The running review's share state, without changing it. */
	shareState(): ShareState | undefined;
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
	/**
	 * Override the timer that arms the closed-tab grace.
	 *
	 * The grace is a race against the browser's reload, so a test drives it by
	 * hand: a few tens of milliseconds of deadline makes the test fail when the
	 * machine is busy, which is a fact about the runner and not about the code.
	 */
	schedule?: ArmTimer;
	/** Override the accepted body size; a test keeps it small. */
	maxBodyBytes?: number;
	/** Override the machine's network interfaces (tests), never read live in a test. */
	networkInterfaces?: () => NetworkInterfaces;
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

export function createPlanWebReview(store: PlanStore, deps: PlanWebReviewDeps = {}): PlanWebReview {
	const sessions = new Set<PlanReviewSession>();
	// What each running review can do about sharing; the session itself stays the
	// four things a caller awaits and closes.
	const shares = new Map<PlanReviewSession, ShareSession>();
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
		// One token per holder: the owner's is minted here and never shared, and a
		// reviewer token is minted by `share()`. The role travels with the token.
		const tokens = new Map<string, ReviewRole>();
		const mint = (role: ReviewRole): string => {
			const next = deps.token ?? (() => randomBytes(16).toString("hex"));
			// A role is keyed by its token, so two roles may never share one: a
			// generator that repeats would otherwise let a reviewer token displace the
			// owner's and hand a reviewer the approval route.
			let value = next();
			for (let attempt = 0; tokens.has(value) && attempt < 8; attempt++) value = next();
			if (tokens.has(value)) value = `${value}-${tokens.size}`;
			tokens.set(value, role);
			return value;
		};
		const token = mint("owner");
		// The owner's bound port, so a shared listener can reuse it for the same URL shape.
		let currentPort = 0;
		let settled = false;
		let resolveDone!: (result: PlanReviewResult) => void;
		const done = new Promise<PlanReviewResult>((resolve) => {
			resolveDone = resolve;
		});
		let cancelDrop: (() => void) | undefined;
		const clearDrop = (): void => {
			cancelDrop?.();
			cancelDrop = undefined;
		};
		const finish = (result: PlanReviewResult): void => {
			if (settled) return;
			settled = true;
			clearDrop();
			// A page still open has no decision to make, so it is told why it stops
			// updating, and its stream is ended with that frame rather than after it.
			endStreams("closed");
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
			const next = stripFeedback(current.content);
			// Someone saved the plan outside this page: the readers must see the new
			// body, and the next save must anchor against it rather than 409.
			if (next !== pageText) notifyPlanChange();
			pageText = next;
			return current;
		};
		// Set below, once the stream set exists; a page load before that has no
		// reader to notify and nothing to notify it about.
		let notifyPlanChange: () => void = () => {};

		/**
		 * Tell the open pages something changed. The frame carries only a kind: the
		 * page re-reads the island, so there is one update path and no second copy of
		 * the review state travelling over the stream. A role narrows the listener
		 * (revocation is the reviewers' news, not the owner's), and a socket already
		 * in teardown is skipped rather than written to.
		 */
		const broadcast = (kind: ReviewFrame, only?: ReviewRole): void => {
			for (const [client, role] of clients) {
				if (only !== undefined && role !== only) continue;
				if (client.writableEnded || client.destroyed) continue;
				client.write(`data: ${kind}\n\n`);
			}
		};
		notifyPlanChange = () => broadcast("plan");

		/**
		 * Send one last frame and end the stream with it, so the page reads the reason
		 * before the socket goes away instead of falling back to "Offline".
		 */
		const endStreams = (kind: ReviewFrame, only?: ReviewRole): void => {
			for (const [client, role] of clients) {
				if (only !== undefined && role !== only) continue;
				if (client.writableEnded || client.destroyed) continue;
				client.end(`data: ${kind}\n\n`);
			}
		};

		const page = async (role: ReviewRole): Promise<ReviewPageData> => {
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
				role,
				canApprove: role === "owner" && canApprove,
				...(role === "owner" && options.note !== undefined ? { note: options.note } : {}),
				share: role === "owner" ? shareSession.state() : undefined,
			};
		};

		/**
		 * The owner's save decides the review; a reviewer's post only writes.
		 * Both replace the comments of the writers they carry — the owner's are
		 * untagged, a reviewer's are tagged with the name that browser chose — so
		 * neither touches another writer's markers, and both refuse a plan that
		 * changed since the page was rendered.
		 */
		const save = async (annotations: PlanAnnotation[], role: ReviewRole): Promise<SaveResult> => {
			const current = await store.read(cwd, plan.path);
			if (!current) return { ok: false, status: 404, message: "The plan file is gone." };
			if (stripFeedback(current.content) !== pageText) {
				return { ok: false, status: 409, message: "The plan changed on disk; reload the page and review again." };
			}
			try {
				if (role === "owner") {
					savedPlan = await store.saveFeedback(cwd, plan.path, annotations);
					broadcast("comment");
					return { ok: true };
				}
				// The page sends every comment it shows, so a reviewer's post is grouped by
				// name and each name replaces only its own markers. An untagged entry is
				// somebody else's comment echoed back, never re-signed.
				const groups = new Map<string, PlanAnnotation[]>();
				let signed = 0;
				for (const annotation of annotations) {
					const author = normalizeAuthor(annotation.author);
					if (!author) continue;
					signed += 1;
					groups.set(author, [...(groups.get(author) ?? []), annotation]);
				}
				// Nothing signed at all means the reviewer has not chosen a name yet.
				if (annotations.length > 0 && signed === 0) {
					return { ok: false, status: 400, message: "Choose a display name before commenting." };
				}
				// The saved plan is deliberately not recorded here: a post is not a result
				// the session can return, so there is nothing for a later flush to resolve.
				for (const [author, group] of groups) {
					await store.saveFeedback(cwd, plan.path, group, { author });
				}
				if (groups.size > 0) broadcast("comment");
				return { ok: true };
			} catch (error) {
				return { ok: false, status: 500, message: error instanceof Error ? error.message : String(error) };
			}
		};

		// The second listener, its reviewer token, and the state the page and
		// `/plan share` read. It is handed the request handler, the role map, and the
		// frame hooks, so sharing stays one concern instead of five fields here.
		const shareSession = createShareSession({
			handleRequest,
			ownerPort: () => currentPort,
			networkInterfaces: deps.networkInterfaces ?? networkInterfaces,
			mintReviewer: () => mint("reviewer"),
			revokeReviewer: (value) => tokens.delete(value),
			broadcast,
			endReviewerStreams: (kind) => endStreams(kind, "reviewer"),
		});
		const hosts = (): readonly string[] => shareSession.hosts();

		const context: ReviewContext = {
			roleOf: (value) => tokens.get(value),
			hosts,
			canApprove,
			page,
			save,
			share: () => shareSession.share(),
			stopShare: () => shareSession.stop(),
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

		// Live event streams, used only to notice a closed owner tab: a reviewer's
		// tab is not the review's lifetime. The explicit Cancel button and the abort
		// signal are the deterministic paths.
		const clients = new Map<ServerResponse, ReviewRole>();
		let hadOwner = false;
		const ownerStreams = (): number => {
			let open = 0;
			for (const role of clients.values()) if (role === "owner") open += 1;
			return open;
		};
		const dropGrace = deps.dropGraceMs ?? DROP_GRACE_MS;
		const schedule = deps.schedule ?? defaultTimer;
		const scheduleDrop = (): void => {
			if (ownerStreams() > 0 || !hadOwner || settled || cancelDrop) return;
			cancelDrop = schedule(dropGrace, () => {
				cancelDrop = undefined;
				if (ownerStreams() === 0) finish({ status: "cancelled" });
			});
		};

		const server = createServer(handleRequest);
		/** One request, on either listener: the loopback page or a shared one. */
		function handleRequest(request: IncomingMessage, response: ServerResponse): void {
			void (async () => {
				const method = request.method ?? "GET";
				const read =
					method.toUpperCase() === "POST" ? await readBody(request, maxBody) : { ok: true as const, body: "" };
				if (!read.ok) {
					response.writeHead(413, { ...jsonHeaders(), Connection: "close" });
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
						headers: jsonHeaders(),
						body: JSON.stringify({ error: "Internal error" }),
					};
				}
				if (result.stream) {
					openEventStream(response, result);
					// A page that walks away mid-frame must not take the session down.
					response.on("error", () => {});
					const token = parseRequestUrl(request.url ?? "/")?.search.get("token") ?? "";
					const streamRole = context.roleOf(token);
					if (streamRole !== undefined) clients.set(response, streamRole);
					if (streamRole === "owner") {
						hadOwner = true;
						clearDrop();
					}
					request.on("close", () => {
						clients.delete(response);
						if (streamRole === "owner" && ownerStreams() === 0) scheduleDrop();
					});
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
				respond(request, response, result, settlePending);
				response.on("close", settlePending);
			})();
		}

		// The accept-level `error` listener lives in `bindHost`, so a transient
		// failure cannot take the host down; the review still ends through its own
		// paths: cancel, abort, drop, or shutdown.
		const preferred = deps.port ?? ports.get(plan.path) ?? 0;
		let port: number | undefined;
		try {
			port = await bindLoopback(server, preferred);
		} catch {
			// The remembered port may have been taken between turns; fall back once.
			if (preferred !== 0) {
				try {
					port = await bindLoopback(server, 0);
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
		currentPort = port;
		const closeServer = createCloser(server);

		const url = `http://127.0.0.1:${port}/?token=${token}`;
		let closed = false;
		let abortHandler: (() => void) | undefined;
		const close = async (): Promise<void> => {
			if (closed) return;
			closed = true;
			if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
			sessions.delete(session);
			shares.delete(session);
			// `finish` ends every open stream with its last frame, so it runs before
			// the set is cleared rather than after it.
			finish({ status: "cancelled" });
			clients.clear();
			await shareSession.close();
			await closeServer();
		};

		const session: PlanReviewSession = { url, port, done, close };
		sessions.add(session);
		shares.set(session, shareSession);

		if (signal) {
			abortHandler = (): void => void close();
			if (signal.aborted) void close();
			else signal.addEventListener("abort", abortHandler, { once: true });
		}

		(deps.open ?? openInBrowser)(url);
		return session;
	};

	const current = (): PlanReviewSession | undefined => [...sessions].at(-1);
	const controls = () => {
		const session = current();
		return session ? shares.get(session) : undefined;
	};

	return {
		start,
		current,
		share: async () => controls()?.share(),
		stopSharing: async () => controls()?.stop(),
		shareState: () => controls()?.state(),
		closeAll: async () => {
			await Promise.all([...sessions].map((session) => session.close()));
		},
	};
}
