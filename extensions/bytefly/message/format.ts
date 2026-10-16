/**
 * The user-message nameplate: a bold `❯ You` label with a rule running to the
 * right margin, above the message.
 *
 * Pi's user message component parses the transformed string as Markdown, so
 * shaping text is the only lever: the surface can add no component, color, or
 * box. The nameplate is one paragraph — `**label**` and a run of the rule glyph
 * — separated from the message by a blank line, so the message's own Markdown (a
 * fence, a list, a second paragraph) parses exactly as it would without the
 * nameplate. Colors come from the renderer: the label is bold in
 * `userMessageText` and the rule is plain `userMessageText`.
 */

import type { MarkdownTransformContext } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { MESSAGE_CONFIG } from "./config.ts";

const { glyph, label, ruleGlyph } = MESSAGE_CONFIG;

/**
 * The nameplate line: a bold label, a space, and the rule to the right margin.
 * The rule is dropped when fewer than `minRule` columns remain, and the whole
 * nameplate is dropped when not even the label fits.
 */
export function nameplate(width: number): string | undefined {
	const text = `${glyph} ${label}`;
	const labelWidth = visibleWidth(text);
	const w = Math.max(1, Math.floor(width));
	if (labelWidth > w) return undefined;
	const fill = w - labelWidth - 1;
	if (fill < MESSAGE_CONFIG.minRule) return `**${text}**`;
	return `**${text}** ${ruleGlyph.repeat(fill)}`;
}

/** Put the nameplate above a user message; every other message passes through. */
export function styleUserMessage(markdown: string, context: MarkdownTransformContext): string {
	if (context.messageType !== "user" || markdown.trim() === "") return markdown;
	const head = nameplate(context.availableWidth);
	return head ? `${head}\n\n${markdown}` : markdown;
}
