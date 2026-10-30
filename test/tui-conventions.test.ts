/**
 * The renderer conventions a TUI surface has to keep.
 *
 * Three rules a text scan can hold: a component that answers Pi's `focused` check assigns both
 * halves, a tool renderer reuses `context.lastComponent` so a frame is not rebuilt from
 * scratch, and the expand affordance is bound to the shared keybinding id rather than a
 * literal key. The design contract behind them is `lib/tui/README.md`.
 */

import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { dirsOf, extensionsDir, repo, SCANNED_DIRS, sourceFiles, textOf } from "./helpers/scan.ts";

/** A `renderCall(` / `renderResult(` definition at the start of a line. */
const RENDERER_DEF = /^\s*(?:async\s+)?render(?:Call|Result)\s*\(/m;
/** The raw expand keybinding id; import `EXPAND_KEYBINDING` from `lib/tui/glyphs.ts`. */
const RAW_EXPAND_KEY = /"app\.tools\.expand"/;
/** A literal expand key, which ignores a rebound keybinding. */
const LITERAL_EXPAND_KEY = /Ctrl\+O|ctrl\+o/;

describe("renderer conventions", () => {
	test("a component that answers Pi's focus check can be assigned the flag", () => {
		// Pi's `isFocusable` is `"focused" in component`, and TUI then writes
		// `component.focused = true` when focus moves. A read-only accessor under that
		// name crashes the process on the way back to the editor, so declaring it means
		// declaring both halves — or naming the getter for what it actually returns.
		const offenders: string[] = [];
		for (const dir of SCANNED_DIRS) {
			for (const file of sourceFiles(dir)) {
				const text = textOf(file);
				if (!/\bget focused\s*\(/.test(text) || /\bset focused\s*\(/.test(text)) continue;
				offenders.push(
					`${file.slice(repo.length + 1)}: declares a getter-only \`focused\`; Pi assigns that flag, so add a setter or rename the getter`,
				);
			}
		}
		expect(offenders).toEqual([]);
	});

	test("tool renderers reuse context.lastComponent", () => {
		const offenders: string[] = [];
		for (const dir of SCANNED_DIRS) {
			for (const file of sourceFiles(dir)) {
				const text = textOf(file);
				if (RENDERER_DEF.test(text) && !text.includes("lastComponent")) {
					offenders.push(`${file.slice(repo.length + 1)}: renderer does not reuse context.lastComponent`);
				}
			}
		}
		expect(offenders).toEqual([]);
	});

	test("extensions bind the expand affordance to the shared keybinding id", () => {
		const offenders: string[] = [];
		for (const name of dirsOf(extensionsDir)) {
			for (const file of sourceFiles(join(extensionsDir, name))) {
				const relative = file.slice(repo.length + 1);
				textOf(file)
					.split("\n")
					.forEach((line, index) => {
						if (RAW_EXPAND_KEY.test(line)) {
							offenders.push(`${relative}:${index + 1}: import EXPAND_KEYBINDING from lib/tui/glyphs.ts`);
						}
						if (LITERAL_EXPAND_KEY.test(line)) {
							offenders.push(`${relative}:${index + 1}: use keyText(EXPAND_KEYBINDING), not a literal key`);
						}
					});
			}
		}
		expect(offenders).toEqual([]);
	});
});
