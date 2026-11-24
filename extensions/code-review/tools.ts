/**
 * The `code_review` tool: open a review page, read it, read what was sent, close it.
 *
 * The tool is the model's side of a human's review. It opens the page and prints
 * the address, reports what the page holds, hands back the comments a reviewer
 * sent (the same text the notice carried, with no cap), and closes the page —
 * refusing while comments are still drafts, because the page is the only place
 * they can be sent from.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { pathRef } from "../../lib/format.ts";
import { failedResult, textResult } from "../../lib/tool-result.ts";
import type { ReviewSession, ReviewStatus } from "./review/session.ts";
import { type ReviewArgs, type ReviewResult, ReviewOutput, ReviewParams, TOOL_NAME } from "./schema.ts";

/** The loader the extension hands this registerer: one session's page, on demand. */
export type EnsureSession = (ctx?: ExtensionContext) => Promise<ReviewSession>;

/** The details a call answers with, from the page's status. */
function resultOf(status: ReviewStatus, list?: ReviewResult["list"]): ReviewResult {
	return {
		open: status.url !== undefined,
		scope: status.scope,
		label: status.label,
		files: status.files,
		comments: status.comments,
		sent: status.sent,
		reviewed: status.reviewed,
		...(status.url === undefined ? {} : { url: status.url }),
		...(list === undefined ? {} : { list }),
	};
}

/** One status as the sentence the transcript shows. */
export function statusLine(status: ReviewStatus): string {
	if (status.url === undefined) {
		return status.sent === 0
			? 'No review page is open — `code_review` action "open" serves one.'
			: `${status.sent} review comment${status.sent === 1 ? "" : "s"} have been sent; no page is open now.`;
	}
	const parts = [
		`${status.files} file${status.files === 1 ? "" : "s"}`,
		status.label === "" ? "" : `on ${status.label}`,
		`${status.comments} comment${status.comments === 1 ? "" : "s"} on the page`,
		`${status.sent} sent this session`,
		`${status.reviewed} reviewed`,
	].filter((part) => part !== "");
	return `${status.url} — ${parts.join(", ")}.`;
}

export function registerReviewTool(pi: Pick<ExtensionAPI, "registerTool">, ensure: EnsureSession): void {
	pi.registerTool({
		name: TOOL_NAME,
		label: "Code review",
		description:
			"Serve the working tree as a review page a person can comment on line by line, then read what they sent. " +
			"`open` serves it, `status` reads it, `comments` hands back the sent comments, and `close` ends it.",
		promptSnippet: "Serve a diff as a review page, and read the comments a reviewer sent.",
		promptGuidelines: [
			"Use code_review open when the user wants to review a branch or their uncommitted changes in a browser.",
			"Use code_review comments when a notice said review comments were sent, before changing code for them.",
			"Do not use code_review to read files; it serves a diff, and the read tools read content.",
		],
		parameters: ReviewParams,
		outputSchema: ReviewOutput,
		exposure: "codemode",
		// The tool starts a page and opens a tab, so plan mode's read-only policy must keep it
		// behind the normal gate; the page answers on loopback only.
		annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const args = params as ReviewArgs;
			const session = await ensure(ctx);
			if (args.action === "open") {
				const outcome = await session.open({ scope: args.scope, base: args.base }, ctx);
				const state = await session.status();
				if (outcome.kind === "refused") {
					return failedResult(`review: ${outcome.reason}`, resultOf(state));
				}
				const text =
					outcome.problem === undefined
						? `Review page: ${outcome.status.url} — ${statusLine(outcome.status)}`
						: `Review page: ${outcome.status.url} — ${outcome.problem}`;
				return textResult(text, resultOf(outcome.status), resultOf(outcome.status));
			}
			if (args.action === "status") {
				const status = await session.status();
				return textResult(statusLine(status), resultOf(status), resultOf(status));
			}
			if (args.action === "comments") {
				const sent = session.sent();
				const list = sent.map((comment) => ({
					rel: comment.rel,
					line: comment.line,
					...(comment.endLine === undefined ? {} : { endLine: comment.endLine }),
					side: comment.side,
					body: comment.body,
				}));
				const text =
					sent.length === 0
						? "No review comments have been sent."
						: `Review comments sent (${sent.length}):\n${sent
								.map(
									(comment) =>
										`${pathRef(comment.rel, comment.line, comment.endLine)} (${comment.side}) — ${comment.body}`,
								)
								.join("\n")}`;
				const status = await session.status();
				return textResult(text, { ...resultOf(status, list), comments: sent.length }, resultOf(status, list));
			}
			const status = await session.status();
			if (status.drafts > 0) {
				return failedResult(
					`review: ${status.drafts} comment${status.drafts === 1 ? " is" : "s are"} still a draft — send ${status.drafts === 1 ? "it" : "them"} from the page before closing.`,
					resultOf(status),
				);
			}
			await session.close();
			return textResult("Review closed.", { ...resultOf({ ...status, url: undefined }), open: false });
		},
	});
}
