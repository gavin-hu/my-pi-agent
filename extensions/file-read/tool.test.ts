/**
 * File-read tool capability suite.
 *
 * One suite over the `read_doc` surface and the modules it composes: config
 * loading and clamping, the format table, paging and the transcript summary, the
 * renderers, registration, and the handler's guards. The extractors themselves
 * are covered by `extract/extract.test.ts`; here they are stubbed except for the
 * two real-file end-to-end reads that prove the table is wired.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { resetCapabilitiesCache, setCapabilities } from "@earendil-works/pi-tui";
import { DEFAULT_CONFIG, isFormatEnabled, loadConfig, normalizeConfig } from "./config.ts";
import { withDeadline } from "./deadline.ts";
import type { FormatExtractor } from "./extract/file.ts";
import { FORMATS, detectFormat, supportedExtensions, unsupportedHint, type FormatId } from "./formats.ts";
import fileRead from "./index.ts";
import { formatPage, summarizeRead } from "./paging.ts";
import { formatReadCall, previewText, renderReadPath } from "./render.ts";
import { registerReadTool } from "./tool.ts";
import { TOOL_NAME } from "./schema.ts";
import { ENV_DISABLED_EXTENSIONS } from "../../lib/env.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { createFakePi, fakeTheme } from "../../test/helpers/fakes.ts";
import { makeReadFixture } from "../../test/helpers/fixtures/file-read.ts";
import { buildPdf, legacyDocBytes } from "../../test/helpers/fixtures/documents.ts";
import { tempDir, useEnv, withAgentDir, withEnv } from "../../test/helpers/env.ts";
import { canCreateSymlinks } from "../../test/helpers/platform.ts";
import { settle } from "../../test/helpers/process.ts";

type AnyFn = (...args: any[]) => any;
type Tool = { execute: AnyFn; renderCall: AnyFn; renderResult: AnyFn };

const TIMEOUT = "Extraction did not finish within 20 ms (file-read.extractTimeoutMs).";

const fixture = makeReadFixture();
const agentDir = tempDir("doc-tool-agent-");
afterAll(() => fixture.remove());

// Windows requires Developer Mode/admin to create symlinks; skip that guard
// rather than fail when the privilege is unavailable.
const symlinkTest = (canCreateSymlinks() ? test : test.skip) as typeof test;

beforeEach(() => {
	// A test run started from inside a worktree exports PI_WORKTREE_ROOT; clear it
	// so the tool resolves paths under each test's own cwd, not the worktree.
	useEnv({ PI_CODING_AGENT_DIR: agentDir, PI_WORKTREE_ROOT: undefined });
});

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

describe("config", () => {
	test("clamps numeric fields over the defaults", () => {
		const config = normalizeConfig({ maxFileBytes: 10, maxChars: 5, extractTimeoutMs: 1 });
		expect(config.maxFileBytes).toBe(1_024);
		expect(config.maxChars).toBe(200);
		expect(config.extractTimeoutMs).toBe(1_000);
	});

	test("merges formats over registry defaults and ignores unknown or non-boolean keys", () => {
		const config = normalizeConfig({ formats: { pdf: false, xlsx: false, docx: "no", pptx: true } });
		expect(config.formats.pdf).toBe(false);
		expect(config.formats.docx).toBe(true);
		expect(config.formats.xlsx).toBe(false);
		expect("pptx" in config.formats).toBe(false);
	});

	test("enables every registered format by default", () => {
		expect(DEFAULT_CONFIG.formats).toEqual({ pdf: true, docx: true, doc: true, odt: true, rtf: true, xlsx: true });
	});

	test("uses the registry defaults when the file is missing", () => {
		expect(normalizeConfig(undefined).formats).toEqual(DEFAULT_CONFIG.formats);
	});

	test("project config overrides global and keeps registry defaults", async () => {
		await withAgentDir(async (dir) => {
			writeFileSync(
				join(dir, "bytefly.json"),
				JSON.stringify({ "file-read": { maxChars: 1000, formats: { pdf: false } } }),
			);
			const cwd = tempDir("doc-config-");
			mkdirSync(join(cwd, ".pi"), { recursive: true });
			writeFileSync(join(cwd, ".pi", "bytefly.json"), JSON.stringify({ "file-read": { formats: { pdf: true } } }));

			const config = loadConfig(cwd);
			expect(config.maxChars).toBe(1000);
			expect(config.formats.pdf).toBe(true);
			expect(config.formats.docx).toBe(true);
			expect(isFormatEnabled(config, "pdf")).toBe(true);
		});
	});
});

// ---------------------------------------------------------------------------
// Format selection
// ---------------------------------------------------------------------------

describe("format selection", () => {
	test("registry ids and extensions are unique and dotted", () => {
		const ids = FORMATS.map((format) => format.id);
		expect(new Set(ids).size).toBe(ids.length);

		const extensions = supportedExtensions();
		expect(new Set(extensions).size).toBe(extensions.length);
		for (const extension of extensions) expect(extension.startsWith(".")).toBe(true);
	});

	test("maps supported extensions case-insensitively", () => {
		const cases = [
			["a.pdf", "pdf"],
			["a.DOCX", "docx"],
			["a.DOC", "doc"],
			["a.ODT", "odt"],
			["a.RTF", "rtf"],
			["a.XLSX", "xlsx"],
		] as const;
		for (const [path, id] of cases) expect(detectFormat(path)?.id).toBe(id);
	});

	test("returns no format for unsupported paths", () => {
		expect(detectFormat("a.txt")).toBeUndefined();
		expect(detectFormat("noext")).toBeUndefined();
	});

	test("returns no hint for a supported file", () => {
		expect(unsupportedHint("old.doc")).toBeUndefined();
		expect(unsupportedHint("old.pdf")).toBeUndefined();
	});

	test("names the legacy .xls case", () => {
		expect(unsupportedHint("old.xls")).toMatch(/\.xlsx/);
	});
});

// ---------------------------------------------------------------------------
// Paging
// ---------------------------------------------------------------------------

describe("paging", () => {
	const base = { tool: TOOL_NAME, path: "a.pdf", format: "pdf" as const, bytes: 100 };

	test("returns the whole text when it fits", () => {
		const page = formatPage({ ...base, text: "hello", startIndex: 0, maxChars: 200 });
		expect(page.body).toBe("hello");
		expect(page.truncated).toBe(false);
		expect(page.nextIndex).toBe(5);
		expect(page.chars).toBe(5);
		expect(page.text).toContain("a.pdf");
	});

	test("slices by code point and names the next index", () => {
		const page = formatPage({ ...base, text: "a😀b😀c", startIndex: 1, maxChars: 3 });
		expect(page.body).toBe("😀b😀");
		expect(page.nextIndex).toBe(4);
		expect(page.truncated).toBe(true);
		expect(page.text).toContain("startIndex=4");
	});

	test("reports an empty document", () => {
		const page = formatPage({ ...base, text: "", startIndex: 0, maxChars: 200 });
		expect(page.body).toBe("");
		expect(page.chars).toBe(0);
		expect(page.text).toContain("no extractable text");
	});

	test("reports a startIndex past the end", () => {
		const page = formatPage({ ...base, text: "abc", startIndex: 10, maxChars: 200 });
		expect(page.body).toBe("");
		expect(page.nextIndex).toBe(3);
		expect(page.text).toContain("no text at startIndex 10");
	});

	test("names the document rather than assuming a scanned PDF", () => {
		const page = formatPage({ ...base, format: "docx", text: "", startIndex: 0, maxChars: 200 });
		expect(page.text).toContain("no extractable text");
		expect(page.text).not.toContain("PDF");
	});
});

describe("transcript summary", () => {
	const base = { format: "pdf" as const, chars: 42478, startIndex: 0 };

	test("shows the humanized total for a complete first read", () => {
		const summary = summarizeRead({ ...base, nextIndex: 42478, truncated: false });
		expect(summary.format).toBe("PDF");
		expect(summary.detail).toBe("42,478 chars");
		expect(summary.note).toBeUndefined();
	});

	test("shows the returned range and where to continue when truncated", () => {
		const summary = summarizeRead({ ...base, nextIndex: 40000, truncated: true });
		expect(summary.detail).toBe("chars 1–40,000 of 42,478");
		expect(summary.note).toBe("next at 40,000");
		expect(summary.truncated).toBe(true);
	});

	test("marks a non-first final page complete", () => {
		const summary = summarizeRead({ ...base, startIndex: 40000, nextIndex: 42478, truncated: false });
		expect(summary.detail).toBe("chars 40,001–42,478 of 42,478");
		expect(summary.note).toBe("complete");
	});

	test("reports an out-of-range startIndex without a bogus range", () => {
		const summary = summarizeRead({ format: "pdf", chars: 3, startIndex: 10, nextIndex: 3, truncated: false });
		expect(summary.detail).toBe("no text at 10 of 3 chars");
		expect(summary.note).toBeUndefined();
	});

	test("reports an empty document as having no extractable text", () => {
		const summary = summarizeRead({ format: "pdf", chars: 0, startIndex: 0, nextIndex: 0, truncated: false });
		expect(summary.detail).toBe("no extractable text");
		expect(summary.note).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// Deadline
// ---------------------------------------------------------------------------

describe("deadline", () => {
	test("returns work that finishes first", async () => {
		const value = await withDeadline(async () => "text", { timeoutMs: 1_000, timeoutMessage: TIMEOUT });
		expect(value).toBe("text");
	});

	test("rethrows the work's own error unchanged", async () => {
		const failure = new Error("the parser gave up");
		const pending = withDeadline(async () => Promise.reject(failure), { timeoutMs: 1_000, timeoutMessage: TIMEOUT });
		await expect(pending).rejects.toBe(failure);
	});

	test("rejects with the caller's message once the deadline passes", async () => {
		const pending = withDeadline(() => new Promise<string>(() => {}), { timeoutMs: 20, timeoutMessage: TIMEOUT });
		await expect(pending).rejects.toThrow(TIMEOUT);
	});

	test("prefers the turn's abort reason over the deadline", async () => {
		const controller = new AbortController();
		const pending = withDeadline(
			() =>
				new Promise<string>((_resolve, reject) => {
					controller.signal.addEventListener("abort", () => reject(controller.signal.reason));
				}),
			{ timeoutMs: 10_000, timeoutMessage: TIMEOUT, signal: controller.signal },
		);
		controller.abort(new Error("the user cancelled"));
		await expect(pending).rejects.toThrow("the user cancelled");
	});

	test("rejects immediately for an already-aborted turn", async () => {
		const controller = new AbortController();
		controller.abort(new Error("gone"));
		const pending = withDeadline(() => new Promise<string>(() => {}), {
			timeoutMs: 10_000,
			timeoutMessage: TIMEOUT,
			signal: controller.signal,
		});
		await expect(pending).rejects.toThrow("gone");
	});

	test("swallows a result that arrives after the deadline", async () => {
		let finish: ((value: string) => void) | undefined;
		const pending = withDeadline(
			() =>
				new Promise<string>((resolve) => {
					finish = resolve;
				}),
			{ timeoutMs: 20, timeoutMessage: TIMEOUT },
		);
		await expect(pending).rejects.toThrow(TIMEOUT);
		finish?.("too late");
		// Let the abandoned promise settle; an unhandled rejection would fail the run.
		await settle();
	});

	test("swallows a rejection that arrives after the deadline", async () => {
		let fail: ((error: Error) => void) | undefined;
		const pending = withDeadline(
			() =>
				new Promise<string>((_resolve, reject) => {
					fail = reject;
				}),
			{ timeoutMs: 20, timeoutMessage: TIMEOUT },
		);
		await expect(pending).rejects.toThrow(TIMEOUT);
		fail?.(new Error("the parser failed after we gave up"));
		await settle();
	});
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("path rendering", () => {
	beforeEach(() => {
		// Deterministic, hyperlink-free capabilities; the link test opts in.
		setCapabilities({ images: null, trueColor: false, hyperlinks: false });
	});

	afterEach(() => {
		resetCapabilitiesCache();
	});

	test("shortens a home-directory path to ~", () => {
		expect(renderReadPath(join(homedir(), "docs", "a.pdf"), fakeTheme, "/work")).toBe("~/docs/a.pdf");
	});

	test("leaves a path outside home unchanged", () => {
		const outside = join(dirname(homedir()), "outside-home", "a.pdf");
		expect(renderReadPath(outside, fakeTheme, "/work")).toBe(outside);
	});

	test("collapses a path with control characters onto one line", () => {
		expect(renderReadPath("a\nb.pdf", fakeTheme, "/work")).toBe("a b.pdf");
	});

	test("reports a missing path argument", () => {
		expect(renderReadPath(undefined, fakeTheme, "/work")).toBe("[invalid arg]");
	});

	test("links the path when the terminal supports OSC 8", () => {
		setCapabilities({ images: null, trueColor: false, hyperlinks: true });
		const rendered = renderReadPath("docs/a.pdf", fakeTheme, "/work");
		expect(rendered).toContain("\u001b]8;;file://");
		expect(rendered).toContain("docs/a.pdf");
	});
});

describe("preview", () => {
	test("caps the preview and reports the overflow", () => {
		const { body, moreLines } = previewText("a\nb\nc\nd", 2);
		expect(body).toBe("a\nb");
		expect(moreLines).toBe(2);
	});

	test("strips control characters, expands tabs, and drops trailing blanks", () => {
		const { body, moreLines } = previewText("a\tb\u0001\n\n", 5);
		expect(body).toBe(`a${" ".repeat(3)}b `);
		expect(moreLines).toBe(0);
	});
});

describe("call rendering", () => {
	test("humanizes the paging options", () => {
		const rendered = formatReadCall(TOOL_NAME, { path: "spec.pdf", startIndex: 40000, maxChars: 80000 }, fakeTheme, {
			cwd: "/work",
		});
		expect(rendered).toContain("read_doc");
		expect(rendered).toContain("spec.pdf");
		expect(rendered).toContain("(from 40k, max 80k)");
	});

	test("omits options that were not set", () => {
		const rendered = formatReadCall(TOOL_NAME, { path: "spec.pdf" }, fakeTheme, { cwd: "/work" });
		expect(rendered).not.toContain("(from");
		expect(rendered).not.toContain("(max");
	});

	test("omits a zero startIndex", () => {
		const rendered = formatReadCall(TOOL_NAME, { path: "spec.pdf", startIndex: 0 }, fakeTheme, { cwd: "/work" });
		expect(rendered).not.toContain("(from");
	});

	test("reads a path that has not streamed yet as pending, not invalid", () => {
		const pending = formatReadCall(TOOL_NAME, {} as never, fakeTheme, { cwd: "/work", argsComplete: false });
		expect(pending).toContain("read_doc ...");
		expect(pending).not.toContain("[invalid arg]");
		const invalid = formatReadCall(TOOL_NAME, {} as never, fakeTheme, { cwd: "/work" });
		expect(invalid).toContain("[invalid arg]");
	});
});

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

describe("extension registration", () => {
	test("registers nothing when disabled through PI_DISABLED_EXTENSIONS", async () => {
		await withEnv({ [ENV_DISABLED_EXTENSIONS]: "file-read" }, () => {
			const { pi, tools, handlers } = createFakePi();
			fileRead(pi);
			expect(tools.size).toBe(0);
			expect(handlers.size).toBe(0);
		});
	});

	test("registers read_doc as a direct, active, read-only tool", () => {
		const { pi, tools } = createFakePi();
		fileRead(pi);

		const tool = tools.get(TOOL_NAME);
		expect(tool).toBeDefined();
		expect(tool.exposure).toBeUndefined();
		expect(tool.defaultActive).toBeUndefined();
		expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: false });
		expect(tool.outputSchema).toBeDefined();
		expect(typeof tool.execute).toBe("function");
		expect(typeof tool.renderCall).toBe("function");
		expect(typeof tool.renderResult).toBe("function");
	});
});

// ---------------------------------------------------------------------------
// read_doc handler
// ---------------------------------------------------------------------------

/** An extractor stub that returns `text` or throws it. */
function fakeExtractor(text: string | Error): FormatExtractor {
	return async () => {
		if (text instanceof Error) throw text;
		return text;
	};
}

function installTool(
	extractors: Partial<Record<FormatId, FormatExtractor>> = {},
	options: { timeoutMs?: number } = {},
): Tool {
	const { pi, tools } = createFakePi();
	registerReadTool(pi, { extractors, timeoutMs: options.timeoutMs });
	return tools.get(TOOL_NAME) as Tool;
}

function ctxFor(cwd: string): unknown {
	return fakeCtx({ cwd, mode: "print" }).ctx;
}

function run(tool: Tool, params: Record<string, unknown>, cwd = fixture.root): Promise<any> {
	return tool.execute("call-1", params, undefined, undefined, ctxFor(cwd));
}

function docResult(overrides: Record<string, unknown>): any {
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

describe("read_doc extraction", () => {
	test("extracts a PDF and returns matching structuredContent", async () => {
		fixture.write("a.pdf", "bytes");
		const result = await run(installTool({ pdf: fakeExtractor("hello world") }), { path: "a.pdf" });

		expect(result.content[0].text).toContain("hello world");
		expect(result.details).toMatchObject({ path: "a.pdf", format: "pdf", bytes: 5, chars: 11, truncated: false });
		expect(result.structuredContent).toEqual(result.details);
	});

	test("extracts a real PDF end to end through the format table", async () => {
		fixture.write("real.pdf", buildPdf("Hello PDF"));
		const result = await run(installTool(), { path: "real.pdf" });
		expect(result.details.format).toBe("pdf");
		expect(result.details.text).toContain("Hello PDF");
	});

	test("extracts a real legacy .doc end to end through the format table", async () => {
		const bytes = legacyDocBytes();
		fixture.write("legacy.doc", bytes);
		const result = await run(installTool(), { path: "legacy.doc" });

		expect(result.details.format).toBe("doc");
		expect(result.details.bytes).toBe(bytes.byteLength);
		expect(result.details.text).toContain("Second paragraph.");
	});

	test("extracts an XLSX and returns matching structuredContent", async () => {
		fixture.write("a.xlsx", "bytes");
		const result = await run(installTool({ xlsx: fakeExtractor("[Sheet1]\na\tb") }), { path: "a.xlsx" });

		expect(result.content[0].text).toContain("[Sheet1]");
		expect(result.details).toMatchObject({ path: "a.xlsx", format: "xlsx", bytes: 5 });
		expect(result.structuredContent).toEqual(result.details);
	});

	test("reads every word-processing format through its extractor", async () => {
		const extractors = {
			docx: fakeExtractor("body"),
			doc: fakeExtractor("body"),
			odt: fakeExtractor("body"),
			rtf: fakeExtractor("body"),
		};
		const tool = installTool(extractors);
		const cases = [
			["a.docx", "docx"],
			["a.doc", "doc"],
			["a.odt", "odt"],
			["a.rtf", "rtf"],
		] as const;

		for (const [path, format] of cases) {
			fixture.write(path, "bytes");
			const result = await run(tool, { path });
			expect(result.content[0].text).toContain("body");
			expect(result.details).toMatchObject({ path, format, bytes: 5 });
			expect(result.structuredContent).toEqual(result.details);
		}
	});

	test("pages with startIndex and maxChars", async () => {
		fixture.write("paged.pdf", "x");
		const result = await run(installTool({ pdf: fakeExtractor("x".repeat(250)) }), {
			path: "paged.pdf",
			startIndex: 0,
			maxChars: 200,
		});

		expect(result.details.text).toBe("x".repeat(200));
		expect(result.details.truncated).toBe(true);
		expect(result.details.nextIndex).toBe(200);
	});
});

describe("read_doc guards", () => {
	test("rejects an unsupported extension", async () => {
		await expect(run(installTool(), { path: "notes.txt" })).rejects.toThrow(/Unsupported file format/);
	});

	test("gives a targeted hint for a legacy .xls file", async () => {
		await expect(run(installTool(), { path: "old.xls" })).rejects.toThrow(/convert it to \.xlsx/);
	});

	test("surfaces an extractor error message", async () => {
		fixture.write("bad.pdf", "bytes");
		await expect(run(installTool({ pdf: fakeExtractor(new Error("bad file")) }), { path: "bad.pdf" })).rejects.toThrow(
			/bad file/,
		);
	});

	test("rejects a format disabled in the bytefly.json file-read section", async () => {
		const cwd = tempDir("doc-tool-disabled-");
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		writeFileSync(join(cwd, ".pi", "bytefly.json"), JSON.stringify({ "file-read": { formats: { pdf: false } } }));
		writeFileSync(join(cwd, "a.pdf"), "x");

		await expect(run(installTool(), { path: "a.pdf" }, cwd)).rejects.toThrow(
			/disabled in the bytefly\.json file-read section/,
		);
	});

	test("rejects a file larger than the configured limit", async () => {
		const cwd = tempDir("doc-tool-big-");
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		writeFileSync(join(cwd, ".pi", "bytefly.json"), JSON.stringify({ "file-read": { maxFileBytes: 1024 } }));
		writeFileSync(join(cwd, "big.pdf"), "x".repeat(2048));

		await expect(run(installTool(), { path: "big.pdf" }, cwd)).rejects.toThrow(/larger than the 1024-byte limit/);
	});

	test("reports a missing target by name", async () => {
		await expect(run(installTool(), { path: "missing.pdf" })).rejects.toThrow(/File not found: missing\.pdf/);
	});

	test("refuses a target that is not a file", async () => {
		mkdirSync(join(fixture.root, "dir.pdf"));
		await expect(run(installTool(), { path: "dir.pdf" })).rejects.toThrow(/Not a file: dir\.pdf/);
	});

	test("refuses a path that escapes the root", async () => {
		await expect(run(installTool(), { path: "../outside/secret.txt" })).rejects.toThrow(
			/outside the working directory/,
		);
	});

	symlinkTest("refuses a symlink that leaves the root", async () => {
		await expect(run(installTool(), { path: "escape.pdf" })).rejects.toThrow(/outside the working directory/);
	});
});

describe("read_doc deadline", () => {
	test("fails with the limit named when extraction outlasts the deadline", async () => {
		fixture.write("slow.pdf", "bytes");
		const tool = installTool({ pdf: () => new Promise(() => {}) }, { timeoutMs: 20 });

		const pending = run(tool, { path: "slow.pdf" });

		await expect(pending).rejects.toThrow(/did not finish within 20 ms \(file-read\.extractTimeoutMs\)/);
		await expect(pending).rejects.toThrow(/PDF parser was abandoned/);
	});

	test("a fast read still succeeds under a tight deadline", async () => {
		fixture.write("fast.pdf", "bytes");
		const tool = installTool({ pdf: fakeExtractor("quick text") }, { timeoutMs: 5_000 });

		const result = await run(tool, { path: "fast.pdf" });

		expect(result.details.text).toContain("quick text");
	});
});

// ---------------------------------------------------------------------------
// Result rendering
// ---------------------------------------------------------------------------

function renderContext(overrides: Record<string, unknown> = {}): any {
	return { cwd: fixture.root, isError: false, ...overrides };
}

describe("result rendering", () => {
	test("leads with the format and humanized total, not the path", () => {
		const rendered = installTool()
			.renderResult(docResult({}), { isPartial: false, expanded: false }, fakeTheme, renderContext())
			.render(80)
			.join("\n");
		expect(rendered).toContain("PDF · 42,478 chars");
		expect(rendered).not.toContain("a.pdf");
	});

	test("shows the humanized range and continuation note when truncated", () => {
		const rendered = installTool()
			.renderResult(
				docResult({ nextIndex: 40000, truncated: true }),
				{ isPartial: false, expanded: false },
				fakeTheme,
				renderContext(),
			)
			.render(80)
			.join("\n");
		expect(rendered).toContain("chars 1–40,000 of 42,478");
		expect(rendered).toContain("next at 40,000");
	});

	test("marks a non-first final page complete", () => {
		const rendered = installTool()
			.renderResult(
				docResult({ startIndex: 40000, nextIndex: 42478 }),
				{ isPartial: false, expanded: false },
				fakeTheme,
				renderContext(),
			)
			.render(80)
			.join("\n");
		expect(rendered).toContain("chars 40,001–42,478 of 42,478");
		expect(rendered).toContain("complete");
	});

	test("expands to a sanitized, line-capped preview with an overflow note", () => {
		const text = Array.from({ length: 25 }, (_, i) => `line ${i}\u0001`).join("\n");
		const lines = installTool()
			.renderResult(docResult({ text }), { isPartial: false, expanded: true }, fakeTheme, renderContext())
			.render(200)
			.map((line: string) => line.trimEnd());
		const rendered = lines.join("\n");
		expect(lines[0]).toBe("PDF · 42,478 chars");
		expect(lines[1]).toBe("");
		expect(lines[2]).toBe("line 0");
		expect(rendered).toContain("line 19");
		expect(rendered).not.toContain("line 20");
		expect(rendered).toContain("(5 more lines)");
		expect(rendered).not.toContain("\u0001");
	});

	test("adds no expand hint when there is no extractable text", () => {
		const rendered = installTool()
			.renderResult(
				docResult({ chars: 0, nextIndex: 0, text: "" }),
				{ isPartial: false, expanded: false },
				fakeTheme,
				renderContext(),
			)
			.render(80)
			.join("\n");
		expect(rendered).toContain("no extractable text");
		// No text means no expandable preview, so no hint (and no trailing separator).
		expect(rendered).not.toMatch(/·\s*$/);
	});

	test("marks a partial result as reading", () => {
		const rendered = installTool()
			.renderResult(
				{ details: undefined, content: [] },
				{ isPartial: true, expanded: false },
				fakeTheme,
				renderContext(),
			)
			.render(80)
			.join("\n");
		expect(rendered).toContain("Reading...");
	});
});
