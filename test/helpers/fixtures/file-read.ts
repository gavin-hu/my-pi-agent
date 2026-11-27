import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { AgentToolResult, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import type { ReadResult } from "../../../extensions/file-read/schema.ts";

/** A scratch root for file-read tests, with an `outside/` directory and a symlink into it. */
export interface ReadFixture {
	root: string;
	outside: string;
	/** Write a file under the root (creating parents), returning its absolute path. */
	write(rel: string, contents: string | Uint8Array): string;
	remove(): void;
}

export function makeReadFixture(): ReadFixture {
	const base = mkdtempSync(join(tmpdir(), "pi-doc-"));
	const root = join(base, "root");
	const outside = join(base, "outside");
	mkdirSync(root, { recursive: true });
	mkdirSync(outside, { recursive: true });
	writeFileSync(join(outside, "outside.pdf"), "outside\n");

	try {
		symlinkSync(join(outside, "outside.pdf"), join(root, "escape.pdf"));
	} catch {
		// Symlinks may be unavailable (e.g. unprivileged Windows); the symlink read case skips.
	}

	return {
		root: realpathSync.native(root),
		outside: realpathSync.native(outside),
		write(rel, contents) {
			const abs = join(root, rel);
			mkdirSync(dirname(abs), { recursive: true });
			writeFileSync(abs, contents);
			return abs;
		},
		remove: () => rmSync(base, { recursive: true, force: true }),
	};
}

/**
 * The registered `read_doc` tool, as a case drives it: a case passes the arguments an action
 * reads, and reads the extraction it got back.
 */
export type ReadTool = ToolDefinition<TSchema, ReadResult> &
	Required<Pick<ToolDefinition, "renderCall" | "renderResult">>;

/** A result shaped the way the tool returns one: every override lands in `details`. */
export function docResult(overrides: Partial<ReadResult>): AgentToolResult<ReadResult> {
	return {
		details: {
			path: "a.pdf",
			format: "pdf",
			bytes: 1,
			chars: 42478,
			startIndex: 0,
			nextIndex: 42478,
			truncated: false,
			text: "x",
			...overrides,
		},
		content: [{ type: "text", text: "x" }],
	};
}
