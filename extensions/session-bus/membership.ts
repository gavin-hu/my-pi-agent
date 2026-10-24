/**
 * Which split unit a session holds, and the shared files it therefore may not
 * claim (pure).
 *
 * Read from the claims, not remembered: a claim is the durable record that a
 * session joined a unit, so this survives `/resume` and `/tree` — where a fresh
 * map would be empty and the shared-file rule would quietly stop applying — and a
 * session that left is out of scope the moment its claims are released. The plan
 * store supplies the other half: a unit is the lead's or an owner's only as the
 * newest split wrote it, and a plan that was never approved with a split leaves
 * nothing to hold.
 *
 * No module state, no disk read: the caller passes the units and the claims.
 */

import { claimsConflict } from "../../lib/claims/overlap.ts";
import { sharedFileFor } from "../../lib/plans/split.ts";
import type { PlanUnit } from "../../lib/plans/team.ts";

/** A unit this session holds, with the lead it leaves the shared files to. */
export interface HeldUnit {
	/** The unit's slug, as the split table names it. */
	unit: string;
	/** The lead's unit slug, the one session allowed to claim a shared file. */
	lead: string;
	/** False for the lead's own unit, which keeps shared files. */
	owner: boolean;
}

/** The part of a stored claim this reads: whose it is, and what it covers. */
export interface ClaimedPath {
	/** Repository-relative path the claim covers. */
	path: string;
	/** The session id holding it. */
	owner: string;
}

/**
 * The units `me` holds, given one split's units and the whole claim table.
 *
 * A claim on any of a unit's paths is what holding it means, which is exactly what
 * `join` writes: one claim per path the unit owns.
 */
export function heldUnits(units: readonly PlanUnit[], claims: readonly ClaimedPath[], me: string): HeldUnit[] {
	const lead = units.find((unit) => unit.lead)?.name;
	if (lead === undefined) return [];
	const mine = claims.filter((claim) => claim.owner === me);
	return units
		.filter((unit) => mine.some((claim) => unit.paths.some((path) => claimsConflict(claim.path, path))))
		.map((unit) => ({ unit: unit.name, lead, owner: unit.lead !== true }));
}

/**
 * The refusal for a claim `held` must not make, or undefined when it may.
 *
 * All-or-nothing, like every other claim rule: the caller asks before it writes,
 * so a refused call leaves the caller holding exactly what it held. The list is
 * `lib/plans/split.ts`'s `SHARED_FILES`, the one approval applies: the bus reads
 * no configuration of its own, so the two answers cannot drift apart.
 */
export function sharedClaimRefusal(held: readonly HeldUnit[], paths: readonly string[]): string | undefined {
	const owner = held.find((entry) => entry.owner);
	if (owner === undefined) return undefined;
	for (const path of paths) {
		const shared = sharedFileFor(path);
		if (shared !== undefined) return `${shared} is a shared file; only the lead "${owner.lead}" may claim it.`;
	}
	return undefined;
}
