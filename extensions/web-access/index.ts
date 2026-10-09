/**
 * web-access — model-facing web access for Pi.
 *
 * One extension registering two tools:
 *
 *   - `web_search`: general web search via a configured SearXNG instance.
 *   - `web_fetch`: fetch a URL and return readable text, pageable and
 *     searchable, with a session page cache. PDF extraction and JS rendering
 *     use optional packages when installed.
 *
 * Both are `direct` and active by default, and read the `search` / `fetch`
 * sections of `web-access.json` (global + project). The page cache is cleared
 * on `session_shutdown`.
 *
 * Load with:  pi --extension ./extensions/web-access
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isExtensionEnabled } from "../../lib/env.ts";
import { cacheClear } from "./fetch/cache.ts";
import { registerFetchTool } from "./fetch/tool.ts";
import { registerSearchTool } from "./search/tool.ts";

export default function webAccess(pi: ExtensionAPI): void {
	if (!isExtensionEnabled("web-access")) return;
	pi.on("session_shutdown", () => cacheClear());
	registerSearchTool(pi);
	registerFetchTool(pi);
}
