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
import { HEADER_CONFIG, type HeaderHeight, type HelpEntry } from "./config.ts";
import { identityCells } from "./identity.ts";

/** The header's shape: everything but the live terminal height is resolved once per apply. */
export interface HeaderView {
	/** Print Pi's version on the agent line. */
	showVersion: boolean;
	/** Whether the terminal renders half blocks; false draws the wordmark instead. */
	halfBlocks: boolean;
	/** Columns of left margin: Pi's output pad, so the nameplate sits on the transcript margin. */
	pad: number;
	/** Terminal rows, when the host reports them; short terminals shed help rows. */
	rows?: number;
	/** A newer published version of this package, when one is known. */
	latest?: string;
	/** A newer published version of Pi itself, when one is known. */
	piLatest?: string;
}

/** The mark block is four columns on both rows, so the identity column aligns. */
const MARK_WIDTH = 4;

/**
 * The tallest shape whose threshold the terminal meets. An unknown or impossible
 * height keeps the full header, so a host without terminal rows still reads well.
 */
function heightShape(rows: number | undefined): HeaderHeight {
	if (rows === undefined || !Number.isFinite(rows) || rows <= 0) return HEADER_CONFIG.heights[0];
	return HEADER_CONFIG.heights.find((shape) => rows >= shape.minRows) ?? HEADER_CONFIG.heights[0];
}

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
	 * width, the theme the getter returned, the resolved shape, and the key chords
	 * the help rows print. `keyText` is re-read every frame, so a live rebind still
	 * shows.
	 */
	render(width: number): string[] {
		const w = Math.max(1, width);
		const theme = this.getTheme();
		const view = this.view();
		const viewKey = `${view.showVersion}:${view.halfBlocks}:${view.pad}:${view.latest ?? ""}:${view.rows ?? ""}`;
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
		const { help } = HEADER_CONFIG;
		const shape = heightShape(view.rows);
		const padWidth = Math.max(0, Math.min(Math.floor(view.pad), Math.max(0, w - 1)));
		const pad = " ".repeat(padWidth);
		const [markTop, markBottom] = markLines(theme, view.halfBlocks);

		// The identity rows shed as one block, widest pair first: see `identity.ts`.
		const lineWidth = (cell: string): number => pad.length + MARK_WIDTH + (cell ? 1 + visibleWidth(cell) : 0);
		const [agentCell, chromeCell] = identityCells(
			{
				halfBlocks: view.halfBlocks,
				showVersion: view.showVersion,
				version: this.version,
				piLatest: view.piLatest,
				latest: view.latest,
			},
			theme,
		).find(([a, c]) => Math.max(lineWidth(a), lineWidth(c)) <= w) ?? ["", ""];

		// The header owns its leading blank: Pi mounts the built-in header inside
		// `Spacer(1)`s, but the `quietStartup: true` branch that hands this header the
		// screen adds none, and `setHeader` swaps only the header child. A short
		// terminal gives that row back, then sheds whole help groups.
		return [
			...(shape.blank ? [""] : []),
			this.identityLine(pad, markTop, agentCell, w),
			this.identityLine(pad, markBottom, chromeCell, w),
			this.rule(theme, w, pad),
			...shape.helpRows.flatMap((index) => {
				const group = help[index];
				return group ? [this.helpLine(theme, w, group, padWidth)] : [];
			}),
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
export function createHeader(
	getTheme: () => Theme,
	view: (rows: number | undefined) => HeaderView,
): (tui: TUI, theme: Theme) => Component {
	// Read the height on every render, so a terminal resize reflows the header
	// instead of keeping the shape it was installed with. Tests may pass a bare
	// object as the host, so the terminal is optional at the boundary.
	return (tui) => new ByteflyHeader(getTheme, () => view(tui.terminal?.rows), VERSION);
}
