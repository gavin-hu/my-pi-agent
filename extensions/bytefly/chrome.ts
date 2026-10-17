/**
 * The transcript rail and the shared `chrome` section of `bytefly.json`.
 *
 * The rail is the vertical stroke that leads a block's body — a tool result, a
 * notice row — while the headline stays at the margin. Its glyph is the one
 * configurable part; the geometry is fixed by `lib/tui/indent.ts`. A glyph must
 * be exactly one visible column, or it would push the body right and drift the
 * width math, so `normalizeChromeConfig` rejects anything else and falls back.
 *
 * The value is read at `session_start`/`session_tree` (nothing watches the
 * document), held in a `RailSource` closure created once per load, and read by
 * the renderers at render time, so no module state lives here.
 */

import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { cleanString, loadConfigSection } from "../../lib/config.ts";
import { GLYPH_GAP, GLYPHS } from "../../lib/tui/glyphs.ts";
import { paint, type TuiRole } from "../../lib/tui/tokens.ts";

/** How a railed block reads at a glance. */
export type RailStatus = "info" | "ok" | "warn" | "bad";

/**
 * Status to design role: a rail is neutral by default, so a finished or merely
 * informational block draws no colour and only `warn` and `bad` stand out. A
 * surface whose `info` means *active* rather than *informational* brightens it
 * itself — a running tool result takes the accent (see `block/config.ts`).
 */
export const RAIL_ROLES: Readonly<Record<RailStatus, TuiRole>> = {
	info: "info",
	ok: "faint",
	warn: "warn",
	bad: "bad",
};

/** The rail glyph, painted in the role. `lib/tui/indent.ts` adds the gap. */
export function railGlyph(theme: Theme, role: TuiRole, glyph: string): string {
	return paint(theme, role, glyph);
}

/** The painted rail prefix: the glyph and its gap, for a line built directly. */
export function railPrefix(theme: Theme, role: TuiRole, glyph: string): string {
	return `${railGlyph(theme, role, glyph)}${" ".repeat(GLYPH_GAP)}`;
}

/** Transcript chrome presentation. */
export interface ChromeConfig {
	/** The rail glyph: exactly one visible column. */
	rail: string;
}

/** The default rail glyph, from the shared vocabulary. */
export const DEFAULT_RAIL_GLYPH: string = GLYPHS.divider;

export const DEFAULT_CHROME_CONFIG: ChromeConfig = { rail: DEFAULT_RAIL_GLYPH };

/** Whether `value` is a single, unstyled terminal column. */
function isRailGlyph(value: string): boolean {
	// Control characters first: a bare ESC confuses a width measurement.
	if (/[\u0000-\u001f\u007f]/.test(value)) return false;
	return [...value].length === 1 && visibleWidth(value) === 1;
}

/** Validate the `chrome` section over `base`. Total: never throws, never guesses. */
export function normalizeChromeConfig(raw: Record<string, unknown> | undefined, base: ChromeConfig): ChromeConfig {
	if (!raw) return base;
	const rail = cleanString(raw.rail, "");
	return { rail: isRailGlyph(rail) ? rail : base.rail };
}

/** Effective chrome config for `cwd` (defaults, then the shared `chrome` section). */
export function loadChromeConfig(cwd: string): ChromeConfig {
	return loadConfigSection(cwd, "chrome", DEFAULT_CHROME_CONFIG, normalizeChromeConfig);
}

/** Where a render-time surface reads the current rail glyph. */
export interface RailSource {
	/** The configured glyph. */
	resolve(): string;
	/** Replace the glyph; a value that is not one column keeps the previous one. */
	set(glyph: string): void;
}

/** A store holding the configured rail glyph, created once per extension load. */
export function createRailSource(initial: string = DEFAULT_RAIL_GLYPH): RailSource {
	let glyph = isRailGlyph(initial) ? initial : DEFAULT_RAIL_GLYPH;
	return {
		resolve: () => glyph,
		set(next: string) {
			if (isRailGlyph(next)) glyph = next;
		},
	};
}

/** Register the chrome lifecycle and hand back the rail source it keeps current. */
export function registerChrome(pi: ExtensionAPI, rail: RailSource = createRailSource()): RailSource {
	const load = (ctx: ExtensionContext): void => rail.set(loadChromeConfig(ctx.cwd).rail);
	pi.on("session_start", (_event, ctx) => load(ctx));
	pi.on("session_tree", (_event, ctx) => load(ctx));
	return rail;
}
