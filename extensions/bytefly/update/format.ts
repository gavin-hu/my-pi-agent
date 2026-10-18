/**
 * Wording for the update check: the header marker and the one transcript notice.
 *
 * Both read the same two facts — the version this session loaded and the version
 * the registry publishes — and neither adds a third. The marker is the shortest
 * honest form (`↑0.12.0`), and the notice names the command instead of printing
 * a changelog link the notice renderer cannot open.
 */

import { noticeMessage, type NoticeMessage } from "../../../lib/notice.ts";
import { GLYPHS } from "../../../lib/tui/glyphs.ts";

/** The header marker: an up arrow and the newest version, e.g. `↑0.12.0`. */
export function updateMarker(latest: string): string {
	return `${GLYPHS.update}${latest}`;
}

/** The single notice a session posts when a newer version is published. */
export function updateNotice(current: string, latest: string): NoticeMessage {
	return noticeMessage({
		content: `bytefly ${latest} is available (current ${current}). Run \`pi update --extensions\` to update.`,
		details: {
			source: "bytefly",
			title: `${latest} is available`,
			severity: "info",
			items: [
				{ label: "current", detail: `v${current}` },
				{ label: "update", detail: "pi update --extensions" },
			],
		},
	});
}
