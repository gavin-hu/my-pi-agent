import { afterAll, describe, expect, test } from "bun:test";
import { normalizeBodyText, readDocBytes } from "./file.ts";
import { makeDocumentFixture } from "../../../test/helpers/fixtures/document.ts";

const fixture = makeDocumentFixture();
afterAll(() => fixture.remove());

describe("normalizeBodyText", () => {
	test("converts CRLF and lone CR to LF", () => {
		expect(normalizeBodyText("a\r\nb\rc")).toBe("a\nb\nc");
	});

	test("collapses runs of blank lines to one", () => {
		expect(normalizeBodyText("a\n\n\n\nb")).toBe("a\n\nb");
	});

	test("strips trailing spaces and newlines", () => {
		expect(normalizeBodyText("a  \nb\n\n")).toBe("a\nb");
	});
});

describe("readDocBytes", () => {
	test("reads the file as bytes", async () => {
		const path = fixture.write("bytes.bin", "hello");
		expect(await readDocBytes({ path })).toEqual(new TextEncoder().encode("hello"));
	});

	test("refuses to start when the signal is already aborted", async () => {
		const path = fixture.write("aborted.bin", "hello");
		const controller = new AbortController();
		controller.abort();
		await expect(readDocBytes({ path, signal: controller.signal })).rejects.toThrow();
	});
});
