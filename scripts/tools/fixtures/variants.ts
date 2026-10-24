/**
 * A tool's other states, where its main entry lives in another module.
 *
 * A rejected fetch, a document read still in flight, and a memory subject
 * long enough to wrap: the shapes a gallery of settled calls would not show.
 */

import type { ToolFixture } from "./types.ts";

/** One entry per tool variant, in gallery order. */
export const VARIANT_FIXTURES: ToolFixture[] = [
	{
		name: "web_fetch-rejected",
		tool: "web_fetch",
		group: "package",
		label: "a denied call (sanitized error, no details)",
		args: { url: "https://example.com/private" },
		result: {
			content: [{ type: "text", text: "Error: Permission denied: web_fetch" }],
			details: {},
			isError: true,
		},
	},
	{
		name: "read_doc-running",
		tool: "read_doc",
		group: "package",
		label: "a partial read (live elapsed)",
		args: { path: "docs/architecture.pdf" },
		options: { isPartial: true },
		result: { content: [] },
	},
	{
		name: "memory-long-subject",
		tool: "memory",
		group: "package",
		label: "a long note (clipped call line)",
		args: {
			action: "add",
			text: "Prefers bun over npm, and never runs npm install in a repository with a bun.lock",
			scope: "project",
		},
		result: {
			content: [{ type: "text", text: "Added to project memory" }],
			details: {
				action: "add",
				scope: "project",
				project: ["Prefers bun over npm, and never runs npm install in a repository with a bun.lock"],
				global: [],
				changed: true,
				entry: "Prefers bun over npm, and never runs npm install in a repository with a bun.lock",
			},
		},
	},
];
