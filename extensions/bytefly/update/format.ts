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
import { sanitizeLine } from "../../../lib/format.ts";
import { noticeMessage, type NoticeItem, type NoticeMessage } from "../../../lib/notice.ts";
import { GLYPHS } from "../../../lib/tui/glyphs.ts";
import type { UpdateOutcome } from "./state.ts";
import type { PackageUpdate, PiRelease } from "./types.ts";

/** The header marker: an up arrow and this package's newest version. */
export function updateMarker(latest: string): string {
	return `${GLYPHS.update}${latest}`;
}

/** The command that resolves every row in the notice. */
export const UPDATE_COMMAND = "pi update --extensions";

/** The command that updates Pi itself. */
export const PI_UPDATE_COMMAND = "pi update";

/** Where Pi publishes its own changelog; Pi hardcodes the same URL in its box. */
export const PI_CHANGELOG_URL = "https://pi.dev/changelog";

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
export function isOwnPackage(update: PackageUpdate): boolean {
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

/** The headline and the package names, the sentence both answers open with. */
function namesLine(updates: readonly PackageUpdate[]): string {
	return `${headline(updates.length)}: ${updates.map((update) => update.displayName).join(", ")}.`;
}

/** The release URL for this package's new version, when it is known. */
function ownRelease(ownLatest?: string): string | undefined {
	return ownLatest ? releaseUrl(ownLatest) : undefined;
}

/** The row that names the command resolving an update. */
function commandRow(command: string): NoticeItem {
	return { label: "update", detail: command };
}

/** The row that names a page the answer points at, e.g. a release or a changelog. */
function linkRow(label: string, url: string): NoticeItem {
	return { label, detail: url };
}

/**
 * The tail both answers end with: the command to run, then where the notes are
 * when they are known. Each caller supplies its own sentence, because the notice
 * is read in the transcript and the re-check answer is read as one printed line.
 */
function actionParts(action: string, release?: string): string[] {
	return release ? [action, `Release notes: ${release}`] : [action];
}

/**
 * The notice that replaces Pi's own `Update Available` box.
 *
 * Pi resolves the release and then draws a bordered warning block; bytefly takes
 * the same release and draws the shared transcript notice, so the news reads like
 * every other bytefly message and states the version movement, the command, and
 * the changelog. `note` is Pi's changelog excerpt when the release API sends one;
 * it is a free-form paragraph, so it is sanitized to a single row rather than
 * given a layout of its own.
 */
export function piReleaseNotice(release: PiRelease, current: string): NoticeMessage {
	const note = release.note?.trim();
	const parts = [
		`Pi v${release.version} is available; this session runs v${current}.`,
		`Run \`${PI_UPDATE_COMMAND}\`.`,
		`Changelog: ${PI_CHANGELOG_URL}`,
	];
	if (note) parts.push(`Release notes: ${note}`);
	return noticeMessage({
		content: parts.join(" "),
		details: {
			source: "bytefly",
			title: `pi v${release.version} is available`,
			severity: "info",
			items: [
				{ label: "pi", detail: `v${current} → v${release.version}` },
				commandRow(PI_UPDATE_COMMAND),
				linkRow("changelog", PI_CHANGELOG_URL),
				...(note ? [{ label: "release notes", detail: sanitizeLine(note) }] : []),
			],
		},
	});
}

/** The single notice a session posts when Pi reports package updates. */
export function updateNotice(updates: readonly PackageUpdate[], current: string, ownLatest?: string): NoticeMessage {
	const own = updates.find(isOwnPackage);
	const release = own ? ownRelease(ownLatest) : undefined;
	const parts = [namesLine(updates)];
	if (own && ownLatest) parts.push(`${pkg.name} v${current} → v${ownLatest}.`);
	parts.push(...actionParts(`Run \`${UPDATE_COMMAND}\` to update.`, release));
	return noticeMessage({
		content: parts.join(" "),
		details: {
			source: "bytefly",
			title: headline(updates.length),
			severity: "info",
			items: [
				...updates.map((update) => packageRow(update, current, ownLatest)),
				commandRow(UPDATE_COMMAND),
				...(release ? [linkRow("release", release)] : []),
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
		case "update-failed":
			return {
				text: `bytefly: the update did not finish — ${sanitizeLine(outcome.reason)}`,
				severity: "warning",
			};
		case "updated":
			return outcome.pending
				? {
						text: `bytefly: the update ran, but a package is still behind — run ${UPDATE_COMMAND} or /bytefly update.`,
						severity: "warning",
					}
				: {
						text: "bytefly: every configured package is updated — reload to use the new version.",
						severity: "info",
					};
		case "available": {
			const own = outcome.updates.some(isOwnPackage);
			const release = own ? ownRelease(outcome.ownLatest) : undefined;
			const parts = [`bytefly: ${namesLine(outcome.updates)}`];
			if (own && outcome.ownLatest) parts.push(`This package is v${current} → v${outcome.ownLatest}.`);
			parts.push(...actionParts(`Run ${UPDATE_COMMAND}.`, release));
			return { text: parts.join(" "), severity: "info" };
		}
	}
}
