/**
 * The `read_doc` tool.
 *
 * Reads a local `.pdf` or `.docx` under the effective working root and returns
 * its extracted text, pageable with `startIndex`/`maxChars`. The format table in
 * `formats.ts` decides which extractor runs; each extractor loads its optional
 * package (`unpdf`, `mammoth`) lazily. Reads are confined to the effective root
 * with symlink-aware containment, matching the worktree guard.
 */

import { readFile, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resolveEffectiveCwd } from "../../lib/env.ts";
import { stripControlChars } from "../../lib/format.ts";
import { isInsideReal, realPathOfNearest } from "../../lib/path.ts";
import { isFormatEnabled, loadConfig } from "./config.ts";
import { detectFormat, supportedExtensions, unsupportedHint } from "./formats.ts";
import { formatDoc } from "./paging.ts";
import { formatDocCall, formatDocResult, reuseText } from "./render.ts";
import { DocOutput, DocParams, MAX_CHARS, MIN_CHARS, TOOL_NAME, type DocArgs, type DocResult } from "./schema.ts";

export { TOOL_NAME } from "./schema.ts";

/** Resolve a request path under `root`, refusing anything that escapes it. */
function resolveDocument(root: string, rawPath: string): string {
	const trimmed = stripControlChars(rawPath.trim());
	if (!trimmed) throw new Error("path is required.");
	const candidate = isAbsolute(trimmed) ? trimmed : join(root, trimmed);
	const abs = realPathOfNearest(candidate);
	if (!isInsideReal(root, abs)) {
		throw new Error(
			`Refusing to read "${trimmed}" outside the working directory. Copy the file under it or pass a path inside it.`,
		);
	}
	return trimmed;
}

/** Read the file and raise a model-readable error for a missing/unreadable target. */
async function readBytes(abs: string, display: string, maxFileBytes: number): Promise<{ bytes: Buffer; size: number }> {
	let info: Awaited<ReturnType<typeof stat>>;
	try {
		info = await stat(abs);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT") throw new Error(`File not found: ${display}`);
		if (code === "EACCES") throw new Error(`Permission denied: ${display}`);
		throw error;
	}
	if (!info.isFile()) throw new Error(`Not a file: ${display}`);
	if (info.size > maxFileBytes) {
		throw new Error(`File is ${info.size} bytes, larger than the ${maxFileBytes}-byte limit for read_doc.`);
	}
	return { bytes: await readFile(abs), size: info.size };
}

export function registerDocTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: TOOL_NAME,
		label: "Read document",
		description:
			"Read a local PDF or DOCX file and return its extracted plain text. Output is pageable: when the result " +
			"is truncated, call read_doc again with the given startIndex. Formatting is lost; use the built-in read " +
			"tool for text and image files. PDF extraction needs the optional unpdf package and DOCX the optional " +
			"mammoth package; the error names the missing package.",
		promptSnippet: "Read a local PDF or DOCX file as plain text, paged with startIndex/maxChars.",
		promptGuidelines: [
			"Use read_doc for .pdf and .docx files; the built-in read tool is for text and images.",
			"When the result is truncated, call read_doc again with the suggested startIndex.",
			"Extraction returns plain text only; tables, images, and formatting are dropped.",
		],
		parameters: DocParams,
		outputSchema: DocOutput,
		exposure: "direct",
		defaultActive: true,
		annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const args = params as DocArgs;
			const config = loadConfig(ctx.cwd);
			const root = resolveEffectiveCwd(ctx.cwd);
			const display = resolveDocument(root, args.path);

			const format = detectFormat(display);
			if (!format) {
				const hint = unsupportedHint(display);
				if (hint) throw new Error(hint);
				throw new Error(`Unsupported document format. Supported extensions: ${supportedExtensions().join(", ")}.`);
			}
			if (!isFormatEnabled(config, format.id)) {
				throw new Error(`${format.label} extraction is disabled in doc.json (formats.${format.id} = false).`);
			}

			const abs = isAbsolute(display) ? display : join(root, display);
			const { bytes, size } = await readBytes(abs, display, config.maxFileBytes);
			const text = await format.extract(bytes);

			const startIndex = typeof args.startIndex === "number" ? Math.max(0, Math.round(args.startIndex)) : 0;
			const requested = typeof args.maxChars === "number" ? args.maxChars : config.maxChars;
			const maxChars = Math.min(config.maxChars, MAX_CHARS, Math.max(MIN_CHARS, Math.round(requested)));

			const formatted = formatDoc({
				path: display,
				format: format.id,
				bytes: size,
				text,
				startIndex,
				maxChars,
			});

			const result: DocResult = {
				path: display,
				format: format.id,
				bytes: size,
				chars: formatted.chars,
				startIndex,
				nextIndex: formatted.nextIndex,
				truncated: formatted.truncated,
				text: formatted.body,
			};

			return {
				content: [{ type: "text", text: formatted.text }],
				details: result,
				structuredContent: result,
			};
		},

		renderCall(args, theme, context) {
			const cwd = context?.cwd ?? process.cwd();
			return reuseText(context?.lastComponent, formatDocCall(args as DocArgs, theme, { cwd }));
		},

		renderResult(result, options, theme, context) {
			const isError = context?.isError ?? result.isError ?? false;
			return reuseText(
				context?.lastComponent,
				formatDocResult({ content: result.content, details: result.details, isError }, options, theme),
			);
		},
	});
}
