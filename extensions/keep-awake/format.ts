/**
 * Pure text for the keep-awake status chip and command notices.
 */

import type { KeepAwakeMode, KeepAwakeOverride, KeepAwakeStatus } from "./types.ts";

const MODE_LABEL: Record<KeepAwakeMode, string> = { auto: "auto", always: "always" };

/** Short label for the status chip while an inhibitor is held. */
export function stateLabel(status: KeepAwakeStatus): string {
	if (status.override === "on") return "on";
	return MODE_LABEL[status.mode];
}

const UNAVAILABLE_PREFIX = "keep-awake: unavailable";

/** Sentence describing whether an inhibitor is currently held and why. */
export function statusNotice(status: KeepAwakeStatus): string {
	if (status.unavailable) return `${UNAVAILABLE_PREFIX} (${status.unavailable}).`;
	const override = status.override ?? "none";
	const state = status.active ? "holding the machine awake" : "not holding the machine awake";
	return `keep-awake: ${state} — override ${override}, config ${status.mode}.`;
}

/** Sentence describing an override change (or `undefined` for `auto`). */
export function overrideNotice(override: KeepAwakeOverride | undefined, status: KeepAwakeStatus): string {
	if (status.unavailable) return `${UNAVAILABLE_PREFIX} (${status.unavailable}).`;
	switch (override) {
		case "on":
			return "keep-awake on — the machine will not sleep while this session is open.";
		case "off":
			return "keep-awake off — the machine may sleep.";
		default:
			return `keep-awake auto — follows config (${status.mode}); active ${status.mode === "always" ? "for the session" : "only while the agent is working"}.`;
	}
}
