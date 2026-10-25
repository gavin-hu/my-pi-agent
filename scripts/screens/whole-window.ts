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
import { KeybindingsManager, Markdown, setKeybindings, Text, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";
import { ToolBlock } from "../../extensions/bytefly/block/component.ts";
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
import { TodoWidget } from "../../extensions/todo/tui.ts";
import { GLYPHS, STATUS_KEYS } from "../../lib/tui/glyphs.ts";
import { indentBlockLines } from "../../lib/tui/indent.ts";
import { setThemeInstance, theme } from "../theme.ts";
import { renderingFor } from "../tools/index.ts";
import { TRANSCRIPT_NOTICE } from "../transcript-fixture.ts";
import { DEMO_HOME, DEMO_PROJECT, HERO_GOAL, HERO_TODOS } from "./fixtures/index.ts";

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

/** The preview bar's snapshot, every field populated. */
const CHROME_SNAPSHOT: StatusSnapshot = {
	cwd: DEMO_PROJECT,
	sessionName: null,
	branch: "main",
	statuses: new Map([
		[STATUS_KEYS.planMode, `${GLYPHS.plan} plan`],
		[STATUS_KEYS.worktree, `${GLYPHS.worktree} smoke`],
	]),
	model: { id: "deepseek-flash", provider: "deepseek", reasoning: false },
	thinkingLevel: "off",
	context: { tokens: 124000, contextWindow: 200000, percent: 62 },
	usage: { input: 42000, output: 8000, cacheRead: 96000, cacheWrite: 0, cost: 0.31 },
	currency: { code: "USD", decimals: 2 },
	cacheHitRate: 87,
	providerCount: 1,
	// Two delegated runs, priced separately: the parent `usage` above is unchanged.
	delegation: {
		runs: 2,
		usage: { input: 18000, output: 2400, cacheRead: 0, cacheWrite: 0, cost: 0.06 },
	},
};

/** The hero's one turn: the question, and the answer that motivates the diff. */
const HERO_PROMPT = "how are you today?";
const HERO_ANSWER = "Feeling warm — `greet` was due a kinder line.";

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
	lines.push(...new SeparatorComponent({ turn: 3, durationMs: 72_000, tools: 7 }, theme, pad).render(width));
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
	// The rails and the footer are the window's bottom, so the spare rows sit
	// between the turn rule and the rails, where a short transcript leaves them.
	const footer = footerLines(width);
	const spare = rows - header.length - body.lines.length - body.rails.length - footer.length;
	for (let i = 0; i < spare; i++) body.lines.push("");
	return [...header, ...body.lines, ...body.rails, ...footer];
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

	// The diff is the tool gallery's own block, built at the width the pad leaves
	// and placed at the transcript margin: one owner for the edit rendering, and
	// nothing lost to the prefix.
	const edit = renderingFor("edit");
	if (edit) lines.push(...indentBlockLines(edit.lines(Math.max(1, width - pad)), width, { indent: pad }), "");

	lines.push(...new NoticeComponent(TRANSCRIPT_NOTICE, theme, pad).render(width));
	lines.push("");
	lines.push(...new SeparatorComponent({ turn: 3, durationMs: 72_000, tools: 7 }, theme, pad).render(width));

	// Goal above todo, as the host's rail order puts them, each one line at the
	// margin the widget itself draws (a rail is label-first and glyph-free).
	const rails = [...new GoalWidget(HERO_GOAL, theme).render(width), ...new TodoWidget(HERO_TODOS, theme).render(width)];
	return { lines, rails };
}
