/**
 * Read-only capability policy shared by extensions that restrict what the model
 * may do (plan mode today; delegation next).
 *
 * Instead of enumerating the tools that mutate, this defaults to *deny*: a tool
 * call is allowed only when the tool is a known structured reader or carries the
 * MCP `readOnlyHint`. That makes the policy correct for tools it has never seen
 * — `bash`, MCP servers, future extension tools — rather than relying on
 * `write`/`edit` being the only mutators.
 *
 * No runtime dependencies: the caller supplies the annotation lookup. Only the
 * MCP hint type is imported (type-only).
 */

import type { ToolAnnotations } from "@earendil-works/pi-coding-agent";

export interface ReadOnlyPolicyOptions {
	/** Tools allowed regardless of annotations (structured readers, plan tracker). */
	allow?: Iterable<string>;
	/** Tools blocked even when annotated read-only. */
	deny?: Iterable<string>;
	/** Resolve a tool's MCP annotations, for tools not named in `allow`/`deny`. */
	annotations?: (toolName: string) => ToolAnnotations | undefined;
	/** Appended to a block reason to tell the model how to proceed. */
	guidance?: string;
}

/** How a tool would be treated in a read-only session. */
export type ToolKind = "read-only" | "mutating";

export interface BlockedCall {
	block: true;
	reason: string;
}

export interface ReadOnlyPolicy {
	/** Classify a tool by name. */
	classify(toolName: string): ToolKind;
	/** Whether the tool may stay active during a read-only session. */
	isAllowed(toolName: string): boolean;
	/** `{ block: true, reason }` when the call must be blocked, else `undefined`. */
	check(toolName: string): BlockedCall | undefined;
}

export function createReadOnlyPolicy(options: ReadOnlyPolicyOptions = {}): ReadOnlyPolicy {
	const allow = new Set(options.allow ?? []);
	const deny = new Set(options.deny ?? []);
	const annotations = options.annotations ?? (() => undefined);
	const guidance = options.guidance ? ` ${options.guidance}` : "";

	const classify = (toolName: string): ToolKind => {
		if (deny.has(toolName)) return "mutating";
		if (allow.has(toolName)) return "read-only";
		if (annotations(toolName)?.readOnlyHint === true) return "read-only";
		return "mutating";
	};

	return {
		classify,
		isAllowed: (toolName) => classify(toolName) !== "mutating",
		check(toolName) {
			if (classify(toolName) === "read-only") return undefined;
			return { block: true, reason: `"${toolName}" is not read-only.${guidance}` };
		},
	};
}
