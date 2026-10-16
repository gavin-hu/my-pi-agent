/**
 * The user-message nameplate: a `❯ You` heading with a rule running to the
 * right margin, above the message.
 *
 * Pi's user message component parses the transformed string as Markdown and
 * owns its colors, so shaping text is the only lever: the surface can add no
 * component and no color of its own. The nameplate is a level-2 heading, which
 * Pi renders bold in `mdHeading` and prints without its `#` prefix; the bytefly
 * themes point `mdHeading` at the accent, so the label and rule carry the accent
 * while the message itself stays in the default text color. A blank line
 * separates the nameplate from the message, so the message's own Markdown (a
 * fence, a list, a second paragraph) parses exactly as it would without it.
 */

import type { MarkdownTransformContext } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { MESSAGE_CONFIG } from "./config.ts";

const { glyph, label, ruleGlyph } = MESSAGE_CONFIG;

/**
 * The nameplate line: a heading whose text is the label and, to the right
 * margin, the rule. The rule is dropped when fewer than `minRule` columns
 * remain, and the whole nameplate is dropped when not even the label fits.
 */
export function nameplate(width: number): string | undefined {
	const text = `${glyph} ${label}`;
	const labelWidth = visibleWidth(text);
	const w = Math.max(1, Math.floor(width));
	if (labelWidth > w) return undefined;
	const fill = w - labelWidth - 1;
	if (fill < MESSAGE_CONFIG.minRule) return `## ${text}`;
	return `## ${text} ${ruleGlyph.repeat(fill)}`;
}

/** Put the nameplate above a user message; every other message passes through. */
export function styleUserMessage(markdown: string, context: MarkdownTransformContext): string {
	if (context.messageType !== "user" || markdown.trim() === "") return markdown;
	const head = nameplate(context.availableWidth);
	return head ? `${head}\n\n${markdown}` : markdown;
}
