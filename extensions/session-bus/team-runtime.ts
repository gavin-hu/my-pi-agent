/**
 * The team half of the bus's tool surface: joining a split unit, leaving it, the
 * shared-file gate on `claim`, and the units line `status` reports.
 *
 * `membership.ts` holds the pure answers, `team.ts` reads the plan store, and
 * this module is the half that needs the bus's own writes — the claims table, the
 * calling session's record, and path resolution — so `runtime.ts` keeps the
 * session and this keeps the team. A split's rules are read here, never
 * remembered: a session that left is out of scope the moment its claims are gone.
 */

import { SPLIT_OFF_NOTE, splitEnabled } from "../../lib/plans/setting.ts";
import { claimsConflict } from "./protocol.ts";
import { heldUnits, sharedClaimRefusal } from "./membership.ts";
import { releaseClaimed } from "./store.ts";
import { newestTeam, resolveUnit, unitHolder } from "./team.ts";
import type { ClaimConflict, ClaimRecord, SessionRecord, SessionStatus } from "./types.ts";

/** The newest split in this repository, and who holds each of its units. */
export type UnitStatus = NonNullable<SessionStatus["units"]>;

/** What one `join` or `leave` answered, before the team's name is added. */
export interface JoinResult {
	team: string;
	unit: string;
	claimed: string[];
	conflicts: ClaimConflict[];
}

/** The bus's own reads and writes, as the team operations need them. */
export interface TeamRuntimeDeps {
	/** The plan store for this repository, when one is known. */
	plansRoot(): string | undefined;
	/** This session's record, prepared: a refresh plus the prune. */
	me(): Promise<SessionRecord>;
	/** The stored form of the paths a caller passed. */
	stored(me: SessionRecord, rawPaths: unknown): string[];
	/** The stored form of repository-relative paths a plan wrote. */
	rooted(me: SessionRecord, paths: readonly string[]): string[];
	claims(): Promise<ClaimRecord[]>;
	claimAll(me: SessionRecord, paths: readonly string[]): Promise<{ claimed: string[]; conflicts: ClaimConflict[] }>;
	releaseStored(me: SessionRecord, path: string): Promise<boolean>;
}

export interface TeamRuntime {
	/** Claim paths, refusing a shared file when this session holds an owner unit. */
	claim(rawPaths: unknown): Promise<{ claimed: string[]; conflicts: ClaimConflict[] }>;
	/** Claim every path of one unit in an approved split. */
	join(input: { team?: string; unit?: string }): Promise<JoinResult>;
	/** Release one unit's paths, or every claim this session holds. */
	leave(input: { team?: string; unit?: string }): Promise<{ released: string[]; notOwned: string[] }>;
	/** The split `status` reports, or undefined when the store has none. */
	units(claims: readonly ClaimRecord[]): UnitStatus | undefined;
}

export function createTeamRuntime(deps: TeamRuntimeDeps): TeamRuntime {
	async function claim(rawPaths: unknown): Promise<{ claimed: string[]; conflicts: ClaimConflict[] }> {
		const me = await deps.me();
		const paths = deps.stored(me, rawPaths);
		// A session that holds an owner unit leaves the shared files to the lead, the
		// same rule approval enforces. Read from the claims rather than remembered, so
		// a restored session is still held to it; nothing is written before the check.
		const claims = await deps.claims();
		if (claims.some((entry) => entry.owner === me.id)) {
			const root = deps.plansRoot();
			const units = root === undefined ? [] : (newestTeam(root)?.units ?? []);
			const refusal = sharedClaimRefusal(heldUnits(units, claims, me.id), paths);
			if (refusal !== undefined) throw new Error(refusal);
		}
		return deps.claimAll(me, paths);
	}

	async function join(input: { team?: string; unit?: string }): Promise<JoinResult> {
		const me = await deps.me();
		if (!splitEnabled(me.cwd, me.repoRoot)) throw new Error(SPLIT_OFF_NOTE);
		const unit = resolveUnit(deps.plansRoot() ?? "", input, "join");
		const claimed = await deps.claimAll(me, deps.rooted(me, unit.paths));
		return { team: unit.team, unit: unit.name, ...claimed };
	}

	async function leave(input: { team?: string; unit?: string }): Promise<{ released: string[]; notOwned: string[] }> {
		const me = await deps.me();
		const paths =
			input.team === undefined && input.unit === undefined
				? (await deps.claims()).filter((claim) => claim.owner === me.id).map((claim) => claim.path)
				: deps.rooted(me, resolveUnit(deps.plansRoot() ?? "", input, "leave").paths);
		return releaseClaimed(paths, (path) => deps.releaseStored(me, path));
	}

	function units(claims: readonly ClaimRecord[]): UnitStatus | undefined {
		const root = deps.plansRoot();
		const board = root === undefined ? undefined : newestTeam(root);
		if (board === undefined) return undefined;
		const rows = board.units.map((unit) => {
			const holder = unitHolder(unit, claims, claimsConflict);
			return {
				unit: unit.name,
				...(unit.lead ? { lead: true } : {}),
				...(holder === undefined ? {} : { holder }),
			};
		});
		return {
			team: board.team,
			joined: rows.filter((row) => row.holder !== undefined).length,
			total: rows.length,
			rows,
		};
	}

	return { claim, join, leave, units };
}
