/**
 * The session's mode as the branch carries it: one value derived from two
 * entries, so plan mode and lead mode cannot both be on.
 *
 * Plan persists `plan-mode`; lead mode persists `lead-mode`, whose reader is
 * here and whose only writer is the board's lead runtime. Plan's entry wins when
 * a branch carries both, because its guarantee is the stronger one: such a
 * branch is planning. `isPlanModeEnabled` stays a strict `"plan"` test, because
 * the surfaces that ask it mean plan, never "read-only".
 *
 * Value-only: two entry types, a pure replay over untrusted branch entries, and
 * the transition a door asks before switching.
 */

/** The modes a session can be in; `auto` is the absence of any mode. */
export type SessionMode = "auto" | "plan" | "lead";

/** Every mode, in the order a refusal lists them. */
export const SESSION_MODES = ["auto", "plan", "lead"] as const;

/** Custom-entry type plan mode persists. */
export const PLAN_MODE_ENTRY_TYPE = "plan-mode";

/** Custom-entry type lead mode persists; the board's lead runtime is its only writer. */
export const LEAD_MODE_ENTRY_TYPE = "lead-mode";

/** The mode the branch is in, and the tools that mode hid. */
export interface ModeState {
	/** The mode in force. */
	mode: SessionMode;
	/** Tools the mode hid, for its owner to put back when it leaves. */
	removed?: string[];
}

/** Whether `value` is one of {@link SESSION_MODES}. */
export function isSessionMode(value: unknown): value is SessionMode {
	return typeof value === "string" && (SESSION_MODES as readonly string[]).includes(value);
}

/** The last valid entry of one type, as the branch wrote it. */
function lastEntry(
	entries: readonly unknown[],
	entryType: string,
): { enabled: boolean; removed?: string[] } | undefined {
	let found: { enabled: boolean; removed?: string[] } | undefined;
	for (const raw of entries) {
		if (!raw || typeof raw !== "object") continue;
		const entry = raw as { type?: unknown; customType?: unknown; data?: unknown };
		if (entry.type !== "custom" || entry.customType !== entryType) continue;
		if (!entry.data || typeof entry.data !== "object") continue;
		const data = entry.data as { enabled?: unknown; removed?: unknown };
		if (typeof data.enabled !== "boolean") continue;
		const removed = Array.isArray(data.removed)
			? data.removed.filter((name): name is string => typeof name === "string")
			: undefined;
		found = { enabled: data.enabled, ...(removed === undefined ? {} : { removed }) };
	}
	return found;
}

/**
 * The mode the branch is in, replayed from the last valid entry of each type.
 *
 * Branch data is untrusted: an entry with the wrong type, a malformed `data`, or
 * a non-boolean `enabled` is skipped rather than read as off. The last valid
 * entry of a type wins, so a later disable turns that mode off and a `/tree`
 * restore follows the branch it lands on.
 */
export function lastModeState(entries: readonly unknown[]): ModeState {
	const plan = lastEntry(entries, PLAN_MODE_ENTRY_TYPE);
	const lead = lastEntry(entries, LEAD_MODE_ENTRY_TYPE);
	// Plan's guarantee is the stronger one, so a branch carrying both is planning.
	const found =
		plan?.enabled === true
			? { mode: "plan" as const, removed: plan.removed }
			: lead?.enabled === true
				? { mode: "lead" as const, removed: lead.removed }
				: undefined;
	if (found === undefined) return { mode: "auto" };
	return found.removed === undefined ? { mode: found.mode } : { mode: found.mode, removed: found.removed };
}

/** The mode the branch is in. */
export function modeOf(entries: readonly unknown[]): SessionMode {
	return lastModeState(entries).mode;
}

/**
 * Whether this branch holds the seat.
 *
 * The one read of the `lead` mode: `who()` composes it into `Actor.seat`, which the board's gates
 * read through `leadAuthority`, and the bus's release door asks the same question of the same
 * branch (#835). One owner, so no surface keeps a second `mode === "lead"` compare of its own —
 * that is #825's lesson, and #821's before it.
 */
export function holdsSeat(entries: readonly unknown[]): boolean {
	return modeOf(entries) === "lead";
}

/** Whether the branch is planning: strict, so a lead branch is not a planning one. */
export function isPlanModeEnabled(entries: readonly unknown[]): boolean {
	return modeOf(entries) === "plan";
}

/**
 * Why a session may not switch to `to` from `from`, or undefined when it may.
 *
 * The one switch a mode refuses is a lead entering plan: planning strips the
 * contract and the signature, which are the lead's own verbs. Asking for the
 * mode already in force is allowed, because a door re-entered is not a switch.
 */
export function mayEnter(to: string, from: SessionMode): string | undefined {
	if (!isSessionMode(to)) return `"${to}" is not a mode; the modes are ${SESSION_MODES.join(", ")}.`;
	if (to === from) return undefined;
	if (from === "lead" && to === "plan") return "Lead mode holds the seat: `/board stop` before planning.";
	return undefined;
}

/**
 * Whether this branch may switch to `to`, read from the branch rather than taken from a caller.
 *
 * {@link mayEnter}'s answer for a caller that holds a session instead of a mode: the `from` half is
 * the mode the branch carries, which is the one a resume or a `/tree` hop moved and the only one
 * that can hold the seat. A caller's own enabled flag knows what this session did, not what the
 * branch says — and the branch is what both runtimes replay.
 */
export function mayEnterFrom(to: string, entries: readonly unknown[]): string | undefined {
	return mayEnter(to, modeOf(entries));
}
