/**
 * Shared UI vocabulary: status-chip glyphs, separators, status keys, and the
 * expand-toggle keybinding id.
 *
 * The bytefly extension routes and re-renders the chips these extensions publish, so
 * the glyph and the `ctx.ui.setStatus` key must agree across both sides. Keep
 * the literals here and import them, never re-type them.
 *
 * Four rules, and each is a gate rather than a wish:
 *
 * - **One column.** Never wide, fullwidth, or emoji, which are two columns in
 *   every profile; East-Asian *ambiguous* glyphs are allowed, and a CJK-width
 *   profile draws those two, so the class is recorded rather than assumed.
 * - **One meaning.** No two glyphs may say the same thing, which is what a
 *   distinctness test on the literals cannot see: `⏵` and `▶` were two shapes
 *   that both said "go".
 * - **One ink per family.** A slot's glyphs read as one weight, because a
 *   filled mark and a hairline one beside each other look like two vocabularies.
 * - **One shape may serve several jobs.** The literal is spelled once with
 *   `also`, the way {@link ARROW} is both a join and a cue.
 *
 * `GLYPHS` owns each literal; {@link GLYPH_SPECS} the facts about it, and its
 * mapped type holds the two together — a glyph without a record, or a record
 * without a glyph, does not compile.
 */

import { keyText, type Theme } from "@earendil-works/pi-coding-agent";
import { paint } from "./tokens.ts";

/**
 * Leading glyphs for status chips, footer segments, and transcript rails.
 *
 * A glyph is a single terminal column, and its measured class is recorded in
 * {@link GLYPH_SPECS} — `neutral` and `narrow` are one column in every profile,
 * `ambiguous` is two under a CJK-width profile. Add a glyph only after checking
 * its `East_Asian_Width` against `EastAsianWidth.txt`, and add its record in the
 * same edit: `lib/tui/glyphs.test.ts` holds the recorded class against the
 * measured one.
 */
export const GLYPHS = {
	branch: "⎇",
	detached: "⚠",
	worktree: "⑂",
	rewind: "↺",
	snapshot: "⬥",
	arrow: "→",
	plan: "≡",
	lead: "⚑",
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
	ruleFill: "─",
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
	foldOpen: "▾",
	prev: "‹",
	next: "›",
	update: "↑",
	hintDown: "↓",
	reload: "⟳",
	edit: "✎",
	autoMode: "▶",
	prompt: "❯",
} as const;

/** Every glyph name the vocabulary knows. */
export type GlyphName = keyof typeof GLYPHS;

/**
 * How much ink a glyph puts in its cell.
 *
 * The class is a reading property, not decoration: a row that alternates a
 * filled shape with a hairline one reads as two vocabularies, so a slot picks
 * one ink for its family and the records keep it.
 */
export type GlyphInk =
	/** A filled shape: the heaviest mark, read at a glance. */
	| "solid"
	/** A closed shape drawn in strokes: a state, legible but not loud. */
	| "outline"
	/** Open strokes: bars, arrows, and the line art of a join. */
	| "line";

/** The East-Asian width class a glyph is measured as; never wide or fullwidth. */
export type GlyphWidth = "narrow" | "neutral" | "ambiguous";

/** The facts one glyph carries besides its literal. */
export interface GlyphFacts {
	/** How much ink it puts in the cell. */
	ink: GlyphInk;
	/** The width class `EastAsianWidth.txt` gives it, recorded so a test can hold it. */
	width: GlyphWidth;
	/** What it says, in a few words; unique across the vocabulary. */
	says: string;
	/** Other jobs the one literal serves, when a shape carries two. */
	also?: readonly string[];
	/** Genuine prose as often as a mark (`·` between two facts), so the scan skips it. */
	prose?: true;
	/** Plain ASCII, indistinguishable from prose (`!`, `?`), so the scan skips it. */
	ascii?: true;
}

/**
 * One record per glyph, held total by the mapped type: a name added to
 * {@link GLYPHS} and not here does not compile, and neither does a record for a
 * glyph that is not there.
 */
export const GLYPH_SPECS: { readonly [K in GlyphName]: GlyphFacts } = {
	branch: { ink: "line", width: "neutral", says: "a git branch" },
	detached: { ink: "solid", width: "neutral", says: "the checkout is not on a branch" },
	worktree: { ink: "line", width: "neutral", says: "a managed worktree" },
	rewind: { ink: "line", width: "neutral", says: "a prompt snapshot" },
	snapshot: { ink: "solid", width: "neutral", says: "a recorded state" },
	arrow: { ink: "line", width: "ambiguous", says: "one state becomes another", also: ["separator"], prose: true },
	plan: { ink: "line", width: "ambiguous", says: "the plan, as a written list" },
	lead: { ink: "solid", width: "neutral", says: "the seat is held" },
	jobsRunning: { ink: "solid", width: "neutral", says: "a job is running", also: ["fold closed"] },
	jobsFailure: { ink: "line", width: "neutral", says: "a job failed" },
	stopped: { ink: "outline", width: "neutral", says: "stopped, not failed" },
	http: { ink: "outline", width: "neutral", says: "a served page's port", also: ["live"] },
	delegation: { ink: "line", width: "neutral", says: "work handed to another agent" },
	wechat: { ink: "solid", width: "neutral", says: "the WeChat bridge" },
	gaugeFull: { ink: "solid", width: "neutral", says: "a filled gauge block" },
	gaugeEmpty: { ink: "outline", width: "neutral", says: "an empty gauge block" },
	turnRule: { ink: "line", width: "neutral", says: "a turn's centered rule" },
	divider: { ink: "line", width: "neutral", says: "a vertical divider" },
	ruleFill: { ink: "line", width: "ambiguous", says: "the rule's fill" },
	changed: { ink: "solid", width: "ambiguous", says: "a changed line", prose: true },
	check: { ink: "line", width: "neutral", says: "yes, done" },
	warn: { ink: "line", width: "narrow", says: "attention, not an error", ascii: true },
	cross: { ink: "line", width: "neutral", says: "no, failed" },
	disabled: { ink: "outline", width: "neutral", says: "switched off" },
	half: { ink: "outline", width: "neutral", says: "half of it" },
	pending: { ink: "outline", width: "neutral", says: "waiting" },
	target: { ink: "outline", width: "neutral", says: "where a card lands" },
	killed: { ink: "outline", width: "neutral", says: "killed on purpose" },
	unknown: { ink: "line", width: "narrow", says: "a value this build cannot read", ascii: true },
	boxOn: { ink: "solid", width: "neutral", says: "checked" },
	boxOff: { ink: "outline", width: "neutral", says: "not checked" },
	foldOpen: { ink: "solid", width: "neutral", says: "an open fold" },
	prev: { ink: "line", width: "neutral", says: "previous" },
	next: { ink: "line", width: "neutral", says: "next" },
	update: { ink: "line", width: "ambiguous", says: "a newer version", also: ["hint up"] },
	hintDown: { ink: "line", width: "ambiguous", says: "hint down" },
	reload: { ink: "line", width: "neutral", says: "reload" },
	edit: { ink: "line", width: "neutral", says: "write here" },
	autoMode: { ink: "solid", width: "ambiguous", says: "no mode is held" },
	prompt: { ink: "solid", width: "neutral", says: "the input line" },
};

/**
 * A multi-frame mark, where the movement is the meaning.
 *
 * One record per set rather than one per frame: a spinner is a sequence, and
 * every frame has to be one column for the row not to jump.
 */
export const GLYPH_SEQUENCES = {
	spinner: {
		frames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
		ink: "line",
		says: "a run in progress",
	},
} as const satisfies Record<string, { frames: readonly string[]; ink: GlyphInk; says: string }>;

/**
 * The three session modes' glyphs, one silhouette each.
 *
 * `plan` is the document, `lead` the held position, `auto` the resting default.
 * The slot draws one of them at a time, so they are compared from memory rather
 * than side by side — which is why no two may share a silhouette, the reason
 * `lead` is not a second right-pointing triangle. A planted flag says the
 * position is held, and its asymmetry keeps it apart from the round marks.
 */
export const MODE_GLYPHS = {
	auto: GLYPHS.autoMode,
	plan: GLYPHS.plan,
	lead: GLYPHS.lead,
} as const;

/** Columns between a rail body glyph and its text. */
export const GLYPH_GAP = 1;

/**
 * The state-change arrow: `memory → add (project)`, `→ clear list`.
 *
 * Two jobs, one literal, spelled once as {@link GLYPHS.arrow}: a join between
 * two states, and a lead with no left-hand state (`→ clear`, `→ 3/5`) where the
 * call site keeps its own spacing. U+2192 is East-Asian *A (ambiguous)* — the
 * class the vocabulary allows with `▸`, `⊚` and `›`, so it is one column by
 * default and two under a CJK-width profile. `lib/tui/components.test.ts` holds
 * its width and states the class, so a hand-copied wide arrow fails there.
 */
export const ARROW = GLYPHS.arrow;

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

/** Keybinding id for Pi's built-in expand toggle (`ctrl+o` by default). Bind a
 * collapse hint to it through `keyText` rather than retyping the key, so a
 * rebound key is respected. */
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
