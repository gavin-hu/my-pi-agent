/**
 * Decide which tool calls are worth a snapshot.
 *
 * Reuses the shared deny-by-default read-only policy: a tool is mutating unless
 * it is a known structured reader or carries the MCP `readOnlyHint`. A tool
 * whose mutation happens out of process (a subagent, a future MCP server) is
 * therefore covered without naming it. `watch` forces a tool to count, and
 * `ignore` never snapshots.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createReadOnlyPolicy } from "../../lib/policy.ts";
import type { RewindConfig } from "./config.ts";

/** Tools that only read files or track session state, so they never snapshot. */
const READER_TOOLS = ["read", "grep", "find", "ls", "todo", "goal"];

/** The interactive tool: it prompts the user and never touches the working tree. */
const SESSION_TOOLS = ["ask_user_question"];

export interface SnapshotPolicy {
	/** Whether a call to `toolName` should be preceded by a snapshot. */
	shouldSnapshot(toolName: string): boolean;
}

export function createSnapshotPolicy(pi: ExtensionAPI, config: RewindConfig): SnapshotPolicy {
	const policy = createReadOnlyPolicy({
		allow: READER_TOOLS,
		annotations: (name) => pi.getAllTools().find((tool) => tool.name === name)?.annotations,
	});
	const watch = new Set(config.watch);
	const ignore = new Set([...config.ignore, ...SESSION_TOOLS]);

	return {
		shouldSnapshot(toolName: string): boolean {
			if (!toolName || ignore.has(toolName)) return false;
			if (watch.has(toolName)) return true;
			return policy.classify(toolName) === "mutating";
		},
	};
}
