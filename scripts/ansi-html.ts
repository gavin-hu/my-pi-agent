/**
 * ANSI SGR to HTML, for the headless-Chrome captures (dev tooling).
 *
 * The tool-rendering gallery is one tall page, so it is captured with headless
 * Chrome rather than a Terminal window. The renderers emit truecolor SGR through
 * the active theme, so this converts that stream into escaped HTML with inline
 * styles — no CSS palette to keep in sync — and drops the OSC and non-SGR CSI
 * sequences a `<pre>` cannot carry.
 *
 * Value-only: pure functions, no module state.
 */

import { escapeHtml } from "../lib/escape.ts";
import { pageColors } from "./theme.ts";

/** The style a run of text carries; every field is absent when inherited. */
export interface AnsiStyle {
	/** `#rrggbb`, or absent for the inherited colour. */
	fg?: string;
	/** `#rrggbb`, or absent for a transparent background. */
	bg?: string;
	bold?: boolean;
	dim?: boolean;
	italic?: boolean;
	underline?: boolean;
	strike?: boolean;
	inverse?: boolean;
}

/** A styled run of text. */
export interface AnsiSpan {
	text: string;
	style: AnsiStyle;
}

/** OSC (a window title, a palette poke) — nothing a `<pre>` can show. */
const OSC = /\x1b\][\s\S]*?(?:\x07|\x1b\\)/g;
/** Any CSI sequence; only the `m` (SGR) final byte carries style. */
const CSI = /\x1b\[([0-9;]*)([A-Za-z])/g;

/** The style keys, so a reset can clear exactly them. */
const STYLE_KEYS = ["fg", "bg", "bold", "dim", "italic", "underline", "strike", "inverse"] as const;

/** The xterm 16-colour palette, for the `30–37` / `90–97` codes. */
const BASIC = [
	"#000000",
	"#cd0000",
	"#00cd00",
	"#cdcd00",
	"#0000ee",
	"#cd00cd",
	"#00cdcd",
	"#e5e5e5",
	"#7f7f7f",
	"#ff0000",
	"#00ff00",
	"#ffff00",
	"#5c5cff",
	"#ff00ff",
	"#00ffff",
	"#ffffff",
];

/**
 * The captured page's own colours, from the theme the capture draws with:
 * reverse video swaps a cell's foreground and background, so a run with neither
 * falls back to the page it is drawn on.
 */
const PAGE_BACKGROUND = pageColors.background;
const PAGE_TEXT = pageColors.text;

/** `#rrggbb` from three channels, clamped to a byte. */
function rgb(red: number | undefined, green: number | undefined, blue: number | undefined): string {
	const channel = (value: number | undefined): string =>
		Math.max(0, Math.min(255, Math.round(value ?? 0)))
			.toString(16)
			.padStart(2, "0");
	return `#${channel(red)}${channel(green)}${channel(blue)}`;
}

/** The xterm 256-colour entry `n` as `#rrggbb`. */
function palette256(index: number): string {
	const n = Math.max(0, Math.min(255, Math.floor(index)));
	if (n < 16) return BASIC[n] ?? "#ffffff";
	if (n < 232) {
		const cube = n - 16;
		const level = (value: number): number => (value === 0 ? 0 : 55 + value * 40);
		return rgb(level(Math.floor(cube / 36)), level(Math.floor((cube % 36) / 6)), level(cube % 6));
	}
	const grey = 8 + (n - 232) * 10;
	return rgb(grey, grey, grey);
}

/** Apply one SGR parameter list to a style, returning the new style. */
function applySgr(style: AnsiStyle, params: string): AnsiStyle {
	const codes = params.split(";").map((part) => (part.trim() === "" ? 0 : Number(part)));
	const next: AnsiStyle = { ...style };
	const setFg = (value: string | undefined): void => {
		if (value === undefined) delete next.fg;
		else next.fg = value;
	};
	const setBg = (value: string | undefined): void => {
		if (value === undefined) delete next.bg;
		else next.bg = value;
	};
	for (let i = 0; i < codes.length; i++) {
		const code = codes[i] ?? 0;
		if (code === 0) {
			for (const key of STYLE_KEYS) delete next[key];
		} else if (code === 1) next.bold = true;
		else if (code === 2) next.dim = true;
		else if (code === 3) next.italic = true;
		else if (code === 4) next.underline = true;
		else if (code === 7) next.inverse = true;
		else if (code === 9) next.strike = true;
		else if (code === 22) {
			next.bold = false;
			next.dim = false;
		} else if (code === 23) next.italic = false;
		else if (code === 24) next.underline = false;
		else if (code === 27) next.inverse = false;
		else if (code === 29) next.strike = false;
		else if (code === 39) setFg(undefined);
		else if (code === 49) setBg(undefined);
		else if (code >= 30 && code <= 37) setFg(BASIC[code - 30]);
		else if (code >= 90 && code <= 97) setFg(BASIC[code - 90 + 8]);
		else if (code >= 40 && code <= 47) setBg(BASIC[code - 40]);
		else if (code >= 100 && code <= 107) setBg(BASIC[code - 100 + 8]);
		else if (code === 38 || code === 48) {
			const set = code === 38 ? setFg : setBg;
			const mode = codes[i + 1];
			if (mode === 2) {
				set(rgb(codes[i + 2], codes[i + 3], codes[i + 4]));
				i += 4;
			} else if (mode === 5) {
				set(palette256(codes[i + 2] ?? 0));
				i += 2;
			}
		}
	}
	return next;
}

/**
 * Split `input` into styled runs. OSC is dropped, a non-SGR CSI is dropped, and
 * every character keeps the style in effect where it appears.
 */
export function parseAnsi(input: string): AnsiSpan[] {
	const text = input.replace(OSC, "");
	const spans: AnsiSpan[] = [];
	let style: AnsiStyle = {};
	let last = 0;
	CSI.lastIndex = 0;
	for (let match = CSI.exec(text); match; match = CSI.exec(text)) {
		if (match.index > last) spans.push({ text: text.slice(last, match.index), style });
		last = match.index + match[0].length;
		if (match[2] === "m") style = applySgr(style, match[1] ?? "");
	}
	if (last < text.length) spans.push({ text: text.slice(last), style });
	return spans.filter((span) => span.text.length > 0);
}

/** The inline `style` value for a run, or `""` when nothing is set. */
export function cssFor(style: AnsiStyle): string {
	// Reverse video swaps the cell's colours, so the text takes the background's
	// colour and the background the text's. `invert(1)` would invert the glyph
	// alone, which is what the terminal does not do.
	const fg = style.inverse ? (style.bg ?? PAGE_BACKGROUND) : style.fg;
	const bg = style.inverse ? (style.fg ?? PAGE_TEXT) : style.bg;
	const parts: string[] = [];
	if (fg) parts.push(`color:${fg}`);
	if (bg) parts.push(`background-color:${bg}`);
	if (style.bold) parts.push("font-weight:600");
	if (style.dim) parts.push("opacity:.6");
	if (style.italic) parts.push("font-style:italic");
	const decoration: string[] = [];
	if (style.underline) decoration.push("underline");
	if (style.strike) decoration.push("line-through");
	if (decoration.length > 0) parts.push(`text-decoration:${decoration.join(" ")}`);
	return parts.join(";");
}

/** One line of ANSI to escaped HTML. */
export function ansiToHtml(input: string): string {
	return parseAnsi(input)
		.map((span) => {
			const body = escapeHtml(span.text);
			const css = cssFor(span.style);
			return css ? `<span style="${css}">${body}</span>` : body;
		})
		.join("");
}

/** A block of ANSI lines to escaped HTML, one line per `\n`. */
export function ansiLinesToHtml(lines: readonly string[]): string {
	return lines.map((line) => ansiToHtml(line)).join("\n");
}
