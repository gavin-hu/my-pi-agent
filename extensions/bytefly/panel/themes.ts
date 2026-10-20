/**
 * Which themes the Settings **Theme** row offers: this package's own two, not
 * every theme in play.
 *
 * The host resolves Pi's built-ins, this package's palettes, and any user or
 * project theme into one list, but the row writes Pi's single `theme`
 * preference from a bytefly screen, so it offers only the palettes this package
 * ships and can vouch for. The file's directory identifies a shipped theme, not
 * its name: `themes/` is the manifest's own resource glob, so a renamed palette
 * or a look-alike name cannot drift the list away from what the package loads.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** This package's `themes/` directory. */
export const SHIPPED_THEMES_DIR = resolve(fileURLToPath(new URL("../../../themes", import.meta.url)));

/** One theme as the host reports it. */
export interface HostTheme {
	name: string;
	path?: string;
}

/** The shipped theme names in the host's order; a pathless or foreign theme is dropped. */
export function shippedThemeNames(themes: readonly HostTheme[]): string[] {
	return themes.filter(isShipped).map((theme) => theme.name);
}

function isShipped(theme: HostTheme): boolean {
	return theme.path !== undefined && dirname(resolve(theme.path)) === SHIPPED_THEMES_DIR;
}
