import { describe, expect, test } from "bun:test";
import type { DocCli } from "./cli.ts";
import { extractDocxText, stripTrailingNewline } from "./docx.ts";

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

describe("stripTrailingNewline", () => {
	test("drops exactly one trailing newline", () => {
		expect(stripTrailingNewline("a\n")).toBe("a");
		expect(stripTrailingNewline("a\n\n")).toBe("a\n");
		expect(stripTrailingNewline("a\r\n")).toBe("a");
		expect(stripTrailingNewline("a")).toBe("a");
	});
});

describe("extractDocxText", () => {
	test("runs wordcraft-cli text and strips the trailing newline", async () => {
		const calls: Array<{ cli: string; args: string[] }> = [];
		const text = await extractDocxText({ path: "/root/a.docx" }, fakeCli("para\tcell\n", calls));
		expect(text).toBe("para\tcell");
		expect(calls).toEqual([{ cli: "wordcraft-cli", args: ["text", "/root/a.docx"] }]);
	});

	test("propagates a CLI failure", async () => {
		await expect(extractDocxText({ path: "/root/a.docx" }, fakeCli(new Error("boom")))).rejects.toThrow("boom");
	});
});
