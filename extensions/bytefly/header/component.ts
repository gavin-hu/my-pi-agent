/**
 * The custom header component installed with `ctx.ui.setHeader()`.
 *
 * It draws bytefly's nameplate: a two-tone mark beside the agent identity (Pi
 * and its version) and the chrome identity (the tagline, bytefly, and its
 * version), a `─` rule, and a grouped help block. The mark is theme-colored and
 * falls back to a wordmark where half blocks do not render, the help keys are
 * resolved live from Pi's keybindings, and every line is truncated to the width
 * it is given.
 */

import { keyText, type Theme, VERSION } from "@earendil-works/pi-coding-agent";
import { type Component, type TUI, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { screenHint } from "../../../lib/tui.ts";
import { keyHintText } from "../../../lib/ui.ts";
import { HEADER_CONFIG, type HelpEntry } from "./config.ts";

/** The header's shape, resolved once per apply so `render` stays cheap. */
export interface HeaderView {
	/** Print Pi's version on the agent line. */
	showVersion: boolean;
	/** Whether the terminal renders half blocks; false draws the wordmark instead. */
	halfBlocks: boolean;
}

/** The mark block is four columns on both rows, so the identity column aligns. */
const MARK_WIDTH = 4;

/** Pad a themed mark line to the block width with plain spaces. */
function markBlock(line: string): string {
	return line + " ".repeat(Math.max(0, MARK_WIDTH - visibleWidth(line)));
}

/** The two mark lines: the half-block logo, or the wordmark where it will not render. */
function markLines(theme: Theme, halfBlocks: boolean): [string, string] {
	const { markColor, markAccent } = HEADER_CONFIG;
	if (halfBlocks) return [theme.fg(markColor, "█▀█"), theme.fg(markAccent, "█▀ █")];
	return [theme.fg(markColor, "P") + theme.fg(markAccent, "i"), ""];
}

/** One help entry split into the text to print and its description. */
function helpParts(entry: HelpEntry): { key: string; description: string } {
	return "binding" in entry
		? { key: keyText(entry.binding), description: entry.description }
		: { key: entry.raw, description: entry.description };
}

/** The themed header component. */
export class ByteflyHeader implements Component {
	constructor(
		private readonly getTheme: () => Theme,
		private readonly view: () => HeaderView,
		private readonly version: string,
	) {}

	invalidate(): void {
		// Every themed string is built in `render` from the live theme.
	}

	render(width: number): string[] {
		const w = Math.max(1, width);
		const theme = this.getTheme();
		const view = this.view();
		const { padX, nameColor, versionColor, chromeTagline, chromeName, chromeVersion, help } = HEADER_CONFIG;
		const pad = " ".repeat(Math.min(padX, Math.max(0, w - 1)));
		const [markTop, markBottom] = markLines(theme, view.halfBlocks);

		const agent =
			view.showVersion && this.version
				? `${theme.fg(nameColor, HEADER_CONFIG.appName)} ${theme.fg(versionColor, `v${this.version}`)}`
				: theme.fg(nameColor, HEADER_CONFIG.appName);
		const chrome = `${theme.fg(versionColor, chromeTagline)} ${theme.fg(nameColor, chromeName)}`;
		const chromeVersioned = chromeVersion ? `${chrome} ${theme.fg(versionColor, `v${chromeVersion}`)}` : chrome;

		// The identity rows shed as one block: chrome version, chrome line, agent.
		const states: Array<readonly [string, string]> = [
			[agent, chromeVersioned],
			[agent, chrome],
			[agent, ""],
			["", ""],
		];
		const lineWidth = (cell: string): number => pad.length + MARK_WIDTH + (cell ? 1 + visibleWidth(cell) : 0);
		const [agentCell, chromeCell] = states.find(([a, c]) => Math.max(lineWidth(a), lineWidth(c)) <= w) ?? ["", ""];

		return [
			this.identityLine(pad, markTop, agentCell, w),
			this.identityLine(pad, markBottom, chromeCell, w),
			`${pad}${theme.fg("borderMuted", "─".repeat(Math.max(0, w - pad.length)))}`,
			...help.map((row) => this.helpLine(theme, w, row)),
		];
	}

	/** A nameplate row: the padded mark, a gutter, then the identity cell if it survived. */
	private identityLine(pad: string, mark: string, cell: string, width: number): string {
		const line = cell ? `${pad}${markBlock(mark)} ${cell}` : `${pad}${markBlock(mark)}`;
		return truncateToWidth(line.replace(/ +$/, ""), width, "");
	}

	/** One help group: whole entries only, dropped as the width runs out. */
	private helpLine(theme: Theme, width: number, row: readonly HelpEntry[]): string {
		const hints = row
			.map(helpParts)
			.filter((part) => part.key)
			.map((part) => keyHintText(theme, part.key, part.description));
		return hints.length > 0 ? screenHint(theme, width, hints) : "";
	}
}

/** Header factory passed to `ctx.ui.setHeader`. */
export function createHeader(getTheme: () => Theme, view: () => HeaderView): (tui: TUI, theme: Theme) => Component {
	return () => new ByteflyHeader(getTheme, view, VERSION);
}
