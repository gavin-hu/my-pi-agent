/**
 * The `doc` extension entrypoint.
 *
 * Registers `read_doc`, which extracts text from a local PDF or DOCX under the
 * effective working root. The factory only registers; the tool loads its optional
 * extractor packages lazily and holds no long-lived resources, so there is no
 * `session_start`/`session_shutdown` lifecycle to manage.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerDocTool } from "./tool.ts";

export default function doc(pi: ExtensionAPI): void {
	registerDocTool(pi);
}
