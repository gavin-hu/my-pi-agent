/**
 * The theme the capture scripts draw with, and the page it draws on.
 *
 * `loadThemeFromPath` and `setThemeInstance` are not on the package root; the
 * deep path is a dev-only import that keeps a capture on the shipped theme JSON
 * and render path. Only `scripts/` may reach into Pi's `dist` this way.
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	loadThemeFromPath,
	setThemeInstance,
} from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";

/** The package root. */
export const repo = resolve(import.meta.dir, "..");

/** The shipped theme JSON a capture draws with. */
const THEME_FILE = join(repo, "themes", "bytefly-dark.json");

/** The shipped dark palette, as a capture renders it. */
export const theme: Theme = loadThemeFromPath(THEME_FILE, "truecolor");

/** The two colours a captured page needs, as `#rrggbb`. */
export interface PageColors {
	background: string;
	text: string;
}

/** A theme document's three maps, as far as a capture reads them. */
interface ThemeDocument {
	vars: Record<string, string>;
	colors: Record<string, string>;
	export: Record<string, string>;
}

/** `value` as a theme document, or `undefined` when a map is missing. */
function asThemeDocument(value: unknown): ThemeDocument | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const document = value as Partial<Record<keyof ThemeDocument, unknown>>;
	for (const key of ["vars", "colors", "export"] as const) {
		const map = document[key];
		if (typeof map !== "object" || map === null) return undefined;
	}
	return document as ThemeDocument;
}

/** The `#rrggbb` a theme role names, through the document's own `vars`. */
function resolveColor(document: ThemeDocument, role: string, where: string): string {
	const value = document.vars[role];
	if (value === undefined) throw new Error(`${THEME_FILE}: ${where} names "${role}", which is not a var`);
	return value;
}

/**
 * The page a capture draws on: the theme's `export.pageBg` and its `text`
 * colour, resolved through its `vars`. It is one palette for the gallery's
 * `body`, the ANSI background the capture resets the terminal to, and the
 * fallback under reverse video, so a theme edit cannot leave a stale hex behind.
 */
export function readPageColors(file: string): PageColors {
	const parsed: unknown = JSON.parse(readFileSync(file, "utf-8"));
	const document = asThemeDocument(parsed);
	if (document === undefined) throw new Error(`${file}: not a theme file; expected vars, colors, and export maps`);
	return {
		background: resolveColor(document, document.export.pageBg ?? "", "export.pageBg"),
		text: resolveColor(document, document.colors.text ?? "", "colors.text"),
	};
}

/** The page the shipped theme draws on. */
export const pageColors: PageColors = readPageColors(THEME_FILE);

export { setThemeInstance };
