import { describe, expect, test } from "bun:test";
import type { MarkdownTransformContext } from "@earendil-works/pi-coding-agent";
import { Markdown } from "@earendil-works/pi-tui";
import { fakeMarkdownTheme } from "../../../test/helpers/fakes.ts";
import { opensBlock, styleUserMessage } from "./format.ts";

const at = (messageType: MarkdownTransformContext["messageType"], availableWidth = 80): MarkdownTransformContext => ({
	messageType,
	isStreaming: false,
	availableWidth,
});

const user = (availableWidth = 80) => at("user", availableWidth);

describe("styleUserMessage", () => {
	test("marks a single-line message with the prompt glyph", () => {
		expect(styleUserMessage("hello", user())).toBe("❯ hello");
	});

	test("hangs every continuation line of the first paragraph two columns in", () => {
		expect(styleUserMessage("one\ntwo\nthree", user())).toBe("❯ one\n  two\n  three");
	});

	test("stops the hang at a blank line and leaves the rest verbatim", () => {
		expect(styleUserMessage("one\ntwo\n\nthree", user())).toBe("❯ one\n  two\n\nthree");
	});

	test("stops the hang at a list, heading, fence, or table", () => {
		expect(styleUserMessage("one\n- a", user())).toBe("❯ one\n- a");
		expect(styleUserMessage("one\n## head", user())).toBe("❯ one\n## head");
		expect(styleUserMessage("one\n```js\nx\n```", user())).toBe("❯ one\n```js\nx\n```");
		expect(styleUserMessage("one\n| a | b |", user())).toBe("❯ one\n| a | b |");
	});

	test("puts the marker on its own line when the message opens a block", () => {
		expect(styleUserMessage("# head\nbody", user())).toBe("❯\n\n# head\nbody");
		expect(styleUserMessage("```js\nx\n```", user())).toBe("❯\n\n```js\nx\n```");
	});

	test("leaves non-user messages and empty text unchanged", () => {
		const blank = "   \n  ";
		expect(styleUserMessage("hello", at("assistant"))).toBe("hello");
		expect(styleUserMessage("hello", at("assistant-thinking"))).toBe("hello");
		expect(styleUserMessage(blank, user())).toBe(blank);
		expect(styleUserMessage("", user())).toBe("");
	});
});

describe("opensBlock", () => {
	test("recognizes block openers and not prose", () => {
		for (const line of ["```js", "~~~", "# h", "## h", "> q", "- a", "* a", "+ a", "1. a", "---", "***", "| a |"]) {
			expect(opensBlock(line), line).toBe(true);
		}
		for (const line of ["hello", "a - b", "1.a", "-", "|", "    ```"]) {
			expect(opensBlock(line), line).toBe(false);
		}
	});
});

describe("rendered through the real Markdown component", () => {
	const render = (markdown: string, width = 40): string[] => {
		const component = new Markdown(markdown, 0, 0, fakeMarkdownTheme(), undefined, {
			transform: (text, availableWidth) => styleUserMessage(text, user(availableWidth)),
		});
		return component.render(width);
	};

	test("draws the marker and the hang", () => {
		const lines = render("one\ntwo");
		expect(lines[0]).toContain("❯ one");
		expect(lines[1]?.startsWith("  two")).toBe(true);
	});

	test("keeps a code-first message as code", () => {
		const text = render("```js\nconst x = 1;\n```").join("\n");
		expect(text).toContain("❯");
		expect(text).toContain("const x = 1;");
	});
});
