/**
 * `/review`: serve the working tree as a review page, and drive it.
 *
 * Bare `/review` serves the branch against its base; a scope word serves that
 * comparison instead, and is refused while the review holds comments. `status`
 * prints the address and what it holds, `stop` closes the page — the page's own
 * comments stay readable through the `code_review` tool either way.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { EnsureSession } from "./tools.ts";
import { statusLine } from "./tools.ts";
import { REVIEW_SCOPES, isReviewScope } from "./scope.ts";

/** The words `/review` completes, in the order it lists them. */
export const REVIEW_WORDS: readonly string[] = [...REVIEW_SCOPES, "status", "stop"];

/** What a bare `/review` does, and what each word after it does. */
export const REVIEW_USAGE = "usage: /review [base|last|staged|worktree|status|stop]";

export function registerReviewCommand(pi: Pick<ExtensionAPI, "registerCommand">, ensure: EnsureSession): void {
	pi.registerCommand("review", {
		description: "Serve the working tree as a review page and open it: /review [base|last|staged|worktree|status|stop]",
		getArgumentCompletions: (prefix) => {
			const text = prefix.trimStart();
			if (text.includes(" ")) return null;
			const items = REVIEW_WORDS.filter((word) => word.startsWith(text));
			return items.length > 0 ? items.map((value) => ({ value, label: value })) : null;
		},
		handler: async (args, ctx) => {
			const word = args.trim().split(/\s+/)[0] ?? "";
			if (word !== "" && !isReviewScope(word) && word !== "status" && word !== "stop") {
				ctx.ui.notify(`review: ${REVIEW_USAGE}`, "error");
				return;
			}
			const session = await ensure(ctx);
			if (word === "status") {
				ctx.ui.notify(`review: ${statusLine(await session.status())}`, "info");
				return;
			}
			if (word === "stop") {
				const status = await session.status();
				await session.close();
				ctx.ui.notify(
					status.url === undefined
						? "review: not running"
						: `review: stopped — ${status.sent} comment${status.sent === 1 ? "" : "s"} sent this session`,
					"info",
				);
				return;
			}
			// The page prints its own address and the reason it has no diff; nothing is
			// repeated here, so one open is one pair of lines.
			await session.open({ ...(isReviewScope(word) ? { scope: word } : {}) }, ctx);
		},
	});
}
