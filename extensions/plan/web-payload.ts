/**
 * The review page's island: every fact the browser renders, built from one read of the
 * plan.
 *
 * The page's markup is `web-page.ts` and its lifetime is `web.ts`; this module is the
 * data between them, so a fact the page grows — a per-block change mark, a count, a
 * flag — is added here and in one client module rather than inside the server's start
 * closure. Everything below is pure: the plan text, the baseline, and who is asking come
 * in, the island goes out.
 */

import { basename } from "node:path";
import { fenceLanguage, highlightLines } from "../../lib/highlight.ts";
import { codeBody, fenceInfo, type PlanBlock } from "./blocks.ts";
import {
	MAX_ANNOTATIONS,
	MAX_COMMENT_LENGTH,
	MAX_QUOTE_LENGTH,
	readFeedback,
	type PlanAnnotation,
} from "./feedback.ts";
import { sanitizePlanText } from "./plan-text.ts";
import { blockChangeMarks, changedSections, planDigest, type SectionDigest } from "./plan-text.ts";
import { extractPlanSteps } from "./steps.ts";
import { planTitle } from "./plans.ts";
import type { ReviewCaller, ReviewRole } from "./types.ts";
import type { ShareState } from "./web-share.ts";

/** A heading the outline can jump to. */
export interface ReviewOutlineItem {
	/** DOM id the client gives the heading. */
	id: string;
	/** 0-based source line. */
	line: number;
	/** Heading level, 1-6. */
	level: number;
	/** Heading text. */
	text: string;
	/** True when this section changed since the previous review of the plan. */
	changed?: boolean;
	/** Content blocks this section no longer holds, when the baseline can say so. */
	removed?: number;
}

/** Everything the browser needs to render one plan review. */
export interface ReviewPageData {
	/** Plan title: the document's H1, or the file-name slug when it has none. */
	title: string;
	/** Source-line blocks of the feedback-stripped plan. */
	blocks: PlanBlock[];
	/** Absolute start lines of the blocks that are new or edited since the previous review. */
	changed?: number[];
	/** Whether the previous review's baseline carried block digests, so `changed` means something. */
	blockMarks?: boolean;
	/** Feedback already stored in the file. */
	annotations: PlanAnnotation[];
	/** Section outline, in document order. */
	outline: ReviewOutlineItem[];
	/**
	 * The plan's step progress, from the same `extractPlanSteps` the approval and
	 * `set_plan_steps` use: the `Steps` section when there is one, so the page
	 * agrees with what approval seeds rather than counting every checkbox.
	 */
	steps: { done: number; total: number };
	/** Highlighted HTML per line, keyed by the code block's 0-based start line. */
	code: Record<string, string[]>;
	/**
	 * The caps the server enforces, so the page does not retype them: comment
	 * count, comment length, and quote length, from `feedback.ts`.
	 */
	limits: { comments: number; comment: number; quote: number };
	/** Whether the review may approve the plan (only the `exit_plan_mode` flow). */
	canApprove: boolean;
	/** Who is looking: `owner` may approve, `reviewer` may only comment. */
	role: ReviewRole;
	/**
	 * The name a reviewer's link posts under, once it has been bound. Absent for the
	 * owner and for a reviewer that has not written yet, which is what tells the page
	 * whether its name control is still a choice.
	 */
	author?: string;
	/** A running share, so a reload re-renders the link the owner already minted. */
	share?: ShareState;
	/** Per-session secret the client echoes on every request. */
	token: string;
	/**
	 * A short digest of the plan text the page rendered. It keys the unsaved draft a
	 * tab keeps for itself, so a reload restores the comments this writer has not
	 * saved yet, and a plan that changed underneath drops them instead.
	 */
	rev: string;
}

/** What one island build reads. */
export interface ReviewPayloadInput {
	/** The plan's path, for the title's file-name fallback. */
	path: string;
	/** The plan as stored, feedback markers included. */
	content: string;
	/** The section digests the previous review showed, so this page can mark what moved. */
	baseline?: readonly SectionDigest[];
	/** Who is asking; the role decides what the page offers. */
	caller: ReviewCaller;
	/** The session secret the page echoes on every request. */
	token: string;
	/** Whether this review may approve the plan. */
	canApprove: boolean;
	/** The running share, read lazily: sharing can start after the page is first served. */
	share: () => ShareState | undefined;
}

/**
 * Build the island for one page request.
 *
 * The plan is read once, and the blocks, the comments, and the outline all come out of
 * that same parse: an annotation names a block from this read, so the island cannot mark
 * a comment onto a line the page never rendered.
 */
export function reviewPageData(input: ReviewPayloadInput): ReviewPageData {
	const { caller } = input;
	const role = caller.role;
	// Normalized the way the baseline is, so a block's digest here is the one the baseline
	// wrote: the page and the baseline must read the plan the same way, or every tabbed plan
	// would come back marked as changed. Not stripped, because the comments have to survive
	// for `readFeedback` to parse them.
	const read = readFeedback(sanitizePlanText(input.content));
	const current = read.body;
	const blocks = read.blocks;
	// Per-section change marks, each carrying its own section: the same shape the
	// terminal review renders, so a heading and its mark cannot be paired wrongly.
	const marks = changedSections(input.baseline, current);
	// Which blocks moved, in the document's own numbering: the page draws these, and a
	// section's shrinkage is the half of a diff a document cannot place in the flow.
	const blockMarks = blockChangeMarks(input.baseline, current);
	const outline = marks.flatMap(({ section, changed }) =>
		section.title === ""
			? []
			: [
					{
						id: `s-${section.line}`,
						line: section.line,
						level: section.level,
						text: section.title,
						...(changed ? { changed: true } : {}),
						...(blockMarks.removed[section.line] === undefined ? {} : { removed: blockMarks.removed[section.line] }),
					},
				],
	);
	// The same step list approval seeds and set_plan_steps indexes, so the page's
	// progress cannot disagree with the todo list.
	const stepList = extractPlanSteps(current);
	// Highlight code blocks once, at the boundary: the client copies only the tok-*
	// spans out of the server-escaped HTML.
	const code: Record<string, string[]> = {};
	for (const block of blocks) {
		if (block.kind !== "code") continue;
		const language = fenceLanguage(fenceInfo(block.lines[0] ?? ""));
		if (language) code[String(block.start)] = highlightLines(codeBody(block), language);
	}
	return {
		// The document's own H1 reads better than the file-name slug, and the slug is
		// still the fallback for a plan that starts with something else.
		title: marks.find((mark) => mark.section.level === 1)?.section.title || planTitle(basename(input.path)),
		blocks,
		...(blockMarks.starts.length === 0 ? {} : { changed: blockMarks.starts }),
		...(blockMarks.compared ? { blockMarks: true } : {}),
		annotations: read.annotations,
		outline,
		steps: {
			done: stepList.filter((step) => step.status === "completed").length,
			total: stepList.length,
		},
		code,
		limits: { comments: MAX_ANNOTATIONS, comment: MAX_COMMENT_LENGTH, quote: MAX_QUOTE_LENGTH },
		token: input.token,
		role,
		// What the page keys this tab's unsaved draft on: same plan text, same draft.
		rev: planDigest(current),
		...(caller.name === undefined ? {} : { author: caller.name }),
		canApprove: role === "owner" && input.canApprove,
		share: role === "owner" ? input.share() : undefined,
	};
}
