/**
 * The `/watch` screen's watchers: one live file tail with matches, one finished command.
 */

import { now } from "./shared.ts";
import type { WatchRecord } from "../../extensions/watch/types.ts";

/** The `/watch` screen's watchers: one live file tail with matches, one finished command. */
export const WATCHES: WatchRecord[] = [
	{
		id: "w1",
		label: "errors",
		source: { kind: "file", path: "/home/u/repo/logs/server.log" },
		pattern: "(error|fail)",
		exclude: ["noise"],
		caseSensitive: false,
		wake: false,
		fromStart: false,
		status: "running",
		startedAt: now - 12 * 60_000,
		linesRead: 1834,
		matchCount: 3,
		lastMatchAt: now - 40_000,
	},
	{
		id: "w2",
		label: "build",
		source: { kind: "command", command: "bun run build", cwd: "/home/u/repo" },
		pattern: "error",
		exclude: [],
		caseSensitive: true,
		wake: true,
		fromStart: true,
		status: "exited",
		startedAt: now - 26 * 60_000,
		endedAt: now - 24 * 60_000,
		linesRead: 412,
		matchCount: 0,
		exitCode: 0,
		signal: null,
	},
];
