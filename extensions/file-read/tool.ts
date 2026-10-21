/**
 * The `read_doc` tool.
 *
 * Reads a local `.pdf`, `.docx`, `.doc`, `.odt`, `.rtf`, or `.xlsx` under the
 * effective working root and returns its extracted text, pageable with
 * `startIndex`/`maxChars`. The format table in `formats.ts` decides which
 * in-process extractor runs; no external tools are required. Reads are confined
 * to the effective root with symlink-aware containment, matching the worktree
 * guard.
 */

import { stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resolveEffectiveCwd } from "../../lib/env.ts";
import { sanitizeLine, shortenPath } from "../../lib/format.ts";
import { isInsideReal, realPathOfNearest } from "../../lib/path.ts";
import { reuseText } from "../../lib/tui/chrome.ts";
import { elapsedSuffix, reuseCallText, startToolProgress, syncElapsedTimer } from "../../lib/tui/tool.ts";
import { isFormatEnabled, loadConfig } from "./config.ts";
import { withDeadline } from "./deadline.ts";
import type { FormatExtractor } from "./extract/file.ts";
import { detectFormat, supportedExtensions, unsupportedHint, type FormatId } from "./formats.ts";
import { formatPage } from "./paging.ts";
import { formatReadCall, formatReadResult } from "./render.ts";
import { ReadOutput, ReadParams, MAX_CHARS, MIN_CHARS, TOOL_NAME, type ReadArgs, type ReadResult } from "./schema.ts";

/** Resolve a request path under `root`, refusing anything that escapes it. */
function resolveReadPath(root: string, rawPath: string): { display: string; abs: string } {
	// Resolve on the raw path; sanitize only the displayed/error strings, so a
	// pathological control character cannot hide a path or forge a transcript line.
	const trimmed = rawPath.trim();
	if (!trimmed) throw new Error("path is required.");
	const candidate = isAbsolute(trimmed) ? trimmed : join(root, trimmed);
	const abs = realPathOfNearest(candidate);
	if (!isInsideReal(root, abs)) {
		throw new Error(
			`Refusing to read "${sanitizeLine(trimmed)}" outside the working directory (${sanitizeLine(shortenPath(root))}). Copy the file under it or pass a path inside it.`,
		);
	}
	return { display: sanitizeLine(trimmed), abs };
}

/** Stat the file and raise a model-readable error for a missing/unreadable target. */
async function statFile(abs: string, display: string, maxFileBytes: number, tool: string): Promise<number> {
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
		throw new Error(`File is ${info.size} bytes, larger than the ${maxFileBytes}-byte limit for ${tool}.`);
	}
	return info.size;
}

/** Per-format extractor overrides, for tests; the format table supplies the rest. */
export interface ReadToolDeps {
	extractors?: Partial<Record<FormatId, FormatExtractor>>;
	/** Test seam: replace the configured `file-read.extractTimeoutMs`. */
	timeoutMs?: number;
}

export function registerReadTool(pi: ExtensionAPI, deps: ReadToolDeps = {}): void {
	pi.registerTool({
		name: TOOL_NAME,
		label: "Read document",
		description:
			"Read a local PDF, DOCX, DOC, ODT, RTF, or XLSX file and return its extracted text, pageable with " +
			"startIndex/maxChars. Extraction runs in process, so no external tools are needed; a read that outlasts " +
			"file-read.extractTimeoutMs fails with the limit named.",
		promptSnippet: "Read a PDF, DOCX, DOC, ODT, RTF, or XLSX as text, paged with startIndex/maxChars.",
		promptGuidelines: [
			"Use read_doc for .pdf, .docx, .doc, .odt, .rtf, and .xlsx; the built-in read tool is for text and images.",
			"Only text survives: tables, images, and formatting are dropped, and an .xlsx read returns one [Sheet] heading per worksheet followed by tab-separated rows of the workbook's displayed values.",
			"A scanned or image-only PDF has no text layer, so it returns little or nothing; there is no OCR.",
		],
		parameters: ReadParams,
		outputSchema: ReadOutput,
		annotations: { readOnlyHint: true, openWorldHint: false },

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const args = params as ReadArgs;
			const config = loadConfig(ctx.cwd);
			const root = resolveEffectiveCwd(ctx.cwd);
			const { display, abs } = resolveReadPath(root, args.path);

			const format = detectFormat(display);
			if (!format) {
				const hint = unsupportedHint(display);
				if (hint) throw new Error(hint);
				throw new Error(
					`Unsupported file format for ${TOOL_NAME}. Supported extensions: ${supportedExtensions().join(", ")}.`,
				);
			}
			if (!isFormatEnabled(config, format.id)) {
				throw new Error(
					`${format.label} extraction is disabled in the bytefly.json file-read section (file-read.formats.${format.id} = false).`,
				);
			}

			const size = await statFile(abs, display, config.maxFileBytes, TOOL_NAME);
			const extractor = deps.extractors?.[format.id] ?? format.extract;
			const timeoutMs = deps.timeoutMs ?? config.extractTimeoutMs;
			startToolProgress(onUpdate);
			const text = await withDeadline(() => extractor({ path: abs, signal }), {
				timeoutMs,
				signal,
				timeoutMessage:
					`Extraction of ${display} did not finish within ${timeoutMs} ms (file-read.extractTimeoutMs). ` +
					`The ${format.label} parser was abandoned; raise the limit or read a smaller file.`,
			});

			const startIndex = typeof args.startIndex === "number" ? Math.max(0, Math.round(args.startIndex)) : 0;
			const requested = typeof args.maxChars === "number" ? args.maxChars : config.maxChars;
			const maxChars = Math.min(config.maxChars, MAX_CHARS, Math.max(MIN_CHARS, Math.round(requested)));

			const formatted = formatPage({
				tool: TOOL_NAME,
				path: display,
				format: format.id,
				bytes: size,
				text,
				startIndex,
				maxChars,
			});

			const result: ReadResult = {
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
			const text = reuseCallText(context?.lastComponent, "", "middle");
			text.setText(
				formatReadCall(TOOL_NAME, args as ReadArgs, theme, { cwd, argsComplete: context?.argsComplete ?? true }),
			);
			return text;
		},

		renderResult(result, options, theme, context) {
			const startedAt = syncElapsedTimer(options.isPartial, context);
			const progress = options.isPartial && startedAt !== undefined ? elapsedSuffix(theme, Date.now() - startedAt) : "";
			const isError = context?.isError ?? result.isError ?? false;
			const text = reuseText(context?.lastComponent);
			text.setText(
				formatReadResult(
					{ content: result.content, details: result.details, isError },
					{ ...options, progress },
					theme,
				),
			);
			return text;
		},
	});
}
