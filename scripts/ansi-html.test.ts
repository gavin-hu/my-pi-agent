import { describe, expect, test } from "bun:test";
import { ansiLinesToHtml, ansiToHtml, cssFor, parseAnsi } from "./ansi-html.ts";

describe("ansiToHtml", () => {
	test("escapes markup and leaves plain text alone", () => {
		expect(ansiToHtml("<b> & </b>")).toBe("&lt;b&gt; &amp; &lt;/b&gt;");
	});

	test("converts truecolor foreground", () => {
		expect(ansiToHtml("\u001b[38;2;88;166;255mhi\u001b[39m")).toBe('<span style="color:#58a6ff">hi</span>');
	});

	test("converts truecolor background", () => {
		expect(ansiToHtml("\u001b[48;2;1;2;3mx")).toBe('<span style="background-color:#010203">x</span>');
	});

	test("converts a 256-colour index through the palette", () => {
		expect(ansiToHtml("\u001b[38;5;196mx")).toBe('<span style="color:#ff0000">x</span>');
		expect(ansiToHtml("\u001b[38;5;232mx")).toBe('<span style="color:#080808">x</span>');
	});

	test("handles bold, dim, italic, underline, and strike", () => {
		expect(ansiToHtml("\u001b[1mB\u001b[22m")).toBe('<span style="font-weight:600">B</span>');
		expect(ansiToHtml("\u001b[2m\u001b[3mx")).toBe('<span style="opacity:.6;font-style:italic">x</span>');
		expect(ansiToHtml("\u001b[4m\u001b[9mx")).toBe('<span style="text-decoration:underline line-through">x</span>');
	});

	test("a reset clears everything after it", () => {
		expect(ansiToHtml("\u001b[1mA\u001b[0mB")).toBe('<span style="font-weight:600">A</span>B');
	});

	test("drops an OSC sequence and a non-SGR CSI", () => {
		expect(ansiToHtml("\u001b]0;a title\u0007hi")).toBe("hi");
		expect(ansiToHtml("a\u001b[2Kb")).toBe("ab");
	});

	test("draws reverse video as a swapped background", () => {
		expect(ansiToHtml("\u001b[38;2;63;185;80m+a \u001b[7mb\u001b[27m c")).toBe(
			'<span style="color:#3fb950">+a </span><span style="color:#0d1117;background-color:#3fb950">b</span><span style="color:#3fb950"> c</span>',
		);
	});
});

describe("parseAnsi", () => {
	test("splits runs and carries the style in effect", () => {
		expect(parseAnsi("a\u001b[31mb\u001b[39mc")).toEqual([
			{ text: "a", style: {} },
			{ text: "b", style: { fg: "#cd0000" } },
			{ text: "c", style: {} },
		]);
	});

	test("drops empty runs around adjacent sequences", () => {
		expect(parseAnsi("\u001b[1m\u001b[2mx")).toEqual([{ text: "x", style: { bold: true, dim: true } }]);
	});

	test("leaves plain text as one run", () => {
		expect(parseAnsi("plain")).toEqual([{ text: "plain", style: {} }]);
	});
});

describe("cssFor", () => {
	test("is empty for an unstyled run", () => {
		expect(cssFor({})).toBe("");
	});

	test("inverse swaps the cell's colours against the page", () => {
		expect(cssFor({ inverse: true })).toBe("color:#0d1117;background-color:#c9d1d9");
		expect(cssFor({ inverse: true, fg: "#f85149" })).toBe("color:#0d1117;background-color:#f85149");
		expect(cssFor({ inverse: true, bg: "#cd0000", fg: "#58a6ff" })).toBe("color:#cd0000;background-color:#58a6ff");
	});
});

describe("ansiLinesToHtml", () => {
	test("joins lines with a newline", () => {
		expect(ansiLinesToHtml(["a", "\u001b[31mb"])).toBe('a\n<span style="color:#cd0000">b</span>');
	});
});
