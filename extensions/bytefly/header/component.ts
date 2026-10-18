/**
 * The custom header component installed with `ctx.ui.setHeader()`.
 *
 * It draws bytefly's nameplate: a two-tone mark beside the agent identity (Pi
 * and its version) and the chrome identity (the tagline, bytefly, and its
 * version), a signature rule whose accent lead sits under the mark, and a
 * grouped help block. The mark and text are theme-colored through the shared
 * design-system roles, the mark falls back to a wordmark where half blocks do
 * not render, the help keys are resolved live from Pi's keybindings, and every
 * line is truncated to the width it is given.
 */

import { keyText, type Theme, VERSION } from "@earendil-works/pi-coding-agent";
import { type Component, type TUI, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { screenHint } from "../../../lib/tui/chrome.ts";
import { keyHintText } from "../../../lib/tui/glyphs.ts";
import { BODY_INDENT } from "../../../lib/tui/indent.ts";
import { RULE_GLYPH } from "../../../lib/tui/rules.ts";
import { paint } from "../../../lib/tui/tokens.ts";
import { HEADER_CONFIG, type HelpEntry } from "./config.ts";

/** The header's shape, resolved once per apply so `render` stays cheap. */
export interface HeaderView {
	/** Print Pi's version on the agent line. */
	showVersion: boolean;
	/** Whether the terminal renders half blocks; false draws the wordmark instead. */
	halfBlocks: boolean;
	/** Columns of left margin: Pi's output pad, so the nameplate sits on the transcript margin. */
	pad: number;
}

/** The mark block is four columns on both rows, so the identity column aligns. */
const MARK_WIDTH = 4;

/** Pad a themed mark line to the block width with plain spaces. */
function markBlock(line: string): string {
	return line + " ".repeat(Math.max(0, MARK_WIDTH - visibleWidth(line)));
}

/** The two mark lines: the half-block logo, or the wordmark where it will not render. */
function markLines(theme: Theme, halfBlocks: boolean): [string, string] {
	const { markRole, markAccentRole } = HEADER_CONFIG;
	if (halfBlocks) return [paint(theme, markRole, "█▀█"), paint(theme, markAccentRole, "█▀ █")];
	return [paint(theme, markRole, "P") + paint(theme, markAccentRole, "i"), ""];
}

/** One help entry split into the text to print and its description. */
function helpParts(entry: HelpEntry): { key: string; description: string } {
	return "binding" in entry
		? { key: keyText(entry.binding), description: entry.description }
		: { key: entry.raw, description: entry.description };
}

/** The themed header component. */
export class ByteflyHeader implements Component {
	private cachedWidth: number | null = null;
	private cachedTheme: Theme | undefined;
	private cachedView = "";
	private cachedKeys = "";
	private cachedLines: string[] = [];

	constructor(
		private readonly getTheme: () => Theme,
		private readonly view: () => HeaderView,
		private readonly version: string,
	) {}

	invalidate(): void {
		this.cachedWidth = null;
	}

	/**
	 * The header is static, so the lines are memoized on everything they read: the
	 * width, the theme, the resolved shape, and the key chords the help rows print.
	 * `keyText` is re-read every frame, so a live rebind still shows.
	 */
	render(width: number): string[] {
		const w = Math.max(1, width);
		const theme = this.getTheme();
		const view = this.view();
		const viewKey = `${view.showVersion}:${view.halfBlocks}:${view.pad}`;
		const keys = this.keySignature();
		if (
			this.cachedWidth === w &&
			this.cachedTheme === theme &&
			this.cachedView === viewKey &&
			this.cachedKeys === keys
		) {
			return this.cachedLines;
		}
		this.cachedLines = this.build(w, theme, view);
		this.cachedWidth = w;
		this.cachedTheme = theme;
		this.cachedView = viewKey;
		this.cachedKeys = keys;
		return this.cachedLines;
	}

	/** The chord of every help binding, so a rebind repaints the help rows. */
	private keySignature(): string {
		const chords: string[] = [];
		for (const row of HEADER_CONFIG.help) {
			for (const entry of row) chords.push(helpParts(entry).key);
		}
		return chords.join("\u0000");
	}

	private build(w: number, theme: Theme, view: HeaderView): string[] {
		const { nameRole, chromeRole, detailRole, chromeTagline, chromeName, chromeVersion, help } = HEADER_CONFIG;
		const padWidth = Math.max(0, Math.min(Math.floor(view.pad), Math.max(0, w - 1)));
		const pad = " ".repeat(padWidth);
		const [markTop, markBottom] = markLines(theme, view.halfBlocks);

		const version = view.showVersion && this.version ? paint(theme, detailRole, `v${this.version}`) : "";
		// The wordmark mark spells the app name, so the agent cell carries only the
		// version there; the half-block mark does not, so the name stays beside it.
		const agent = view.halfBlocks
			? version
				? `${theme.bold(paint(theme, nameRole, HEADER_CONFIG.appName))} ${version}`
				: theme.bold(paint(theme, nameRole, HEADER_CONFIG.appName))
			: version;
		const chrome = `${paint(theme, detailRole, chromeTagline)} ${paint(theme, chromeRole, chromeName)}`;
		const chromeVersioned = chromeVersion ? `${chrome} ${paint(theme, detailRole, `v${chromeVersion}`)}` : chrome;

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
			this.rule(theme, w, pad),
			...help.map((row) => this.helpLine(theme, w, row, padWidth)),
		];
	}

	/**
	 * The nameplate's signature rule: an accent lead as wide as the mark, so the
	 * rule is anchored to the mark, then a muted fill to the transcript's right
	 * edge. The header stops where the nameplate and turn rules stop, one pad in,
	 * instead of running to the last terminal column.
	 */
	private rule(theme: Theme, width: number, pad: string): string {
		const remaining = Math.max(0, width - pad.length * 2);
		const lead = Math.min(MARK_WIDTH, remaining);
		const fill = remaining - lead;
		return (
			pad +
			paint(theme, HEADER_CONFIG.ruleAccentRole, RULE_GLYPH.repeat(lead)) +
			paint(theme, HEADER_CONFIG.ruleRole, RULE_GLYPH.repeat(fill))
		);
	}

	/** A nameplate row: the padded mark, a gutter, then the identity cell if it survived. */
	private identityLine(pad: string, mark: string, cell: string, width: number): string {
		const line = cell ? `${pad}${markBlock(mark)} ${cell}` : `${pad}${markBlock(mark)}`;
		return truncateToWidth(line.replace(/ +$/, ""), width, "");
	}

	/**
	 * One help group: whole entries only, dropped as the width runs out. The hints
	 * hang one body indent inside the header's margin, like a screen's hint footer
	 * under its title rule.
	 */
	private helpLine(theme: Theme, width: number, row: readonly HelpEntry[], padWidth: number): string {
		const hints = row
			.map(helpParts)
			.filter((part) => part.key)
			.map((part) => keyHintText(theme, part.key, part.description));
		return hints.length > 0 ? screenHint(theme, width, hints, padWidth + BODY_INDENT) : "";
	}
}

/** Header factory passed to `ctx.ui.setHeader`. */
export function createHeader(getTheme: () => Theme, view: () => HeaderView): (tui: TUI, theme: Theme) => Component {
	return () => new ByteflyHeader(getTheme, view, VERSION);
}
