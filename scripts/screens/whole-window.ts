/**
 * The two frames that are a whole window rather than one component (dev tooling).
 *
 * `screens/index.ts` is the registry of capturable surfaces and `fixtures/` is
 * the data; this module draws the pair that stands for a session: a padded
 * transcript under the header with the footer at the window's bottom. A full
 * frame carries no version of its own except through the header, so the two
 * halves stay here where the bottom margin is computed once.
 *
 * The hero is the chrome frame: one whole turn — the nameplate, the answer, a
 * tool block, the notice, the turn rule, the two rails, and the footer.
 */

import { getMarkdownTheme, VERSION } from "@earendil-works/pi-coding-agent";
import { Editor, KeybindingsManager, Markdown, setKeybindings, Text, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";
import { ToolBlock } from "../../extensions/bytefly/block/component.ts";
import { cacheHitRateOf } from "../../extensions/bytefly/footer/collect/entries.ts";
import { CURRENCY_DEFAULTS, DEFAULT_RATES_USD } from "../../extensions/bytefly/footer/price/config.ts";
import { createPricer } from "../../extensions/bytefly/footer/price/price.ts";
import { DEFAULT_RAIL_GLYPH, railGlyph } from "../../extensions/bytefly/chrome.ts";
import { renderLine } from "../../extensions/bytefly/footer/render/layout.ts";
import { buildLines } from "../../extensions/bytefly/footer/render/lines.ts";
import type { StatusSnapshot } from "../../extensions/bytefly/footer/types.ts";
import { ByteflyHeader } from "../../extensions/bytefly/header/component.ts";
import { nameplate } from "../../extensions/bytefly/message/format.ts";
import { NoticeComponent } from "../../extensions/bytefly/notice/component.ts";
import { DEFAULT_HOST_PAD } from "../../extensions/bytefly/pad.ts";
import { SeparatorComponent } from "../../extensions/bytefly/separator/component.ts";
import { GoalWidget } from "../../extensions/goal/tui.ts";
import { TodoWidget } from "../../extensions/todo/widget.ts";
import { editorTheme } from "../../lib/tui/chrome.ts";
import { GLYPHS, STATUS_KEYS } from "../../lib/tui/glyphs.ts";
import { indentBlockLines } from "../../lib/tui/indent.ts";
import { setThemeInstance, theme } from "../theme.ts";
import { renderingFor } from "../tools/index.ts";
import { TRANSCRIPT_NOTICE } from "../transcript-fixture.ts";
import { DEMO_HOME, DEMO_PROJECT, HERO_GOAL, HERO_TODOS, SCREEN_TUI } from "./fixtures/index.ts";

/** Pi's default app keybindings, so the preview header's help rows resolve. */
const APP_BINDINGS = {
	"app.interrupt": { defaultKeys: "escape", description: "Cancel or abort" },
	"app.clear": { defaultKeys: "ctrl+c", description: "Clear editor" },
	"app.exit": { defaultKeys: "ctrl+d", description: "Exit when editor is empty" },
	"app.suspend": { defaultKeys: "ctrl+z", description: "Suspend to background" },
	"app.tools.expand": { defaultKeys: "ctrl+o", description: "Toggle tool output" },
	"app.thinking.toggle": { defaultKeys: "ctrl+t", description: "Toggle thinking blocks" },
	"app.thinking.cycle": { defaultKeys: "shift+tab", description: "Cycle thinking level" },
	"app.model.cycleForward": { defaultKeys: "ctrl+p", description: "Cycle to next model" },
	"app.model.select": { defaultKeys: "ctrl+l", description: "Open model selector" },
	"app.editor.external": { defaultKeys: "ctrl+g", description: "Open external editor" },
	"app.message.followUp": { defaultKeys: "alt+enter", description: "Queue follow-up message" },
	"app.clipboard.pasteImage": { defaultKeys: "ctrl+v", description: "Paste from clipboard" },
} as const;

/** The tokens the hero's footer reports, and the dollars the shipped rate table charges for them. */
export const HERO_TOKENS = { input: 42_000, output: 8_000, cacheRead: 96_000, cacheWrite: 0 } as const;
/** Two delegated runs from an earlier turn: session-scoped, so the frame's own calls need not add up to it. */
const HERO_DELEGATED_TOKENS = { input: 18_000, output: 2_400, cacheRead: 0, cacheWrite: 0 } as const;

/** The price table a USD-priced session runs: DeepSeek's published dollars, at the USD default precision. */
const HERO_PRICE = {
	currency: CURRENCY_DEFAULTS.USD,
	rates: DEFAULT_RATES_USD,
	// No peak windows: an undated record is charged at the published rate, never discounted.
	peak: { timezone: "Asia/Shanghai", windows: [] },
	// A guardrail a session could plausibly set, so the picture carries the bar's
	// `spent/limit` form rather than a ceiling nobody configured.
	budget: 5,
} as const;

/**
 * The hero's usage, priced by the code that prices a real session.
 *
 * Typed numbers used to disagree with the tokens beside them — `$0.31` for a session the
 * table charges 2.3 cents for — which is the one lie a footer about cost cannot afford.
 */
function pricedTokens(tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }) {
	const record = {
		provider: "deepseek",
		model: "deepseek-flash",
		...tokens,
		recordedCost: 0,
		at: null,
		isAssistant: true,
	};
	const priced = createPricer(HERO_PRICE)([record]);
	return {
		...tokens,
		cost: priced.cost,
		unpriced: priced.unpriced,
		unpricedModels: priced.unpricedModels,
	};
}

/** The preview bar's snapshot, every field populated. */
export const CHROME_SNAPSHOT: StatusSnapshot = {
	cwd: DEMO_PROJECT,
	sessionName: null,
	branch: "main",
	// Plan mode and nothing else: a worktree chip beside `main` was a pair no session has.
	statuses: new Map([[STATUS_KEYS.planMode, `${GLYPHS.plan} plan`]]),
	model: { id: "deepseek-flash", provider: "deepseek", reasoning: false },
	thinkingLevel: "off",
	context: { tokens: 124000, contextWindow: 200000, percent: 62 },
	usage: pricedTokens(HERO_TOKENS),
	currency: CURRENCY_DEFAULTS.USD,
	budget: HERO_PRICE.budget,
	cacheHitRate: cacheHitRateOf(HERO_TOKENS.input, HERO_TOKENS.cacheRead, HERO_TOKENS.cacheWrite),
	providerCount: 1,
	// Two delegated runs, priced separately: the parent `usage` above is unchanged.
	delegation: { runs: 2, usage: pricedTokens(HERO_DELEGATED_TOKENS) },
};

/** The hero's one turn: the question, and the answer that motivates the diff. */
const HERO_PROMPT = "how are you today?";
const HERO_ANSWER = "Feeling warm — `greet` was due a kinder line.";

/**
 * What is half-typed in the composer.
 *
 * A still has no cursor, so the frame should not pretend the line is empty: the next
 * request is the one thing a reader can tell about where the session is going, and it
 * follows from the rails above it.
 */
export const HERO_INPUT = "refresh the captures for the board page";

/** The tool calls the hero draws, in order: the turn rule counts this list, not a number. */
export const HERO_CALLS = ["edit"] as const;

/**
 * Drop the editor's fake-cursor markers.
 *
 * `Editor` emits `ESC _pi:… BEL` sequences so a live terminal can place the cursor inside
 * its own rendering. A capture has no cursor to place, and a still must not carry them.
 */
function stripCursorMarkers(lines: readonly string[]): string[] {
	return lines.map((line) => line.replace(/\u001b_pi:[^\u0007]*\u0007/g, ""));
}

/** The composer, in the slot the host keeps between the rails and the footer. */
function editorLines(width: number): string[] {
	const editor = new Editor(SCREEN_TUI, editorTheme(theme), { paddingX: DEFAULT_HOST_PAD });
	editor.setText(HERO_INPUT);
	editor.focused = false;
	return stripCursorMarkers(editor.render(width));
}

/** The transcript's opening line, for the frame that leaves the nameplate empty. */
const TRANSCRIPT_HINT = "Ready when you are.";

/** The footer block: the two lines every whole-window frame draws at its bottom. */
function footerLines(width: number): string[] {
	return buildLines(CHROME_SNAPSHOT, theme, DEMO_HOME).map((line) => renderLine(line, width, theme));
}

/**
 * Draw the transcript body as one frame: the user nameplate, a tool block, a
 * notice, the turn rule, and the two-line footer. No header, so the frame carries
 * no version string; the hero frame puts a header above it.
 */
export function renderTranscriptFrame(width: number, rows?: number): string[] {
	setThemeInstance(theme);
	setKeybindings(new KeybindingsManager({ ...TUI_KEYBINDINGS, ...APP_BINDINGS }));
	// Draw at Pi's default output pad, so the frame has a real session's margins.
	const pad = DEFAULT_HOST_PAD;
	const lines: string[] = [];

	// The transformer sees the Markdown's content width, not the padded frame.
	const plate = nameplate(width - pad * 2);
	if (plate) lines.push(...new Markdown(plate, pad, 0, getMarkdownTheme()).render(width));
	lines.push("", `${" ".repeat(pad)}${theme.fg("text", TRANSCRIPT_HINT)}`, "");

	// A tool block: the call leads as the headline, the result rails under it.
	lines.push(
		...new ToolBlock(new Text("read src/app.ts", 0, 0), pad, {
			headline: true,
			toolName: "read",
		}).render(width),
	);
	lines.push(
		...new ToolBlock(new Text("const answer = 42;", 0, 0), pad, {
			trimLeading: true,
			rail: railGlyph(theme, "faint", DEFAULT_RAIL_GLYPH),
		}).render(width),
	);
	lines.push("");

	lines.push(...new NoticeComponent(TRANSCRIPT_NOTICE, theme, pad).render(width));
	lines.push("");
	lines.push(
		...new SeparatorComponent({ turn: 3, durationMs: 72_000, tools: HERO_CALLS.length }, theme, pad).render(width),
	);
	lines.push("");

	const footer = footerLines(width);
	// A real session keeps the footer at the bottom of the window, with the
	// transcript growing above it; pad to that shape when the frame has a height.
	if (rows !== undefined) {
		for (let i = 0; i < rows - lines.length - footer.length; i++) lines.push("");
	}
	lines.push(...footer);
	return lines;
}

/**
 * Draw the hero: the header above one whole turn, the two rails in the editor
 * slot, and the footer at the window's bottom.
 */
export function renderHeroFrame(width: number, rows: number): string[] {
	setThemeInstance(theme);
	// The header resolves its help chords through these, so they are installed
	// before it renders rather than inside the body below.
	setKeybindings(new KeybindingsManager({ ...TUI_KEYBINDINGS, ...APP_BINDINGS }));
	const header = new ByteflyHeader(
		() => theme,
		() => ({ showVersion: true, halfBlocks: true, pad: DEFAULT_HOST_PAD }),
		VERSION,
	).render(width);
	const body = heroBody(width);
	// The editor, the rails, and the footer are the window's bottom — in that order, which is
	// the stack Pi keeps — so the spare rows sit between the turn rule and the rails, where a
	// short transcript leaves them.
	const editor = editorLines(width);
	const footer = footerLines(width);
	// A blank row belongs under the header and under the footer: a real window does not run
	// its first message into the hint rows, and its bottom edge is not a line of text.
	const gaps = 2;
	const spare = rows - gaps - header.length - body.lines.length - body.rails.length - editor.length - footer.length;
	for (let i = 0; i < spare; i++) body.lines.push("");
	return [...header, "", ...body.lines, ...body.rails, ...editor, ...footer, ""];
}

/** The hero's transcript and its rails; the footer is placed by the caller. */
function heroBody(width: number): { lines: string[]; rails: string[] } {
	const pad = DEFAULT_HOST_PAD;
	const lines: string[] = [];

	// The user message: the nameplate the pack draws above it, then the prompt.
	const plate = nameplate(width - pad * 2);
	if (plate) lines.push(...new Markdown(plate, pad, 0, getMarkdownTheme()).render(width));
	lines.push("", `${" ".repeat(pad)}${theme.fg("text", HERO_PROMPT)}`, "");

	// The answer, as the assistant's own prose, so its inline code is styled.
	lines.push(...new Markdown(HERO_ANSWER, pad, 0, getMarkdownTheme()).render(width), "");

	// Each call is the tool gallery's own block, built at the width the pad leaves and placed
	// at the transcript margin: one owner for the rendering, and nothing lost to the prefix.
	for (const call of HERO_CALLS) {
		const block = renderingFor(call);
		if (block) lines.push(...indentBlockLines(block.lines(Math.max(1, width - pad)), width, { indent: pad }), "");
	}

	// The turn rule follows the notice directly: the notice is the turn's last block, and the
	// row a gap would spend is the one keeping the rails off the rule.
	lines.push(...new NoticeComponent(TRANSCRIPT_NOTICE, theme, pad).render(width));
	lines.push(
		...new SeparatorComponent({ turn: 3, durationMs: 72_000, tools: HERO_CALLS.length }, theme, pad).render(width),
	);

	// Goal above todo, as the host's rail order puts them, each one line at the
	// margin the widget itself draws (a rail is label-first and glyph-free).
	const rails = [...new GoalWidget(HERO_GOAL, theme).render(width), ...new TodoWidget(HERO_TODOS, theme).render(width)];
	return { lines, rails };
}
