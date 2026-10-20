/**
 * The plan-mode flag as the session branch carries it.
 *
 * Plan mode persists one custom entry (`plan-mode`) whose `enabled` field is the
 * last word on the branch. `plan` writes it; `rewind` reads it through this
 * module so `/review` cannot write while planning, without importing another
 * extension's modules.
 *
 * Value-only: a constant and a pure replay over untrusted branch entries.
 */

/** Custom-entry type plan mode persists. */
export const PLAN_MODE_ENTRY_TYPE = "plan-mode";

/**
 * Whether the branch's last valid plan-mode entry is enabled.
 *
 * Branch data is untrusted: an entry with the wrong type, a malformed `data`, or
 * a non-boolean `enabled` is skipped rather than read as false. The last valid
 * entry wins, so a later disable turns it off and a `/tree` restore follows the
 * branch it lands on.
 */
export function isPlanModeEnabled(entries: readonly unknown[]): boolean {
	let enabled = false;
	for (const raw of entries) {
		if (!raw || typeof raw !== "object") continue;
		const entry = raw as { type?: unknown; customType?: unknown; data?: unknown };
		if (entry.type !== "custom" || entry.customType !== PLAN_MODE_ENTRY_TYPE) continue;
		if (!entry.data || typeof entry.data !== "object") continue;
		const value = (entry.data as { enabled?: unknown }).enabled;
		if (typeof value === "boolean") enabled = value;
	}
	return enabled;
}
