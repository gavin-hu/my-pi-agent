/**
 * code-review — serve a diff as a page a person comments on, line by line.
 *
 * Registers the `code_review` tool and the `/review` command. The page lives on
 * the session's one port, mounted when a call opens it; the comments a reviewer
 * sends come back as one notice at the session's next turn, and the tool reads
 * them back in full. Nothing is written to the working tree: the review is the
 * session's, and its comments leave through the transcript.
 *
 * Load with:  pi --extension ./extensions/code-review
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Launch } from "../../lib/browser.ts";
import { isExtensionEnabled } from "../../lib/env.ts";
import { lazy, type Lazy } from "../../lib/lazy.ts";
import { createPendingReporter, registerPendingChannel } from "../../lib/report.ts";
import { registerReviewCommand } from "./command.ts";
import { reviewNotice, type ReviewSend } from "./report.ts";
import type { ReviewSession } from "./review/session.ts";
import { registerReviewTool } from "./tools.ts";

export interface CodeReviewDeps {
	/** Record the tab a page asks for, instead of launching one (tests). */
	open?: (url: string) => void;
	/** Drive the launcher to a failure, so a case sees the notice (tests). */
	launch?: Launch;
}

export default function codeReview(pi: ExtensionAPI, deps: CodeReviewDeps = {}): void {
	if (!isExtensionEnabled("code-review")) return;

	/** The session the page serves as, set on every `session_start`. */
	let current: ExtensionContext | undefined;
	/** The comments waiting for a turn to be read in. */
	const sends: ReviewSend[] = [];
	const session: { slot?: Lazy<ReviewSession> } = {};

	const reporter = createPendingReporter<ReviewSend>({
		// The page's dialog says "at its next turn", so nothing here triggers one.
		wake: (notice) => pi.sendMessage(notice, { triggerTurn: false }),
		pending: () => [...sends],
		markReported: (items) => {
			for (const item of items) {
				const index = sends.indexOf(item);
				if (index >= 0) sends.splice(index, 1);
			}
		},
		buildNotice: (items) => reviewNotice(items),
		wakeRequested: () => false,
		source: "code-review",
	});

	/**
	 * The session's page, loaded on the first call.
	 *
	 * The page, its routes, and its view are weight a session that never reviews
	 * should not pay, so the module arrives with the first `code_review` or
	 * `/review`; a shutdown asks `peek` and never starts the load.
	 */
	const ensure = async (ctx?: ExtensionContext): Promise<ReviewSession> => {
		current ??= ctx;
		if (current === undefined) throw new Error("code review needs a running session before it can serve a page");
		const context = current;
		session.slot ??= lazy(async () => {
			const { createReviewSession } = await import("./review/session.ts");
			return createReviewSession({
				pi,
				ctx: context,
				...(deps.open === undefined ? {} : { open: deps.open }),
				...(deps.launch === undefined ? {} : { launch: deps.launch }),
				onSent: (comments, id) => {
					sends.push({
						id,
						comments: comments.map((comment) => ({
							rel: comment.rel,
							line: comment.line,
							side: comment.side,
							body: comment.body,
						})),
						at: Date.now(),
					});
				},
			});
		});
		return session.slot.get();
	};

	registerReviewTool(pi, ensure);
	registerReviewCommand(pi, ensure);

	registerPendingChannel(pi, {
		reporter,
		runtime: {
			load: (ctx) => {
				current = ctx;
			},
			shutdown: async () => {
				const loaded = session.slot?.peek();
				session.slot = undefined;
				current = undefined;
				await loaded?.close();
			},
		},
	});
}
