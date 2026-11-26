/**
 * The session's review page: opening it, reading it, and the comments it sent.
 *
 * One page per session, like `/browse`: a second `/review` reports the address
 * rather than replacing a review somebody is reading, and re-scoping is allowed while
 * the page holds nothing a replacement would destroy — no draft, no mark. Sent comments
 * are the session's already, so they never hold a scope change. The sent comments live
 * beside the page, so closing it or a reload does not take the model's copy away — they
 * are the one thing the review hands over.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type Launch, openPageInBrowser, urlLauncher } from "../../../lib/browser.ts";
import { isRemoteTurn } from "../../../lib/interaction.ts";
import type { MountOutcome, MountSpec } from "../../../lib/http/mount.ts";
import { loadServeConfig } from "../../../lib/serve-config.ts";
import { loadReviewConfig } from "../config/config.ts";
import { parseScope, type ReviewScope } from "../scope.ts";
import { createReviewPage, type ReviewServer } from "../transport/server.ts";
import { createReviewCurrent } from "./current.ts";
import { scopeRefusal, scopeWork } from "./scope-work.ts";
import { createReviewStore, type ReviewComment } from "./store.ts";

/** What a review page is showing, as a tool or a command reports it. */
export interface ReviewStatus {
	url?: string;
	scope: ReviewScope;
	label: string;
	files: number;
	comments: number;
	/** Comments written on the page and not sent yet. */
	drafts: number;
	sent: number;
	reviewed: number;
	/** Why the page has no diff, when the snapshot it read failed; absent when it has one. */
	problem?: string;
}

/** What opening the page answered. */
export type OpenOutcome =
	| { kind: "open"; status: ReviewStatus; problem?: string }
	| { kind: "refused"; reason: string };

/** The page a session holds. */
export interface ReviewSession {
	/** Open the page, or report the one already open. */
	open(input: { scope?: ReviewScope; base?: string }, ctx: ExtensionContext): Promise<OpenOutcome>;
	/** What the page shows, reading the tree once. */
	status(): Promise<ReviewStatus>;
	/** Every comment a reviewer sent this session, oldest first. */
	sent(): ReadonlyArray<ReviewComment>;
	/** Release the page; idempotent. */
	close(): Promise<void>;
}

export interface ReviewSessionDeps {
	pi: Pick<ExtensionAPI, "exec" | "events">;
	ctx: ExtensionContext;
	/** A tab opener a case drives instead of the OS launcher. */
	open?: (url: string) => void;
	/** A launcher that fails, so a case sees the notice. */
	launch?: Launch;
	/** Told after a send, so the session reads the comments at its next turn. */
	onSent?: (sent: ReadonlyArray<ReviewComment>, id: string) => void;
	/** The mount seam a case replaces instead of asking the session's server. */
	mount?: (spec: MountSpec) => Promise<MountOutcome>;
	/** The token and id generator, for a case. */
	mint?: () => string;
	/** Wall-clock seam, for a case. */
	now?: () => number;
}

/** The page lifecycle for one session. */
export function createReviewSession(deps: ReviewSessionDeps): ReviewSession {
	const { ctx } = deps;
	const sessionId = ctx.sessionManager.getSessionId();
	let running: ReviewServer | undefined;
	let sent: ReviewComment[] = [];
	/** The review's state, which outlives a mount: closing the page drops it, the session ends it. */
	const store = createReviewStore({
		...(deps.mint === undefined ? {} : { mint: deps.mint }),
		...(deps.now === undefined ? {} : { now: deps.now }),
	});
	/** The root, reader and page as one request reads them — a worktree switch moves the root. */
	const current = createReviewCurrent({
		store,
		exec: deps.pi,
		config: loadReviewConfig(ctx.cwd),
		cwd: () => ctx.cwd,
	});

	/** The status of the page, or of a session with none. */
	const describe = async (): Promise<ReviewStatus> => {
		const page = running;
		const held = page?.store.current();
		const base: ReviewStatus = {
			...(page === undefined ? {} : { url: page.url }),
			scope: page?.scope() ?? "base",
			label: "",
			files: 0,
			comments: held?.review?.comments.length ?? 0,
			drafts: held?.review?.comments.filter((comment) => comment.state === "draft").length ?? 0,
			sent: sent.length,
			reviewed: held?.review?.reviewed.length ?? 0,
		};
		if (page === undefined) return base;
		const outcome = await page.snapshot();
		if (outcome.kind !== "snapshot") return { ...base, problem: outcome.message };
		return {
			...base,
			label: outcome.snapshot.label,
			files: outcome.snapshot.files.length,
		};
	};

	/** Put the page in front of the person, or name the address to paste. */
	const openTab = async (url: string): Promise<void> => {
		const { autoOpen } = loadServeConfig(ctx.cwd);
		const launch = deps.open === undefined ? deps.launch : urlLauncher(deps.open);
		const outcome = openPageInBrowser(url, {
			autoOpen,
			remote: isRemoteTurn(ctx),
			...(launch === undefined ? {} : { launch }),
			onFailure: (reason) => ctx.ui.notify(`review: could not open the browser (${reason}) — open ${url}`, "warning"),
		});
		if (outcome === "skipped-remote") {
			ctx.ui.notify(`review: the browser needs the local machine — open ${url}`, "info");
		}
	};

	/** End the review: the one close `/review stop`, the session's end and an abandoned page share. */
	const closePage = async (): Promise<void> => {
		const page = running;
		running = undefined;
		store.close();
		await page?.close();
	};

	return {
		async open(input) {
			const { repo } = current.place();
			const config = loadReviewConfig(ctx.cwd);
			const scope = parseScope(input.scope) ?? "base";
			const configured = input.base === undefined ? config : { ...config, base: input.base };
			// An open's own `base` replaces the configured one for the reader this opening reads.
			current.configure(configured);

			const held = running?.store.current();
			if (running !== undefined && held !== undefined) {
				const sameScope = held.scope === scope;
				const sameBase = scope !== "base" || input.base === undefined || held.base === input.base;
				if (sameScope && sameBase) {
					ctx.ui.notify(`review: ${running.url} (already open)`, "info");
					await openTab(running.url);
					return { kind: "open", status: await describe() };
				}
				if (held.review !== undefined) {
					const work = scopeWork(held.review);
					if (work.drafts + work.marks > 0) {
						// The address is appended here rather than at each door, so a notice, a tool's
						// failure text and a page's 409 cannot disagree about where the reader still is.
						const still = running.url === undefined ? "" : ` — still open at ${running.url}`;
						const reason = `${scopeRefusal(held.review, held.label)}${still}`;
						ctx.ui.notify(`review: ${reason}`, "error");
						return { kind: "refused", reason };
					}
				}
				await running.close();
				running = undefined;
			}

			const { requestMount } = await import("../../../lib/http/mount.ts");
			const outcome = await createReviewPage({
				store,
				current,
				session: sessionId,
				mount: deps.mount ?? ((spec) => requestMount(deps.pi, spec)),
				// The last tab leaving ends the review, through the same close a person's stop runs.
				onAbandoned: () => void closePage(),
				onSent: (comments, id) => {
					sent = [...sent, ...comments];
					deps.onSent?.(comments, id);
				},
			});
			if (outcome.kind === "refused") {
				ctx.ui.notify(`review: ${outcome.reason}`, "error");
				return { kind: "refused", reason: outcome.reason };
			}
			running = outcome.page;
			// The mount only routes; the page this opening names is minted by the seam's one rule.
			await current.openPage(scope);
			const status = await describe();
			// The page's own reason, so a base that cannot be used is named here rather than only
			// behind the address: the sentence is the whole point of asking git for it.
			const problem = status.problem;
			ctx.ui.notify(
				problem === undefined
					? `review: ${repo} vs ${status.label} — ${status.files} file${status.files === 1 ? "" : "s"}`
					: `review: ${repo} — ${problem}`,
				problem === undefined ? "info" : "warning",
			);
			ctx.ui.notify(`review: ${running.url}`, "info");
			await openTab(running.url);
			return { kind: "open", status, ...(problem === undefined ? {} : { problem }) };
		},
		status: describe,
		sent: () => sent,
		close: closePage,
	};
}
