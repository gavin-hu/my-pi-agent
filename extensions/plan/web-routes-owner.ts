/**
 * The review's owner routes: what only the plan's author may do from the page.
 *
 * Each is a row in `web-router.ts`'s table and holds only what happens once the guards have
 * passed. The guards are the dispatcher's, so a route here declares its access, whether it
 * reads a body, and the sentence another role reads — and never composes a check of its own.
 *
 * Seven routes, and the write is not the common case: cancel and the three share controls
 * touch no annotations at all (the session's share table is its own module's business), and
 * revoke names a link rather than a comment. Only save and approve settle annotations, and
 * they are the two ways a review returns to Pi.
 */

import { jsonError, jsonResponse, type ServeResponse } from "../../lib/http/index.ts";
import type { RouteRequest, ReviewRoute } from "./web-router.ts";
import type { ShareResult } from "./web-share.ts";

export const OWNER_ROUTES: readonly ReviewRoute[] = [
	{
		path: "/api/cancel",
		phrase: "cancel",
		access: "owner",
		refusal: "Only the plan owner can close this review.",
		body: "none",
		run: cancelReview,
	},
	{
		path: "/api/share",
		phrase: "share or stop sharing",
		access: "owner",
		refusal: "Only the plan owner can share this review.",
		body: "none",
		run: shareReview,
	},
	{
		path: "/api/share/link",
		phrase: "share or stop sharing",
		access: "owner",
		refusal: "Only the plan owner can share this review.",
		body: "none",
		run: inviteReviewer,
	},
	{
		path: "/api/share/stop",
		phrase: "share or stop sharing",
		access: "owner",
		refusal: "Only the plan owner can share this review.",
		body: "none",
		run: stopSharing,
	},
	{
		path: "/api/share/revoke",
		phrase: "revoke a link",
		access: "owner",
		refusal: "Only the plan owner can revoke a link.",
		body: "json",
		run: revokeLink,
	},
	{
		path: "/api/feedback",
		phrase: "save feedback",
		access: "owner",
		refusal: "Only the plan owner saves this review; a reviewer posts comments.",
		body: "json",
		run: saveFeedback,
	},
	{
		path: "/api/approve",
		phrase: "approve",
		access: "owner",
		refusal: "A shared review cannot approve the plan.",
		body: "json",
		run: approvePlan,
	},
];

/** Ending the review is the owner's decision; a reviewer closes their tab. */
async function cancelReview({ ctx }: RouteRequest): Promise<ServeResponse> {
	ctx.onCancel();
	return jsonResponse(200, { ok: true });
}

/** One share answer: the state the page draws, and the QR a new link offers. */
function shared(result: ShareResult): ServeResponse {
	return jsonResponse(200, { ok: true, share: result.state, svg: result.svg });
}

async function shareReview({ ctx }: RouteRequest): Promise<ServeResponse> {
	return shared(await ctx.share());
}

/** One more reviewer link, so each teammate holds their own rather than sharing one name. */
async function inviteReviewer({ ctx }: RouteRequest): Promise<ServeResponse> {
	return shared(await ctx.invite());
}

/** Stop accepting reviewers: their tokens are revoked with the share. */
async function stopSharing({ ctx }: RouteRequest): Promise<ServeResponse> {
	return shared(await ctx.stopShare());
}

/** Revoke exactly one link, by the id the page's list carries. */
async function revokeLink({ ctx, body }: RouteRequest): Promise<ServeResponse> {
	const id = linkIdOf(body);
	if (id === undefined) return jsonError(400, "The request body must name the link's id.");
	const result = await ctx.revoke(id);
	if (!result) return jsonError(404, "That link is not shared.");
	return shared(result);
}

/**
 * Returning to the model is the owner's decision; a reviewer posts to `/api/comment`, so
 * this route can never settle a shared review.
 */
async function saveFeedback({ ctx, settle }: RouteRequest): Promise<ServeResponse> {
	const settled = await settle();
	if ("response" in settled) return settled.response;
	ctx.onSaved(settled.annotations);
	return jsonResponse(200, { ok: true });
}

/**
 * Only the owner's own page approves, and only the `exit` flow owns the side effects: a
 * review opened any other way refuses the browser whatever the caller posts.
 */
async function approvePlan({ ctx, settle }: RouteRequest): Promise<ServeResponse> {
	if (!ctx.canApprove) return jsonError(403, "This review cannot be approved from the browser.");
	const settled = await settle();
	if ("response" in settled) return settled.response;
	ctx.onApprove(settled.annotations);
	return jsonResponse(200, { ok: true });
}

/** The link id a revoke request names, or undefined when the body has none. */
function linkIdOf(body: string): string | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(body);
	} catch {
		return undefined;
	}
	const id = (parsed as { id?: unknown } | null)?.id;
	return typeof id === "string" && id !== "" ? id : undefined;
}
