/**
 * web-access — model-facing web access for Pi.
 *
 * One extension registering two tools:
 *
 *   - `web_search`: general web search, keyless DuckDuckGo by default with
 *     optional SearXNG or Brave.
 *   - `web_fetch`: fetch a URL and return readable text, pageable and
 *     searchable, with a page cache per registration. PDF extraction and JS
 *     rendering use optional packages when installed.
 *
 * Both are `direct` and active by default, and read the `search` / `fetch`
 * sections of `web-access.json` (global + project). The fetch cache is cleared
 * on `session_start` and `session_shutdown` by `registerFetchTool`.
 *
 * Load with:  pi --extension ./extensions/web-access
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isExtensionEnabled } from "../../lib/env.ts";
import { registerFetchTool } from "./fetch/tool.ts";
import { registerSearchTool } from "./search/tool.ts";

export default function webAccess(pi: ExtensionAPI): void {
	if (!isExtensionEnabled("web-access")) return;
	registerSearchTool(pi);
	registerFetchTool(pi);
}
