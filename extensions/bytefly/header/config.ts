/**
 * Tuning for bytefly's header.
 *
 * The header is a nameplate: a two-tone mark beside the agent identity (Pi and
 * its version) and the chrome identity (the tagline, bytefly, and its version),
 * a signature rule whose accent lead sits under the mark, and a grouped help
 * block. Every color is a design-system role resolved by the active theme, and
 * the help keys are resolved live from Pi's keybindings, so a rebound key is
 * respected.
 */

import type { AppKeybinding } from "@earendil-works/pi-coding-agent";
import { EXPAND_KEYBINDING } from "../../../lib/tui/glyphs.ts";
import type { TuiRole } from "../../../lib/tui/tokens.ts";
import pkg from "../../../package.json";

/** One help entry: a Pi keybinding resolved live, or a raw key or command prefix. */
export type HelpEntry =
	| { readonly binding: AppKeybinding; readonly description: string }
	| { readonly raw: string; readonly description: string };

/** How much of the help block a terminal height can carry. */
export interface HeaderHeight {
	/** Smallest terminal height, in rows, this shape applies to. Taller tiers come first. */
	readonly minRows: number;
	/** Help groups to print, by index in `help`; a group is dropped whole. */
	readonly helpRows: readonly number[];
	/** Open with a blank row above the nameplate. */
	readonly blank: boolean;
}

/** The header's shape and content. */
export interface HeaderConfig {
	/** The agent's name, shown before its version. */
	readonly appName: string;
	/** Print Pi's version on the agent line. */
	readonly showVersion: boolean;
	/** Role for the mark's top line. */
	readonly markRole: TuiRole;
	/** Role for the mark's bottom line. */
	readonly markAccentRole: TuiRole;
	/** Role for the agent name. */
	readonly nameRole: TuiRole;
	/** Role for the chrome name. */
	readonly chromeRole: TuiRole;
	/** Role for the versions, the tagline, and the help descriptions. */
	readonly detailRole: TuiRole;
	/** Role for the update marker: an action, so the accent rather than a warning colour. */
	readonly updateRole: TuiRole;
	/** Role for the rule's accent lead under the mark. */
	readonly ruleAccentRole: TuiRole;
	/** Role for the rest of the rule. */
	readonly ruleRole: TuiRole;
	/** The tagline before the chrome name, so the relationship reads in words. */
	readonly chromeTagline: string;
	/** The chrome's name. */
	readonly chromeName: string;
	/** The chrome's version, read from the package manifest so it cannot drift. */
	readonly chromeVersion: string;
	/** Grouped help rows, printed one line each under the rule. */
	readonly help: readonly (readonly HelpEntry[])[];
	/**
	 * The height ladder, tallest first: the first tier the terminal meets decides
	 * which help groups print and whether the leading blank row survives. The
	 * floor is `minRows: 0`, so a short terminal keeps the nameplate and rule.
	 */
	readonly heights: readonly HeaderHeight[];
}

export const HEADER_CONFIG: HeaderConfig = {
	appName: "Pi",
	showVersion: true,
	markRole: "accent",
	markAccentRole: "warn",
	nameRole: "label",
	chromeRole: "meta",
	detailRole: "faint",
	updateRole: "accent",
	ruleAccentRole: "accent",
	ruleRole: "rule",
	chromeTagline: "enhanced by",
	chromeName: "bytefly",
	chromeVersion: pkg.version,
	help: [
		[
			{ binding: "app.interrupt", description: "to interrupt" },
			{ binding: "app.clear", description: "to clear" },
			{ binding: "app.exit", description: "to exit (empty)" },
			{ binding: "app.suspend", description: "to suspend" },
		],
		[
			{ binding: EXPAND_KEYBINDING, description: "to expand tools" },
			{ binding: "app.thinking.toggle", description: "to expand thinking" },
			{ binding: "app.model.select", description: "to select model" },
			{ binding: "app.model.cycleForward", description: "to cycle models" },
			{ binding: "app.thinking.cycle", description: "to cycle thinking" },
			{ binding: "app.editor.external", description: "for external editor" },
		],
		[
			{ raw: "/", description: "commands" },
			{ raw: "!", description: "bash" },
			{ raw: "!!", description: "bash (no context)" },
			{ raw: "/bytefly", description: "extensions" },
			{ binding: "app.message.followUp", description: "to queue follow-up" },
			{ binding: "app.clipboard.pasteImage", description: "paste files" },
		],
	],
	heights: [
		{ minRows: 28, helpRows: [0, 1, 2], blank: true },
		{ minRows: 22, helpRows: [0, 2], blank: true },
		{ minRows: 16, helpRows: [2], blank: true },
		{ minRows: 0, helpRows: [], blank: false },
	],
};
