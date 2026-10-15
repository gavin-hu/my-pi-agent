/**
 * Tuning for bytefly's header.
 *
 * The header is a nameplate: a two-tone mark beside the agent identity (Pi and
 * its version) and the chrome identity (the tagline, bytefly, and its version),
 * a `─` rule, and a grouped help block. The mark and the text are drawn from the
 * active theme's tokens, and the help keys are resolved live from Pi's
 * keybindings, so a rebound key is respected.
 */

import type { AppKeybinding, ThemeColor } from "@earendil-works/pi-coding-agent";
import pkg from "../../../package.json";
import { EXPAND_KEYBINDING } from "../../../lib/ui.ts";

/** One help entry: a Pi keybinding resolved live, or a raw key or command prefix. */
export type HelpEntry =
	| { readonly binding: AppKeybinding; readonly description: string }
	| { readonly raw: string; readonly description: string };

/** The header's shape and content. */
export interface HeaderConfig {
	/** The agent's name, shown before its version. */
	readonly appName: string;
	/** Print Pi's version on the agent line. */
	readonly showVersion: boolean;
	/** Theme token for the mark's top line. */
	readonly markColor: ThemeColor;
	/** Theme token for the mark's bottom line. */
	readonly markAccent: ThemeColor;
	/** Theme token for the agent and chrome names. */
	readonly nameColor: ThemeColor;
	/** Theme token for the versions, the tagline, and the help descriptions. */
	readonly versionColor: ThemeColor;
	/** Columns of left padding, matching Pi's built-in header indent. */
	readonly padX: number;
	/** The tagline before the chrome name, so the relationship reads in words. */
	readonly chromeTagline: string;
	/** The chrome's name. */
	readonly chromeName: string;
	/** The chrome's version, read from the package manifest so it cannot drift. */
	readonly chromeVersion: string;
	/** Grouped help rows, printed one line each under the rule. */
	readonly help: readonly (readonly HelpEntry[])[];
}

export const HEADER_CONFIG: HeaderConfig = {
	appName: "Pi",
	showVersion: true,
	markColor: "accent",
	markAccent: "warning",
	nameColor: "muted",
	versionColor: "dim",
	padX: 1,
	chromeTagline: "enhanced by",
	chromeName: "bytefly",
	chromeVersion: pkg.version,
	help: [
		[
			{ binding: "app.interrupt", description: "to interrupt" },
			{ binding: "app.clear", description: "to clear" },
			{ binding: "app.exit", description: "to exit" },
			{ binding: "app.suspend", description: "to suspend" },
		],
		[
			{ binding: EXPAND_KEYBINDING, description: "more" },
			{ binding: "app.thinking.toggle", description: "to think" },
			{ binding: "app.model.select", description: "models" },
			{ binding: "app.editor.external", description: "editor" },
		],
		[
			{ raw: "/", description: "commands" },
			{ raw: "!", description: "bash" },
			{ raw: "/bytefly", description: "extensions" },
			{ raw: "/doctor", description: "checks" },
		],
	],
};
