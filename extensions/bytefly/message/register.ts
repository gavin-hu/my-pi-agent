/**
 * Registers bytefly's single Markdown transformer.
 *
 * Pi keeps one transformer per extension (`loader.js`), and the extension
 * spends it on the user-message nameplate. A second
 * `registerMarkdownTransformer` call would silently replace the first, so there
 * is exactly one, here.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { styleMessage } from "./format.ts";

/** Register the transformer that marks user messages. */
export function registerUserMessage(pi: ExtensionAPI): void {
	pi.registerMarkdownTransformer((markdown, context) => styleMessage(markdown, context));
}
