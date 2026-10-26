/**
 * Browser plan review: a loopback HTTP server plus the session that waits for
 * the user to save or close it.
 *
 * `createPlanWebReview` is the extension-facing seam. `start` binds one server
 * for one plan, opens the default browser at a tokenized URL, and resolves
 * `done` when the user saves feedback, cancels, closes the tab (detected by the
 * event stream dropping), or aborts the turn. The route logic lives in the pure
 * `web-router.ts`; this module owns the routes and the timers, `lib/http` owns
 * the socket, and it takes injected seams so tests can run one on `127.0.0.1:0`.
 */

import { networkInterfaces } from "node:os";
import { openInBrowser } from "../../lib/browser.ts";
import {
	jsonHeaders,
	type LoopbackRequest,
	type LoopbackReply,
	type LoopbackServer,
	parseRequestUrl,
	serveLoopback,
	type ServeResponse,
} from "../../lib/http/index.ts";
import { type ArmTimer, defaultInterval, defaultTimer, type RepeatTimer } from "../../lib/timer.ts";
import { stripFeedback, type PlanAnnotation } from "./feedback.ts";
import type { PlanStore, StoredPlan } from "./plans.ts";
import type { SectionDigest } from "./plan-text.ts";
import type { ReviewCaller } from "./types.ts";
import { handleReviewRequest, type ReviewContext, type SaveResult } from "./web-router.ts";
import { reviewPageData, type ReviewPageData } from "./web-payload.ts";
import { postReviewerAnnotations, saveOwnerAnnotations } from "./web-write.ts";
import { createShareSession, type ShareSession } from "./web-share-session.ts";
import { createStreams } from "./web-streams.ts";
import { createTokens } from "./web-tokens.ts";
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
	/** The section digests the previous review showed, so this page can mark changed sections. */
	baseline?: SectionDigest[];
	/**
	 * Called when a shared reviewer's post lands, so the owner's terminal can say so:
	 * an open page updates itself, and whoever is waiting in the TUI is told nothing
	 * until this fires.
	 */
	onReviewerComment?: (author: string, count: number) => void;
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
	/**
	 * Override the repeating timer that polls the plan file.
	 *
	 * A poll is a race against an edit made elsewhere, so a test drives it by hand
	 * rather than waiting for a tick that makes a busy machine fail.
	 */
	tick?: RepeatTimer;
	/** How often to check the plan file for an edit this review did not make. */
	pollMs?: number;
	/** Override the machine's network interfaces (tests), never read live in a test. */
	networkInterfaces?: () => NetworkInterfaces;
}

/** Largest feedback body accepted, in bytes. */
const MAX_BODY_BYTES = 1024 * 1024;
/** Grace period before an empty client set counts as a closed tab. */
const DROP_GRACE_MS = 1500;
/**
 * How often a running review checks the plan file.
 *
 * One stat and one read of a small markdown file, only while a page is open: a
 * second is fast enough that an edit under an open page reaches it while the
 * reader is still looking, and slow enough to be free.
 */
const PLAN_POLL_MS = 1000;

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
		// One cap for both listeners: a reviewer's page posts the same bodies as the
		// owner's, so the shared one cannot be the stricter or the looser of the two.
		const bodyLimit = deps.maxBodyBytes ?? MAX_BODY_BYTES;
		// One token per holder: the owner's is minted here and never shared, and a
		// reviewer token is minted by `share()`. The table owns the collision rule and
		// the name each link has bound.
		const tokens = createTokens(deps.token);
		const token = tokens.mint("owner");
		// The owner's bound port, so a shared listener can reuse it for the same URL shape.
		let currentPort = 0;
		let settled = false;
		let resolveDone!: (result: PlanReviewResult) => void;
		const done = new Promise<PlanReviewResult>((resolve) => {
			resolveDone = resolve;
		});
		// Live event streams, used only to notice a closed owner tab: a reviewer's
		// tab is not the review's lifetime. The explicit Cancel button and the abort
		// signal are the deterministic paths.
		const streams = createStreams({
			onAbandoned: () => finish({ status: "cancelled" }),
			graceMs: deps.dropGraceMs ?? DROP_GRACE_MS,
			schedule: deps.schedule ?? defaultTimer,
			settled: () => settled,
		});

		let stopTicker: () => void = () => {};
		const finish = (result: PlanReviewResult): void => {
			if (settled) return;
			settled = true;
			streams.cancelDrop();
			stopTicker();
			// A page still open has no decision to make, so it is told why it stops
			// updating, and its stream is ended with that frame rather than after it.
			streams.end("closed");
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
		notifyPlanChange = () => streams.broadcast("plan");

		/**
		 * Notice a plan file this review did not write.
		 *
		 * A review owns the page, not the file: `/plan review` runs in normal mode, and
		 * the plan is a markdown file a user or another tool can rewrite while the page
		 * is open. The check compares the stripped text with what the page rendered and
		 * only announces — it never writes `pageText`, which is the anchor a save is
		 * validated against. So an edit under an open page reaches every reader, and the
		 * review's own save, whose text is unchanged, says nothing.
		 *
		 * A poll rather than an `fs.watch`: the house rule, and one stat plus one read
		 * per interval costs less than the watcher's platform-dependent event
		 * semantics (see `file-browse`'s note). It stops with the session.
		 */
		const checkPlanFile = async (): Promise<void> => {
			const current = await store.read(cwd, plan.path);
			if (!current) return;
			if (stripFeedback(current.content) !== pageText) notifyPlanChange();
		};
		stopTicker = (deps.tick ?? defaultInterval)(deps.pollMs ?? PLAN_POLL_MS, () => void checkPlanFile());

		const page = async (caller: ReviewCaller): Promise<ReviewPageData> => {
			const stored = await refreshPageText();
			// The island is one function of what the page renders: the text, the baseline
			// the previous review left, and who is asking.
			return reviewPageData({
				path: plan.path,
				content: stored.content,
				baseline: options.baseline,
				caller,
				token,
				canApprove,
				share: () => shareSession.state(),
			});
		};

		/**
		 * The owner's save decides the review; a reviewer's post only writes.
		 * Both replace the comments of the writer they carry — the owner's are
		 * untagged, a reviewer's are tagged with the name bound to that link — so
		 * neither touches another writer's markers, and both refuse a plan that
		 * changed since the page was rendered.
		 */
		const save = async (annotations: PlanAnnotation[], caller: ReviewCaller): Promise<SaveResult> => {
			const { role } = caller;
			const write = { store, cwd, path: plan.path, pageText: () => pageText };
			if (role === "owner") {
				const saved = await saveOwnerAnnotations(write, annotations);
				if (!saved.ok) return saved;
				savedPlan = saved.plan;
				streams.broadcast("comment");
				return { ok: true };
			}
			// The saved plan is deliberately not recorded for a reviewer: a post is not a
			// result the session can return, so there is nothing for a later flush to resolve.
			const posted = await postReviewerAnnotations(
				{ ...write, caller, taken: tokens.namesExcept(caller) },
				annotations,
			);
			if (!posted.save.ok) return posted.save;
			caller.name ??= posted.save.author;
			streams.broadcast("comment");
			// The page is told the name its link stored, and the terminal is told a peer wrote.
			if (posted.count > 0) options.onReviewerComment?.(posted.save.author ?? "", posted.count);
			return posted.save;
		};

		// The second listener, its reviewer token, and the state the page and
		// `/plan share` read. It is handed the request handler, the role map, and the
		// frame hooks, so sharing stays one concern instead of five fields here.
		const shareSession = createShareSession({
			handleRequest,
			maxBodyBytes: bodyLimit,
			ownerPort: () => currentPort,
			networkInterfaces: deps.networkInterfaces ?? networkInterfaces,
			mintReviewer: () => tokens.mint("reviewer"),
			revokeReviewer: (value) => tokens.revoke(value),
			nameOf: (value) => tokens.get(value)?.name,
			broadcast: (kind, only) => streams.broadcast(kind, only === undefined ? undefined : { role: only }),
			endStreams: (kind, only) => streams.end(kind, only),
		});
		const hosts = (): readonly string[] => shareSession.hosts();

		const context: ReviewContext = {
			caller: (value) => tokens.get(value),
			hosts,
			canApprove,
			page,
			save,
			share: () => shareSession.share(),
			invite: () => shareSession.invite(),
			revoke: (id) => shareSession.revoke(id),
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
		/** One request, on either listener: the loopback page or a shared one. */
		async function handleRequest(request: LoopbackRequest): Promise<LoopbackReply> {
			let result: ServeResponse;
			try {
				result = await handleReviewRequest(context, request.method, request.url, request.headers, request.body);
			} catch {
				result = {
					status: 500,
					headers: jsonHeaders(),
					body: JSON.stringify({ error: "Internal error" }),
				};
			}
			// A save or cancel only resolves the session after its response is on the
			// wire; otherwise `close()` would force-close the socket mid-reply. The same
			// hook covers a client that walks away before the flush, so a settle cannot be
			// lost with the socket.
			const settlePending = (): void => {
				const terminal = pendingResult;
				if (!terminal) return;
				pendingResult = undefined;
				finish(terminal);
			};
			if (!result.stream) return { result, afterResponse: settlePending };
			const token = parseRequestUrl(request.url)?.search.get("token") ?? "";
			const streamCaller = context.caller(token);
			return {
				result,
				openSink: (sink) => {
					if (streamCaller !== undefined) streams.add(sink, { role: streamCaller.role, token });
					return () => streams.remove(sink);
				},
			};
		}

		const preferred = deps.port ?? ports.get(plan.path) ?? 0;
		let server: LoopbackServer;
		try {
			server = await serveLoopback({
				ports: preferred === 0 ? [0] : [preferred, 0],
				maxBodyBytes: bodyLimit,
				handler: handleRequest,
			});
		} catch {
			// The remembered port may have been taken between turns; the fallback above
			// covers that, so reaching here means neither port answered.
			return undefined;
		}
		const port = server.port;
		ports.set(plan.path, port);
		currentPort = port;

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
			stopTicker();
			streams.clear();
			await shareSession.close();
			await server.close();
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
