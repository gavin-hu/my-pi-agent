/**
 * A review a capture can photograph (dev tooling).
 *
 * The plan shot needs three things the shipped review does not do on its own: a
 * store that keeps a post in memory instead of on disk, a reviewer who has
 * already posted so the page shows the name bound to its link, and a draft that
 * is in the tab before the client boots. Chrome, the arg parsing, and the
 * readiness condition stay in `plan-review.ts`; this module is the state the
 * frame needs.
 *
 * A capture's store is not a test double: it accepts one write and serves the
 * result, while every other write still refuses, so nothing can be written to
 * disk by a screenshot.
 */

import { basename } from "node:path";
import { planBlocks } from "../../extensions/plan/blocks.ts";
import { formatFeedback, stripFeedback, type PlanAnnotation } from "../../extensions/plan/feedback.ts";
import { planDigest } from "../../extensions/plan/plan-text.ts";
import type { PlanStore, StoredPlan } from "../../extensions/plan/plans.ts";

/** The comment a `--post` capture writes, so the frame names what it shows. */
export const POST_COMMENT = "Posted from this link.";

/** The client's own storage key for the unsaved draft of one tab. */
const DRAFT_KEY = "bf-review-draft";

/** A plan as the store serves it, with a byte count that follows the content. */
export function storedPlan(content: string, path: string): StoredPlan {
	return {
		path,
		relativePath: basename(path),
		content,
		bytes: Buffer.byteLength(content, "utf-8"),
	};
}

/**
 * A `PlanStore` that serves one plan and keeps feedback in memory. The capture
 * writes through the real `/api/comment` route, so this is what makes a posted
 * comment visible in the frame without touching the disk.
 */
export function captureStore(plan: StoredPlan): { store: PlanStore; content: () => string } {
	let content = plan.content;
	const readOnly = async (): Promise<never> => {
		throw new Error("the screenshot store is read-only");
	};
	const current = (): StoredPlan => storedPlan(content, plan.path);
	return {
		store: {
			dirFor: readOnly,
			rootFor: async () => undefined,
			write: readOnly,
			setSteps: readOnly,
			read: async () => current(),
			latest: async () => current(),
			index: async () => [],
			takeNotice: () => undefined,
			saveFeedback: async (
				_cwd: string,
				_path: string,
				annotations: PlanAnnotation[],
				options: { author?: string } = {},
			): Promise<StoredPlan> => {
				content = formatFeedback(content, annotations, options);
				return current();
			},
		},
		content: () => content,
	};
}

/** The first block's source line: where a capture's own comment anchors. */
export function anchorOf(content: string): number {
	return planBlocks(content)[0]?.start ?? 0;
}

/**
 * Post one comment as `author` through the reviewer's own route, so the link's
 * name is bound by the shipped code rather than by the frame.
 */
export async function postAsReviewer(url: string, author: string, anchor: number): Promise<void> {
	const base = new URL(url);
	const target = new URL("/api/comment", base);
	// The token is the link's own; an absolute path does not inherit the base query.
	target.search = base.search;
	const response = await fetch(target, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ annotations: [{ anchor, comment: POST_COMMENT, author }] }),
	});
	if (!response.ok) throw new Error(`the reviewer post was refused: ${await response.text()}`);
}

/**
 * An init script that puts one unsaved comment in the tab's draft before the
 * client boots, keyed on the `rev` the server will render for this plan — the same
 * record and key the page writes itself, so the restore path is the shipped one.
 */
export function draftSeed(content: string, comment: string): string {
	const record = JSON.stringify({
		rev: planDigest(stripFeedback(content)),
		mine: [{ anchor: anchorOf(content), comment }],
	});
	return `try { window.sessionStorage.setItem(${JSON.stringify(DRAFT_KEY)}, ${JSON.stringify(record)}); } catch (error) {}`;
}
