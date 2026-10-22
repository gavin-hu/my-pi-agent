/**
 * The header's two identity cells and the ladder that sheds them.
 *
 * The nameplate's first row names Pi and its version, the second the tagline,
 * bytefly, and its version, and either row may end with the `↑<version>` marker
 * of a newer published release. The cells shed as one block when the terminal
 * narrows, so the order is data here rather than a state table inside `build()`:
 * the widest pair first, then the chrome marker, the chrome version, the chrome
 * line, and finally the agent's own marker with the agent row itself.
 *
 * Pure: the theme is passed in and every returned string is painted, so a caller
 * only measures and mounts them.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { paint } from "../../../lib/tui/tokens.ts";
import { updateMarker } from "../update/format.ts";
import { HEADER_CONFIG } from "./config.ts";

/** What the cells are built from: the live view's switches and the known versions. */
export interface IdentityInput {
	/** Whether the terminal renders half blocks; the wordmark mark spells the app name. */
	halfBlocks: boolean;
	/** Print Pi's version on the agent line. */
	showVersion: boolean;
	/** Pi's running version. */
	version: string;
	/** Pi's newer published version, when one is known. */
	piLatest?: string;
	/** This package's newer published version, when one is known. */
	latest?: string;
}

/** A marker cell suffix, or nothing when no newer version is known. */
function markerSuffix(theme: Theme, version: string | undefined): string {
	return version ? ` ${paint(theme, HEADER_CONFIG.updateRole, updateMarker(version))}` : "";
}

/**
 * The identity pairs, widest first, with each pair that repeats its predecessor
 * dropped so the ladder names a state only when it is actually narrower.
 */
export function identityCells(input: IdentityInput, theme: Theme): Array<readonly [string, string]> {
	const { nameRole, chromeRole, detailRole, appName, chromeTagline, chromeName, chromeVersion } = HEADER_CONFIG;
	const version = input.showVersion && input.version ? paint(theme, detailRole, `v${input.version}`) : "";
	// The wordmark mark spells the app name, so the agent cell carries only the
	// version there; the half-block mark does not, so the name stays beside it.
	const agent = input.halfBlocks
		? version
			? `${theme.bold(paint(theme, nameRole, appName))} ${version}`
			: theme.bold(paint(theme, nameRole, appName))
		: version;
	const chrome = `${paint(theme, detailRole, chromeTagline)} ${paint(theme, chromeRole, chromeName)}`;
	const chromeWithVersion = chromeVersion ? `${chrome} ${paint(theme, detailRole, `v${chromeVersion}`)}` : chrome;
	const chromeWithMarker = `${chromeWithVersion}${markerSuffix(theme, input.latest)}`;
	const agentWithMarker = `${agent}${markerSuffix(theme, input.piLatest)}`;

	const states: Array<readonly [string, string]> = [];
	const shed = (agentCell: string, chromeCell: string): void => {
		const last = states.at(-1);
		if (last && last[0] === agentCell && last[1] === chromeCell) return;
		states.push([agentCell, chromeCell]);
	};
	shed(agentWithMarker, chromeWithMarker);
	shed(agentWithMarker, chromeWithVersion);
	shed(agentWithMarker, chrome);
	shed(agentWithMarker, "");
	shed(agent, "");
	shed("", "");
	return states;
}
