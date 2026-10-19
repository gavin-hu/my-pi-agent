/**
 * Wording for the update surface: the header marker, the one transcript notice,
 * and the answer an explicit re-check prints.
 *
 * Pi's package manager decides which configured packages are behind. The marker
 * is still only this package's newest version (`↑0.12.0`); the notice names every
 * package Pi reported and, for this package, the version arrow and release URL
 * the notice renderer can print as text.
 */

import pkg from "../../../package.json";
import { noticeMessage, type NoticeMessage } from "../../../lib/notice.ts";
import { GLYPHS } from "../../../lib/tui/glyphs.ts";
import type { UpdateOutcome } from "./state.ts";
import type { PackageUpdate } from "./types.ts";

/** The header marker: an up arrow and this package's newest version. */
export function updateMarker(latest: string): string {
	return `${GLYPHS.update}${latest}`;
}

/** The command that resolves every row in the notice. */
export const UPDATE_COMMAND = "pi update --extensions";

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

/** Whether a row is this package, whose version the header and notice show. */
function isOwnPackage(update: PackageUpdate): boolean {
	return update.type === "npm" && update.displayName === pkg.name;
}

/** The scope word Pi's package update carries. */
function scopeLabel(update: PackageUpdate): string {
	return update.scope === "project" ? "project" : "global";
}

/** One package row: the version arrow for this package, the scope for the rest. */
function packageRow(
	update: PackageUpdate,
	current: string,
	ownLatest?: string,
): {
	label: string;
	detail: string;
	severity: "info";
} {
	const detail = isOwnPackage(update) && ownLatest ? `v${current} → v${ownLatest}` : scopeLabel(update);
	return { label: update.displayName, detail, severity: "info" };
}

/** The headline shared by the notice and the re-check answer. */
function headline(count: number): string {
	return count === 1 ? "1 package update available" : `${count} package updates available`;
}

/** The release URL for this package's new version, when it is known. */
function ownRelease(ownLatest?: string): string | undefined {
	return ownLatest ? releaseUrl(ownLatest) : undefined;
}

/** The single notice a session posts when Pi reports package updates. */
export function updateNotice(updates: readonly PackageUpdate[], current: string, ownLatest?: string): NoticeMessage {
	const own = updates.find(isOwnPackage);
	const release = own ? ownRelease(ownLatest) : undefined;
	const names = updates.map((update) => update.displayName).join(", ");
	const parts = [`${headline(updates.length)}: ${names}.`];
	if (own && ownLatest) parts.push(`${pkg.name} v${current} → v${ownLatest}.`);
	parts.push(`Run \`${UPDATE_COMMAND}\` to update.`);
	if (release) parts.push(`Release notes: ${release}`);
	return noticeMessage({
		content: parts.join(" "),
		details: {
			source: "bytefly",
			title: headline(updates.length),
			severity: "info",
			items: [
				...updates.map((update) => packageRow(update, current, ownLatest)),
				{ label: "update", detail: UPDATE_COMMAND },
				...(release ? [{ label: "release", detail: release }] : []),
			],
		},
	});
}

/**
 * What `/bytefly update` prints. The background check is silent because nobody
 * asked; here someone did, so a skip, a failure, and an up-to-date answer are
 * answers too.
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
				text: "bytefly: could not check package updates — check the network and try again.",
				severity: "warning",
			};
		case "current":
			return { text: "bytefly: up to date — no configured package has an update.", severity: "info" };
		case "available": {
			const names = outcome.updates.map((update) => update.displayName).join(", ");
			const own = outcome.updates.some(isOwnPackage);
			const release = own ? ownRelease(outcome.ownLatest) : undefined;
			const parts = [`bytefly: ${headline(outcome.updates.length)}: ${names}.`];
			if (own && outcome.ownLatest) parts.push(`This package is v${current} → v${outcome.ownLatest}.`);
			parts.push(`Run ${UPDATE_COMMAND}.`);
			if (release) parts.push(`Release notes: ${release}`);
			return { text: parts.join(" "), severity: "info" };
		}
	}
}
