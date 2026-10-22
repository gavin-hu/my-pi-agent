/**
 * The message transformer: the user-message nameplate, and the removal of a
 * next-steps block from an assistant reply.
 *
 * Pi's message components parse the transformed string as Markdown and own their
 * colors, so shaping text is the only lever: these surfaces add no component and
 * no color of their own. The nameplate is a level-2 heading, which Pi renders
 * bold in `mdHeading` and prints without its `#` prefix; the bytefly themes point
 * `mdHeading` at the accent, so the label and rule carry the accent while the
 * message itself stays in the default text color. Markdown cannot express a
 * two-line heading, and Pi puts a blank line after a heading block, so the label
 * is padded to the width and the rule is appended: the heading's text wraps,
 * putting the rule on its own row with no blank between. A blank line separates
 * the nameplate from the message, so the message's own Markdown (a fence, a list,
 * a second paragraph) parses exactly as it would without it.
 *
 * The next-steps block is the other direction the same lever can move: bytefly
 * lifts that block into its own entry below the turn rule, so the reply must stop
 * drawing it or it would appear twice. The strip uses the same strict
 * `parseNextSteps` as the lift, runs while streaming too (so the block never
 * appears in the reply and then jumps), and touches nothing else.
 */

import type { MarkdownTransformContext } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { parseNextSteps } from "../next/parse.ts";
import { MESSAGE_CONFIG } from "./config.ts";

const { label, ruleGlyph } = MESSAGE_CONFIG;

/**
 * The two-row nameplate: a heading whose text is the label, padded to the
 * width, followed by a full-width rule. The wrap puts the rule on the second
 * row; the whole nameplate is dropped when not even the label fits.
 */
export function nameplate(width: number): string | undefined {
	const labelWidth = visibleWidth(label);
	const w = Math.max(1, Math.floor(width));
	if (labelWidth > w) return undefined;
	const pad = " ".repeat(w - labelWidth);
	return `## ${label}${pad}${ruleGlyph.repeat(w)}`;
}

/** Put the nameplate above a user message; every other message passes through. */
export function styleUserMessage(markdown: string, context: MarkdownTransformContext): string {
	if (context.messageType !== "user" || markdown.trim() === "") return markdown;
	const head = nameplate(context.availableWidth);
	return head ? `${head}\n\n${markdown}` : markdown;
}

/**
 * Dispatch the single transformer Pi keeps per extension on the message type: a
 * user message gains the nameplate, an assistant message loses a next-steps
 * block that bytefly draws as its own entry below the turn rule.
 */
export function styleMessage(markdown: string, context: MarkdownTransformContext): string {
	if (context.messageType === "user") return styleUserMessage(markdown, context);
	if (context.messageType !== "assistant") return markdown;
	return parseNextSteps(markdown)?.stripped ?? markdown;
}
