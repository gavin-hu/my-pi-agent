/**
 * Wording for the update check: the header marker, the one transcript notice, and
 * the answer an explicit re-check prints.
 *
 * All three read the same two facts — the version this session loaded and the
 * version the registry publishes — and none adds a third. The marker is the
 * shortest honest form (`↑0.12.0`); the notice names the command and the release
 * URL as text, because the notice renderer has no link support; and the re-check
 * says what it just found, including the two cases it cannot answer (offline, and
 * a registry it could not read).
 */

import pkg from "../../../package.json";
import { noticeMessage, type NoticeMessage } from "../../../lib/notice.ts";
import { GLYPHS } from "../../../lib/tui/glyphs.ts";
import type { UpdateOutcome } from "./state.ts";

/** The header marker: an up arrow and the newest version, e.g. `↑0.12.0`. */
export function updateMarker(latest: string): string {
	return `${GLYPHS.update}${latest}`;
}

/**
 * The release page for a version, or `undefined` when this checkout does not name
 * a GitHub repository. Derived from `package.json` so a rename cannot leave a dead
 * link behind in the notice.
 */
export function releaseUrl(version: string): string | undefined {
	const url = (pkg.repository as { url?: string } | undefined)?.url ?? "";
	const base = url.replace(/\.git$/, "");
	if (!/^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(base)) return undefined;
	return `${base}/releases/tag/v${version}`;
}

/** The single notice a session posts when a newer version is published. */
export function updateNotice(current: string, latest: string): NoticeMessage {
	const release = releaseUrl(latest);
	const command = "pi update --extensions";
	return noticeMessage({
		content:
			`bytefly ${latest} is available (current ${current}). Run \`${command}\` to update.` +
			(release ? ` Release notes: ${release}` : ""),
		details: {
			source: "bytefly",
			title: `${latest} is available`,
			severity: "info",
			items: release
				? [
						{ label: "current", detail: `v${current}` },
						{ label: "update", detail: command },
						{ label: "release", detail: release },
					]
				: [
						{ label: "current", detail: `v${current}` },
						{ label: "update", detail: command },
					],
		},
	});
}

/**
 * What `/bytefly update` prints. The background check is silent because nobody
 * asked; here someone did, so a skip and a failed read are answers too.
 */
export function updateOutcomeText(
	outcome: UpdateOutcome,
	current: string,
): { text: string; severity: "info" | "warning" } {
	switch (outcome.kind) {
		case "offline":
			return { text: "bytefly: the update check was skipped (PI_OFFLINE is set).", severity: "info" };
		case "failed":
			return {
				text: "bytefly: could not read the published version — check the network and try again.",
				severity: "warning",
			};
		case "current":
			return { text: `bytefly: up to date — v${outcome.latest} is the newest published version.`, severity: "info" };
		case "available": {
			const release = releaseUrl(outcome.latest);
			return {
				text: `bytefly: v${outcome.latest} is available (current ${current}).${release ? ` ${release}` : ""}`,
				severity: "info",
			};
		}
	}
}
