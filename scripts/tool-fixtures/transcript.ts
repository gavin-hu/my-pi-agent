/**
 * The transcript surfaces the gallery draws.
 *
 * Drawn by bytefly's own components rather than a tool renderer, so each entry
 * carries a name and a label and nothing to render.
 */

import type { ToolFixture } from "./types.ts";

/** One entry per transcript surface, in gallery order. */
export const TRANSCRIPT_FIXTURES: ToolFixture[] = [
	{ name: "user-message", group: "transcript", label: "the nameplate above a user message" },
	{ name: "notice", group: "transcript", label: "a shared transcript notice" },
	{ name: "turn-rule", group: "transcript", label: "the rule between completed turns" },
];
