/**
 * Registers bytefly's user-message markdown transformer.
 *
 * Registration happens at extension load, like the turn separator's entry
 * renderer: the transformer only matters where a transcript renders, and Pi
 * calls it for every message, so no session lifecycle is needed.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { styleUserMessage } from "./format.ts";

/** Register the transformer that marks each user message. */
export function registerUserMessage(pi: ExtensionAPI): void {
	pi.registerMarkdownTransformer((markdown, context) => styleUserMessage(markdown, context));
}
