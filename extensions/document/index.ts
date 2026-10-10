/**
 * The `document` extension entrypoint.
 *
 * Registers `read_doc`, which extracts text from a local PDF, DOCX, DOC, ODT,
 * RTF, or XLSX under the effective working root by running `pdfcraft-cli`,
 * `wordcraft-cli`, or `gridcraft-cli`. The factory only registers; each read
 * spawns a short-lived child process and nothing long-lived is held, so there is
 * no `session_start`/`session_shutdown` lifecycle to manage.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isExtensionEnabled } from "../../lib/env.ts";
import { registerDocTool } from "./tool.ts";

export default function document(pi: ExtensionAPI): void {
	if (!isExtensionEnabled("document")) return;
	registerDocTool(pi);
}
