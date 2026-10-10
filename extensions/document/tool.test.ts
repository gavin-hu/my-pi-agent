import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { registerDocTool, TOOL_NAME } from "./tool.ts";
import { ansiTheme, fakeTheme, createFakePi, type FakePiOptions } from "../../test/helpers/fakes.ts";
import { makeDocumentFixture } from "../../test/helpers/fixtures/document.ts";
import { tempDir, useEnv } from "../../test/helpers/env.ts";
import { canCreateSymlinks } from "../../test/helpers/platform.ts";

type AnyFn = (...args: any[]) => any;
type Tool = { execute: AnyFn; renderCall: AnyFn; renderResult: AnyFn };
type ExecFn = NonNullable<FakePiOptions["exec"]>;

const fixture = makeDocumentFixture();
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

/** An exec stub that answers each CLI subcommand by `<command> <first arg>`. */
function cliExec(responses: Record<string, { stdout?: string; stderr?: string; code?: number }>): ExecFn {
	return async (command, args) => {
		const response = responses[`${command} ${args[0]}`] ?? { code: 1, stderr: "" };
		return { stdout: response.stdout ?? "", stderr: response.stderr ?? "", code: response.code ?? 0, killed: false };
	};
}

function installTool(exec?: ExecFn): Tool {
	const { pi, tools } = createFakePi({ exec });
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
		fixture.write("a.pdf", "bytes");
		const tool = installTool(cliExec({ "pdfcraft-cli text": { stdout: "hello world\n" } }));

		const result = await tool.execute("call-1", { path: "a.pdf" }, undefined, undefined, ctxFor(fixture.root));
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

	test("extracts an XLSX through gridcraft-cli and returns matching structuredContent", async () => {
		fixture.write("a.xlsx", "bytes");
		const tool = installTool(
			cliExec({
				"gridcraft-cli info": { stdout: JSON.stringify({ sheets: [{ name: "Sheet1", usedRange: "A1:B1" }] }) },
				"gridcraft-cli cat": { stdout: "a,b\n" },
			}),
		);

		const result = await tool.execute("call-1", { path: "a.xlsx" }, undefined, undefined, ctxFor(fixture.root));
		expect(result.content[0].text).toContain("[Sheet1]");
		expect(result.details).toMatchObject({ path: "a.xlsx", format: "xlsx", bytes: 5 });
		expect(result.structuredContent).toEqual(result.details);
	});

	test("pages with startIndex and maxChars", async () => {
		fixture.write("paged.pdf", "x");
		const tool = installTool(cliExec({ "pdfcraft-cli text": { stdout: `${"x".repeat(250)}\n` } }));

		const result = await tool.execute(
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

	test("reads every word-processing format through wordcraft-cli", async () => {
		const tool = installTool(cliExec({ "wordcraft-cli text": { stdout: "body\n" } }));
		const cases = [
			["a.docx", "docx"],
			["a.doc", "doc"],
			["a.odt", "odt"],
			["a.rtf", "rtf"],
		] as const;

		for (const [path, format] of cases) {
			fixture.write(path, "bytes");
			const result = await tool.execute("call-1", { path }, undefined, undefined, ctxFor(fixture.root));
			expect(result.content[0].text).toContain("body");
			expect(result.details).toMatchObject({ path, format, bytes: 5 });
			expect(result.structuredContent).toEqual(result.details);
		}
	});

	test("gives a targeted hint for a legacy .xls file", async () => {
		await expect(
			installTool().execute("call-1", { path: "old.xls" }, undefined, undefined, ctxFor(fixture.root)),
		).rejects.toThrow(/convert it to \.xlsx/);
	});

	test("names the install command when the CLI is missing", async () => {
		fixture.write("missing.xlsx", "bytes");
		const tool = installTool(cliExec({}));

		await expect(
			tool.execute("call-1", { path: "missing.xlsx" }, undefined, undefined, ctxFor(fixture.root)),
		).rejects.toThrow(/cargo install --git https:\/\/github\.com\/storytold\/gridcraft gridcraft-cli/);
	});

	test("surfaces a CLI error message", async () => {
		fixture.write("bad.pdf", "bytes");
		const tool = installTool(cliExec({ "pdfcraft-cli text": { code: 1, stderr: "pdfcraft-cli: bad file" } }));

		await expect(
			tool.execute("call-1", { path: "bad.pdf" }, undefined, undefined, ctxFor(fixture.root)),
		).rejects.toThrow(/bad file/);
	});

	test("rejects a format disabled in document.json", async () => {
		const cwd = tempDir("doc-tool-disabled-");
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		writeFileSync(join(cwd, ".pi", "document.json"), JSON.stringify({ formats: { pdf: false } }));
		writeFileSync(join(cwd, "a.pdf"), "x");

		await expect(
			installTool(cliExec({})).execute("call-1", { path: "a.pdf" }, undefined, undefined, ctxFor(cwd)),
		).rejects.toThrow(/disabled in document\.json/);
	});

	test("rejects a file larger than the configured limit", async () => {
		const cwd = tempDir("doc-tool-big-");
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		writeFileSync(join(cwd, ".pi", "document.json"), JSON.stringify({ maxFileBytes: 1024 }));
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

	function renderContext(overrides: Record<string, unknown> = {}): any {
		return { cwd: fixture.root, isError: false, lastComponent: undefined, ...overrides };
	}

	test("renderResult leads with the format and humanized total, not the path", () => {
		const rendered = installTool()
			.renderResult(docResult({}), { isPartial: false, expanded: false }, fakeTheme, renderContext())
			.render(80)
			.join("\n");
		expect(rendered).toContain("PDF · 42k chars");
		expect(rendered).not.toContain("a.pdf");
	});

	test("keeps theme colours in the rendered summary", () => {
		const rendered = installTool()
			.renderResult(docResult({}), { isPartial: false, expanded: false }, ansiTheme, renderContext())
			.render(80)
			.join("\n");
		expect(rendered).toContain("\u001b[38;2;0;0;0m");
		expect(rendered).not.toContain(" [38;2;0;0;0m");
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
		expect(rendered).toContain("1–40k of 42k chars");
		expect(rendered).toContain("more at 40k");
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
		expect(rendered).toContain("40k–42k of 42k chars");
		expect(rendered).toContain("complete");
	});

	test("expands to a sanitized, line-capped preview with an overflow note", () => {
		const text = Array.from({ length: 25 }, (_, i) => `line ${i}\u0001`).join("\n");
		const lines = installTool()
			.renderResult(docResult({ text }), { isPartial: false, expanded: true }, fakeTheme, renderContext())
			.render(200)
			.map((line: string) => line.trimEnd());
		const rendered = lines.join("\n");
		expect(lines[0]).toBe("PDF · 42k chars");
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

	test("sanitizes an error message", () => {
		const result = { isError: true, content: [{ type: "text", text: "Error: bad\u0001path" }] };
		const rendered = installTool()
			.renderResult(result, { isPartial: false, expanded: false }, fakeTheme, renderContext({ isError: true }))
			.render(80)
			.join("\n");
		expect(rendered).toContain("bad path");
		expect(rendered).not.toContain("\u0001");
	});

	test("reuses the previous Text component for call and result", () => {
		const tool = installTool();
		const call = tool.renderCall({ path: "a.pdf" }, fakeTheme, renderContext());
		const callAgain = tool.renderCall({ path: "b.pdf" }, fakeTheme, renderContext({ lastComponent: call }));
		expect(callAgain).toBe(call);
		expect(call.render(80).join("\n")).toContain("b.pdf");

		const result = tool.renderResult(docResult({}), { isPartial: false, expanded: false }, fakeTheme, renderContext());
		const resultAgain = tool.renderResult(
			docResult({}),
			{ isPartial: false, expanded: false },
			fakeTheme,
			renderContext({ lastComponent: result }),
		);
		expect(resultAgain).toBe(result);
	});

	test("renders a path with a newline on one line", () => {
		const lines = installTool().renderCall({ path: "a\nb.pdf" }, fakeTheme, renderContext()).render(80);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain("a b.pdf");
	});
});
