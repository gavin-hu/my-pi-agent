import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setDocxExtractorForTests } from "./extract/docx.ts";
import { setPdfExtractorForTests } from "./extract/pdf.ts";
import { registerDocTool, TOOL_NAME } from "./tool.ts";
import { ansiTheme, fakeTheme, createFakePi } from "../../test/helpers/fakes.ts";
import { makeDocFixture } from "../../test/helpers/fixtures/doc.ts";
import { tempDir, useEnv } from "../../test/helpers/env.ts";
import { canCreateSymlinks } from "../../test/helpers/platform.ts";

type AnyFn = (...args: any[]) => any;
type Tool = { execute: AnyFn; renderCall: AnyFn; renderResult: AnyFn };

const fixture = makeDocFixture();
const agentDir = tempDir("doc-tool-agent-");
afterAll(() => fixture.remove());

// Windows requires Developer Mode/admin to create symlinks; skip those tests
// rather than fail when the privilege is unavailable.
const symlinkTest = (canCreateSymlinks() ? test : test.skip) as typeof test;

beforeEach(() => {
	// A test run started from inside a worktree exports PI_WORKTREE_ROOT; clear it
	// so the tool resolves paths under each test's own cwd, not the worktree.
	useEnv({ PI_CODING_AGENT_DIR: agentDir, PI_WORKTREE_ROOT: undefined });
});

afterEach(() => {
	setPdfExtractorForTests(undefined);
	setDocxExtractorForTests(undefined);
});

function installTool(): Tool {
	const { pi, tools } = createFakePi();
	registerDocTool(pi);
	return tools.get(TOOL_NAME) as Tool;
}

function ctxFor(cwd: string): any {
	return { cwd, mode: "print", hasUI: false };
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

describe("read_doc tool", () => {
	test("extracts a PDF and returns matching structuredContent", async () => {
		setPdfExtractorForTests(async () => "hello world");
		fixture.write("a.pdf", "bytes");

		const result = await installTool().execute("call-1", { path: "a.pdf" }, undefined, undefined, ctxFor(fixture.root));
		expect(result.content[0].text).toContain("hello world");
		expect(result.details).toMatchObject({
			path: "a.pdf",
			format: "pdf",
			bytes: 5,
			chars: 11,
			truncated: false,
		});
		expect(result.structuredContent).toEqual(result.details);
	});

	test("pages with startIndex and maxChars", async () => {
		setPdfExtractorForTests(async () => "x".repeat(250));
		fixture.write("paged.pdf", "x");

		const result = await installTool().execute(
			"call-1",
			{ path: "paged.pdf", startIndex: 0, maxChars: 200 },
			undefined,
			undefined,
			ctxFor(fixture.root),
		);
		expect(result.details.text).toBe("x".repeat(200));
		expect(result.details.truncated).toBe(true);
		expect(result.details.nextIndex).toBe(200);
	});

	test("rejects an unsupported extension", async () => {
		await expect(
			installTool().execute("call-1", { path: "notes.txt" }, undefined, undefined, ctxFor(fixture.root)),
		).rejects.toThrow(/Unsupported document format/);
	});

	test("gives a targeted hint for a legacy .doc file", async () => {
		await expect(
			installTool().execute("call-1", { path: "old.doc" }, undefined, undefined, ctxFor(fixture.root)),
		).rejects.toThrow(/convert it to \.docx/);
	});

	test("rejects a format disabled in doc.json", async () => {
		const cwd = tempDir("doc-tool-disabled-");
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		writeFileSync(join(cwd, ".pi", "doc.json"), JSON.stringify({ formats: { pdf: false } }));
		writeFileSync(join(cwd, "a.pdf"), "x");
		setPdfExtractorForTests(async () => "text");

		await expect(installTool().execute("call-1", { path: "a.pdf" }, undefined, undefined, ctxFor(cwd))).rejects.toThrow(
			/disabled in doc\.json/,
		);
	});

	test("rejects a file larger than the configured limit", async () => {
		const cwd = tempDir("doc-tool-big-");
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		writeFileSync(join(cwd, ".pi", "doc.json"), JSON.stringify({ maxFileBytes: 1024 }));
		writeFileSync(join(cwd, "big.pdf"), "x".repeat(2048));

		await expect(
			installTool().execute("call-1", { path: "big.pdf" }, undefined, undefined, ctxFor(cwd)),
		).rejects.toThrow(/larger than the 1024-byte limit/);
	});

	test("refuses a path that escapes the root", async () => {
		await expect(
			installTool().execute("call-1", { path: "../outside/secret.txt" }, undefined, undefined, ctxFor(fixture.root)),
		).rejects.toThrow(/outside the working directory/);
	});

	symlinkTest("refuses a symlink that leaves the root", async () => {
		await expect(
			installTool().execute("call-1", { path: "escape.pdf" }, undefined, undefined, ctxFor(fixture.root)),
		).rejects.toThrow(/outside the working directory/);
	});

	test("renderResult strips control characters from the summary", () => {
		const result = {
			details: {
				path: "a\u0001b.pdf",
				format: "pdf",
				bytes: 1,
				chars: 1,
				startIndex: 0,
				nextIndex: 1,
				truncated: false,
				text: "x",
			},
			content: [{ type: "text", text: "x" }],
		};
		const rendered = installTool().renderResult(result, { isPartial: false }, fakeTheme).render(80).join("\n");
		expect(rendered).toContain("a b.pdf");
	});

	test("keeps theme colours in the rendered summary", () => {
		const rendered = installTool().renderResult(docResult({}), { isPartial: false }, ansiTheme).render(80).join("\n");
		expect(rendered).toContain("\u001b[38;2;0;0;0m");
		expect(rendered).not.toContain(" [38;2;0;0;0m");
	});

	test("shows the returned range and continuation note when truncated", () => {
		const rendered = installTool()
			.renderResult(docResult({ nextIndex: 40000, truncated: true }), { isPartial: false }, fakeTheme)
			.render(80)
			.join("\n");
		expect(rendered).toContain("1–40000 of 42478 chars");
		expect(rendered).toContain("more at 40000");
	});

	test("marks a non-first final page complete", () => {
		const rendered = installTool()
			.renderResult(docResult({ startIndex: 40000, nextIndex: 42478 }), { isPartial: false }, fakeTheme)
			.render(80)
			.join("\n");
		expect(rendered).toContain("40001–42478 of 42478 chars");
		expect(rendered).toContain("complete");
	});

	test("renders a path with a newline on one line", () => {
		const lines = installTool().renderCall({ path: "a\nb.pdf" }, fakeTheme).render(80);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain("a b.pdf");
	});

	test("sanitizes an error message", () => {
		const result = { isError: true, content: [{ type: "text", text: "Error: bad\u0001path" }] };
		const rendered = installTool().renderResult(result, { isPartial: false }, fakeTheme).render(80).join("\n");
		expect(rendered).toContain("bad path");
		expect(rendered).not.toContain("\u0001");
	});
});
