/**
 * extensions-manager — list and enable/disable Pi extensions in a session.
 *
 * Registers the `/extensions` command: a dock screen that lists every resolved
 * extension (personal and project, across all configured packages) and toggles
 * it by writing `settings.json`. Changes apply on reload.
 *
 * Load with:  pi --extension ./extensions/extensions-manager
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isExtensionEnabled } from "../../lib/env.ts";
import { type CommandDeps, registerCommands } from "./commands.ts";

export default function extensionsManager(pi: ExtensionAPI, deps: CommandDeps = {}): void {
	if (!isExtensionEnabled("extensions-manager")) return;
	registerCommands(pi, deps);
}
