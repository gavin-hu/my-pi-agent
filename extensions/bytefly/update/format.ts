/**
 * Wording for the update surface: the header marker and the one transcript
 * notice.
 *
 * The list is Pi's `PackageUpdate[]`, so the notice names the packages Pi will
 * update and the command that does it. The header marker shows this package's
 * new version only; other packages never change the header.
 */

import { noticeMessage, type NoticeMessage } from "../../../lib/notice.ts";
import { GLYPHS } from "../../../lib/tui/glyphs.ts";
import type { PackageUpdate } from "./types.ts";

/** The header marker: an up arrow and this package's newest version, e.g. `↑0.12.0`. */
export function updateMarker(latest: string): string {
	return `${GLYPHS.update}${latest}`;
}

/** The command that resolves every row in the notice. */
export const UPDATE_COMMAND = "pi update --extensions";

/** One updateable package as a notice row: its name, then its scope. */
function packageRow(update: PackageUpdate): { label: string; detail: string; severity: "info" } {
	return {
		label: update.displayName,
		detail: update.scope === "project" ? "project" : "global",
		severity: "info",
	};
}

/** The single notice a session posts when Pi reports package updates. */
export function updateNotice(updates: readonly PackageUpdate[]): NoticeMessage {
	const count = updates.length;
	const headline = count === 1 ? "1 package update available" : `${count} package updates available`;
	const names = updates.map((update) => update.displayName).join(", ");
	return noticeMessage({
		content: `${headline}: ${names}. Run \`${UPDATE_COMMAND}\` to update.`,
		details: {
			source: "bytefly",
			title: headline,
			severity: "info",
			items: [...updates.map(packageRow), { label: "update", detail: UPDATE_COMMAND }],
		},
	});
}
