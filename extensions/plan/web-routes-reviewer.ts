/**
 * The review's one reviewer route: a shared link's whole surface.
 *
 * A reviewer posts the comments she wrote and ends nothing — the owner's own save decides
 * the review — which is why this route answers from the network where the owner's seven
 * answer on the machine serving it. The name her link has bound is what the write is signed
 * with, and the store reports it, so a page created before her first comment can adopt it.
 */

import { jsonResponse, type ServeResponse } from "../../lib/http/index.ts";
import type { RouteRequest, ReviewRoute } from "./web-router.ts";

export const REVIEWER_ROUTES: readonly ReviewRoute[] = [
	{
		path: "/api/comment",
		phrase: "post comments",
		access: "reviewer",
		refusal: "Only a shared reviewer posts comments.",
		body: "json",
		run: postComments,
	},
];

/** Persist the reviewer's comments; nothing about the review's outcome moves. */
async function postComments({ settle }: RouteRequest): Promise<ServeResponse> {
	const settled = await settle();
	if ("response" in settled) return settled.response;
	const { author } = settled.result;
	return jsonResponse(200, { ok: true, ...(author === undefined ? {} : { author }) });
}
