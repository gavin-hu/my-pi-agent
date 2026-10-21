/**
 * `context` — see where the window goes, and compact from the report.
 *
 * Command-only by design: usage is a user-facing concern, so no tool is declared
 * and the model's prompt budget is untouched. The factory only registers; the
 * report reads the session on demand and keeps no resources.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isExtensionEnabled } from "../../lib/env.ts";
import { registerCommands } from "./commands.ts";

export default function context(pi: ExtensionAPI): void {
	if (!isExtensionEnabled("context")) return;
	registerCommands(pi);
}
