/**
 * Shared UI vocabulary: status-chip glyphs, separators, status keys, and the
 * expand-toggle keybinding id.
 *
 * The bytefly extension routes and re-renders the chips these extensions publish, so
 * the glyph and the `ctx.ui.setStatus` key must agree across both sides. Keep
 * the literals here and import them, never re-type them.
 */

import { keyText, type Theme } from "@earendil-works/pi-coding-agent";
import { paint } from "./tokens.ts";

/**
 * Leading glyphs for status chips, footer segments, and transcript rails.
 *
 * A glyph is a single terminal column: never wide, fullwidth, or emoji, which
 * are two columns in every profile. East-Asian *ambiguous* glyphs are allowed —
 * a CJK-width profile draws those two columns, so one costs a column there, but
 * the vocabulary is no longer limited to narrow/neutral characters. Add a glyph
 * only after checking its `East_Asian_Width` against `EastAsianWidth.txt`;
 * `lib/tui/glyphs.test.ts` bans wide, fullwidth, and emoji.
 */
export const GLYPHS = {
	branch: "⎇",
	detached: "⚠",
	worktree: "⑂",
	rewind: "↺",
	snapshot: "⬥",
	plan: "≡",
	lead: "⏵",
	jobsRunning: "▸",
	jobsFailure: "✗",
	stopped: "⊘",
	http: "◉",
	delegation: "↳",
	wechat: "✆",
	gaugeFull: "▰",
	gaugeEmpty: "▱",
	turnRule: "╌",
	divider: "╎",
	changed: "·",
	check: "✓",
	warn: "!",
	cross: "✕",
	disabled: "∅",
	half: "◒",
	pending: "◌",
	target: "⊚",
	killed: "⊝",
	unknown: "?",
	boxOn: "◼",
	boxOff: "◻",
	prev: "‹",
	next: "›",
	update: "↑",
	autoMode: "▶",
	prompt: "❯",
} as const;

/** Columns between a rail body glyph and its text. */
export const GLYPH_GAP = 1;

/**
 * The state-change arrow: `memory → add (project)`, `→ clear list`.
 *
 * Two jobs, one literal. Between two states it is a {@link SEPARATORS} join; leading a call's
 * argument (`→ clear`, `→ 3/5`) it has no left-hand state to join, so the call site keeps its
 * own spacing. U+2192 is East-Asian *A (ambiguous)* — the class this module allows, along with
 * `▸`, `⊚` and `›` — so it is one column by default and two under a CJK-width profile, the
 * same trade every glyph here makes. `lib/tui/components.test.ts` holds its width and states
 * the class, so a hand-copied wide arrow fails there.
 */
export const ARROW = "→";

/** Padding used to join UI segments. */
export const SEPARATORS = {
	item: " · ",
	/** Between two states, spaced on both sides: `billing-core → #12`. */
	arrow: ` ${ARROW} `,
} as const;

/** `ctx.ui.setStatus` keys; one per extension that publishes a chip. */
export const STATUS_KEYS = {
	worktree: "worktree",
	planMode: "plan-mode",
	leadMode: "lead-mode",
	jobs: "jobs",
	jobsFailure: "jobs-failure",
	watch: "watch",
	watchMatches: "watch-matches",
	http: "http",
	rewind: "rewind",
	agents: "agents",
	wechat: "wechat",
} as const;

/**
 * The keys a session's mode publishes its chip under, in the order the footer
 * prefers them: plan first, because its guarantee is the stronger one and a stale
 * chip must not advertise a weaker mode.
 *
 * One list rather than a field per key in the footer, so a third mode is one row
 * here and the bar and the mode reader cannot disagree about which keys are modes.
 */
export const MODE_STATUS_KEYS = [STATUS_KEYS.planMode, STATUS_KEYS.leadMode] as const;

/**
 * Keybinding id for Pi's built-in expand toggle (`ctrl+o` by default). Bind a
 * collapse hint to it through `keyText` rather than retyping the key, so a
 * rebound key is respected.
 */
export const EXPAND_KEYBINDING = "app.tools.expand";

/** The bound expand key, in the faint role, or `""` when the binding is unknown. */
export function expandKey(theme: Theme): string {
	const key = keyText(EXPAND_KEYBINDING);
	return key ? paint(theme, "faint", key) : "";
}

/**
 * Pi's key-hint format: the key faint, its description meta. An unbound key
 * (`""`) yields `""`, so a hint never prints a stray description.
 */
export function keyHintText(theme: Theme, key: string, description: string): string {
	return key ? paint(theme, "faint", key) + paint(theme, "meta", ` ${description}`) : "";
}

/**
 * The built-in-style expand affordance: a meta `(ctrl+o to expand)` with the
 * key in faint. Degrades to `(to expand)` when the binding is unknown.
 *
 * The hint says `expand`, not "this block": the key flips Pi's global
 * `app.tools.expand`, so one press expands every tool block in the transcript,
 * and a block that is the only collapsed one is not the only one it changes.
 *
 * @see EXPAND_KEYBINDING
 */
export function expandHint(theme: Theme): string {
	const hint = keyHintText(theme, keyText(EXPAND_KEYBINDING), "to expand)");
	return paint(theme, "meta", "(") + (hint || paint(theme, "meta", "to expand)"));
}
