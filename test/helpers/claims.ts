/**
 * The claim rule's fake bus, for the suites that drive `Claims` rather than a real one.
 *
 * Two suites need it — the crossing and the re-claim after a restart — and a copy in each is how
 * the seam a case answers stops matching the seam the rule calls.
 */

import type { Card } from "../../lib/workflow/card.ts";
import type { Claims } from "../../lib/workflow/claims.ts";
import type { MutateResult } from "../../lib/workflow/store.ts";
import type { ClaimPathsResult, ReleasePathsResult } from "../../lib/session-tool.ts";

/** The context a seam call takes, and none of the cases reads. */
export const CLAIMS_CTX = {} as never;

/** The label a write made by another session carries: the lead, in a reclaim from a peer. */
export const CLAIMS_OTHER = "board-lead";

/** A card with the two facts a crossing reads. */
export function claimsCard(lane: Card["lane"], paths: string[] = ["src/api", "src/web"]): Card {
	return {
		v: 2,
		id: "4",
		title: "Rate limits",
		lane,
		paths,
		notes: [],
		notesDropped: 0,
		owner: { id: "s-1", label: "api-core" },
		rev: 2,
		createdAt: 1,
		updatedAt: 1,
		by: "api-core",
		log: [{ lane, at: 1, by: "api-core" }],
		logDropped: 0,
	};
}

/** One recorded call, and the answer it gave. */
interface Sent {
	call: "claim" | "release";
	paths: readonly string[];
}

/** The bus as this module sees it: what it recorded, and what it answers. */
export function claimsBus(
	options: {
		loaded?: boolean;
		/** One answer for every batch, or the bus's own answer for the batch it was asked about. */
		claim?: ClaimPathsResult | ((paths: readonly string[]) => ClaimPathsResult);
		release?: ReleasePathsResult;
		throws?: boolean;
	} = {},
): Claims & { sent: Sent[] } {
	const sent: Sent[] = [];
	return {
		sent,
		loaded: () => options.loaded ?? true,
		claim: async (_ctx, paths) => {
			sent.push({ call: "claim", paths });
			if (options.throws === true) throw new Error("the bus went away");
			const answer = typeof options.claim === "function" ? options.claim(paths) : options.claim;
			return answer ?? { ok: true, claimed: [...paths], conflicts: [] };
		},
		release: async (_ctx, paths) => {
			sent.push({ call: "release", paths });
			if (options.throws === true) throw new Error("the bus went away");
			return options.release ?? { ok: true, released: [...paths], notOwned: [] };
		},
	};
}

/** A successful write of `after`, which read `before`. */
export function claimsWrite(before: Card, after: Card, extra: { dropped?: boolean } = {}): MutateResult {
	return {
		ok: true,
		card: after,
		changed: true,
		dropped: extra.dropped ?? false,
		archived: false,
		previous: before,
	};
}

export const CTX = {} as never;
