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
import type { DocExtractor } from "./extract/file.ts";
import { detectFormat, supportedExtensions, unsupportedHint, type FormatId } from "./formats.ts";
import { formatDoc } from "./paging.ts";
import { formatDocCall, formatDocResult } from "./render.ts";
import { DocOutput, DocParams, MAX_CHARS, MIN_CHARS, TOOL_NAME, type DocArgs, type DocResult } from "./schema.ts";

export { TOOL_NAME } from "./schema.ts";

/** Resolve a request path under `root`, refusing anything that escapes it. */
function resolveDocument(root: string, rawPath: string): { display: string; abs: string } {
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
async function statFile(abs: string, display: string, maxFileBytes: number): Promise<number> {
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
	return info.size;
}

/** Per-format extractor overrides, for tests; the format table supplies the rest. */
export interface DocToolDeps {
	extractors?: Partial<Record<FormatId, DocExtractor>>;
}

export function registerDocTool(pi: ExtensionAPI, deps: DocToolDeps = {}): void {
	pi.registerTool({
		name: TOOL_NAME,
		label: "Read document",
		description:
			"Read a local PDF, DOCX, DOC, ODT, RTF, or XLSX file and return its extracted text, pageable with " +
			"startIndex/maxChars. Extraction runs in process, so no external tools are needed.",
		promptSnippet: "Read a PDF, DOCX, DOC, ODT, RTF, or XLSX as text, paged with startIndex/maxChars.",
		promptGuidelines: [
			"Use read_doc for .pdf/.docx/.doc/.odt/.rtf/.xlsx; the built-in read tool is for text and images.",
			"Extraction returns plain text only; tables, images, and formatting are dropped.",
		],
		parameters: DocParams,
		outputSchema: DocOutput,
		exposure: "direct",
		defaultActive: true,
		annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const args = params as DocArgs;
			const config = loadConfig(ctx.cwd);
			const root = resolveEffectiveCwd(ctx.cwd);
			const { display, abs } = resolveDocument(root, args.path);

			const format = detectFormat(display);
			if (!format) {
				const hint = unsupportedHint(display);
				if (hint) throw new Error(hint);
				throw new Error(`Unsupported document format. Supported extensions: ${supportedExtensions().join(", ")}.`);
			}
			if (!isFormatEnabled(config, format.id)) {
				throw new Error(
					`${format.label} extraction is disabled in the bytefly.json document section (document.formats.${format.id} = false).`,
				);
			}

			const size = await statFile(abs, display, config.maxFileBytes);
			const extractor = deps.extractors?.[format.id] ?? format.extract;
			startToolProgress(onUpdate);
			const text = await extractor({ path: abs, signal });

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
			const text = reuseCallText(context?.lastComponent, "", "middle");
			text.setText(formatDocCall(args as DocArgs, theme, { cwd, argsComplete: context?.argsComplete ?? true }));
			return text;
		},

		renderResult(result, options, theme, context) {
			const startedAt = syncElapsedTimer(options.isPartial, context);
			const progress = options.isPartial && startedAt !== undefined ? elapsedSuffix(theme, Date.now() - startedAt) : "";
			const isError = context?.isError ?? result.isError ?? false;
			const text = reuseText(context?.lastComponent);
			text.setText(
				formatDocResult({ content: result.content, details: result.details, isError }, { ...options, progress }, theme),
			);
			return text;
		},
	});
}
