/**
 * The `document` extension entrypoint.
 *
 * Registers `read_doc`, which extracts text from a local PDF, DOCX, DOC, ODT,
 * RTF, or XLSX under the effective working root using in-process parsers. The
 * factory only registers; a parser library loads lazily on the first read of its
 * format, so the extension costs nothing at startup.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isExtensionEnabled } from "../../lib/env.ts";
import { registerDocTool } from "./tool.ts";

export default function document(pi: ExtensionAPI): void {
	if (!isExtensionEnabled("document")) return;
	registerDocTool(pi);
}
