/**
 * Column fixtures for the width-arithmetic suites: the sweep widths, a
 * representative cell mix, and where a placed cell starts on its line.
 */

import { stripTerminalSequences } from "@earendil-works/pi-tui";

/** Column counts exercised by the width sweeps. */
export const WIDTHS = Array.from({ length: 115 }, (_, index) => index + 6);

/** A representative mix: ASCII, a CJK sample, and a themed string. */
export const SAMPLES = ["Extensions", "日本語のリスト", "\u001b[31mred\u001b[39m text", "a", ""];

/** The column the placed text starts in, ignoring any indent before it. */
export function columnOf(line: string | undefined, text: string): number {
	return stripTerminalSequences(line ?? "").indexOf(text);
}
