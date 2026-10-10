import { describe, expect, test } from "bun:test";
import type { DocCli } from "./cli.ts";
import { extractPdfText, mergePdfPages } from "./pdf.ts";

/** A fake CLI that returns `result` or throws it, recording the calls. */
function fakeCli(result: string | Error, calls?: Array<{ cli: string; args: string[] }>): DocCli {
	return {
		run: async (cli, args) => {
			calls?.push({ cli, args: [...args] });
			if (result instanceof Error) throw result;
			return result;
		},
	};
}

describe("mergePdfPages", () => {
	test("joins form-feed-separated pages with a blank line", () => {
		expect(mergePdfPages("page one\n\f\npage two\n")).toBe("page one\n\npage two");
	});

	test("trims a blank document to nothing", () => {
		expect(mergePdfPages("\n")).toBe("");
	});

	test("keeps a single page without separators", () => {
		expect(mergePdfPages("only\n")).toBe("only");
	});
});

describe("extractPdfText", () => {
	test("runs pdfcraft-cli text and merges the pages", async () => {
		const calls: Array<{ cli: string; args: string[] }> = [];
		const text = await extractPdfText({ path: "/root/a.pdf" }, fakeCli("a\n\f\nb\n", calls));
		expect(text).toBe("a\n\nb");
		expect(calls).toEqual([{ cli: "pdfcraft-cli", args: ["text", "/root/a.pdf"] }]);
	});

	test("propagates a CLI failure", async () => {
		await expect(extractPdfText({ path: "/root/a.pdf" }, fakeCli(new Error("boom")))).rejects.toThrow("boom");
	});
});
