/**
 * The token table: who a review's bearer token names.
 *
 * A review has two roles and, once shared, one token per reviewer link. The role
 * travels with the token, and a reviewer's name is added to it the first time that
 * link writes. Everything that decides "may this caller approve, save, or close"
 * reads this table, so the rules live here rather than in the session that mints
 * them:
 *
 * - two roles may never share one token, or a reviewer token could displace the
 *   owner's and hand a reviewer the approval route;
 * - a removed token is forgotten rather than tombstoned, so a re-shared link may
 *   claim the name the revoked one released;
 * - a name already bound elsewhere is visible, because the marker in the plan
 *   carries only the name, so a shared name is a shared marker.
 */

import { randomBytes } from "node:crypto";
import type { ReviewCaller, ReviewRole } from "./types.ts";

/** The token → caller table one running review holds. */
export interface TokenTable {
	/** Mint a token for `role`, replacing a colliding one until it is unique. */
	mint(role: ReviewRole): string;
	/** The caller a token names, or undefined when it is not one of this review's. */
	get(token: string): ReviewCaller | undefined;
	/** Forget a token, so the link that used it stops answering. */
	revoke(token: string): void;
	/**
	 * The names every other live link has bound, so one review cannot hold two
	 * reviewers called `alice`: the marker carries only the name, so a shared name
	 * is a shared marker.
	 */
	namesExcept(self: ReviewCaller): string[];
}

/** How many times a colliding generator is retried before the table names it itself. */
const COLLISION_ATTEMPTS = 8;

/** A 128-bit token; the one credential a reviewer holds. */
const defaultToken = (): string => randomBytes(16).toString("hex");

/** Build the table for one review. `mint` is the generator a test replaces. */
export function createTokens(mint: () => string = defaultToken): TokenTable {
	const callers = new Map<string, ReviewCaller>();
	return {
		mint(role) {
			// A role is keyed by its token, so two roles may never share one: a
			// generator that repeats would otherwise let a reviewer token displace the
			// owner's and hand a reviewer the approval route.
			let value = mint();
			for (let attempt = 0; callers.has(value) && attempt < COLLISION_ATTEMPTS; attempt++) value = mint();
			if (callers.has(value)) value = `${value}-${callers.size}`;
			callers.set(value, { role });
			return value;
		},
		get: (token) => callers.get(token),
		revoke: (token) => {
			callers.delete(token);
		},
		namesExcept: (self) => [...callers.values()].flatMap((entry) => (entry !== self && entry.name ? [entry.name] : [])),
	};
}
