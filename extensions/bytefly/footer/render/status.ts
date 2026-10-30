/**
 * Status-chip transforms for a narrow footer.
 *
 * Extension statuses arrive as themed strings from `ctx.ui.setStatus`, so these
 * parse the surrounding SGR sequences to compact a chip without losing its
 * colour. They never touch the terminal or the theme; the generic number and
 * path formatters live in `./format.ts`.
 */

import { stripTerminalSequences } from "@earendil-works/pi-tui";

/**
 * Compact a status to its icon form for a narrow bar, keeping its own colour.
 *
 * An icon plus a label (`≡ plan`) keeps only the icon. An icon plus a bare
 * count (`↺ 2`) is a badge: it keeps the count and drops the space (`↺2`),
 * because the number is the state. The leading open and trailing reset SGR
 * sequences are reattached around the compacted text, so a red `✗1` stays red
 * instead of losing its colour exactly when the bar tightens. Requiring exactly
 * two tokens (rather than "the last token is numeric") keeps a numeric label
 * like `≡ plan · 2024` from being mistaken for a count.
 */
export function compactStatus(status: string): string {
	const prefix = status.match(/^(?:\x1b\[[0-9;]*m)*/)?.[0] ?? "";
	const suffix = status.match(/(?:\x1b\[[0-9;]*m)+$/)?.[0] ?? "";
	const body = status.slice(prefix.length, status.length - suffix.length);
	const tokens = stripTerminalSequences(body).trim().split(/\s+/).filter(Boolean);
	const icon = tokens[0] ?? "";
	const text = tokens.length === 2 && /^\d+$/.test(tokens[1]) ? `${icon}${tokens[1]}` : icon;
	return `${prefix}${text}${suffix}`;
}
