/**
 * The theme the capture scripts draw with.
 *
 * `loadThemeFromPath` and `setThemeInstance` are not on the package root; the
 * deep path is a dev-only import that keeps a capture on the shipped theme JSON
 * and render path. Only `scripts/` may reach into Pi's `dist` this way.
 */

import { join, resolve } from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	loadThemeFromPath,
	setThemeInstance,
} from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";

/** The package root. */
export const repo = resolve(import.meta.dir, "..");

/** The shipped dark palette, as a capture renders it. */
export const theme: Theme = loadThemeFromPath(join(repo, "themes", "bytefly-dark.json"), "truecolor");

export { setThemeInstance };
