import { describe, expect, test } from "bun:test";
import type { MarkdownTransformContext } from "@earendil-works/pi-coding-agent";
import { Markdown } from "@earendil-works/pi-tui";
import { fakeMarkdownTheme } from "../../../test/helpers/fakes.ts";
import { nameplate, styleUserMessage } from "./format.ts";

const at = (messageType: MarkdownTransformContext["messageType"], availableWidth = 80): MarkdownTransformContext => ({
	messageType,
	isStreaming: false,
	availableWidth,
});

const user = (availableWidth = 80) => at("user", availableWidth);

describe("nameplate", () => {
	test("draws the label as a heading with a rule to the width", () => {
		expect(nameplate(20)).toBe(`## ❯ You ${"─".repeat(14)}`);
	});

	test("drops the rule when too little width remains", () => {
		expect(nameplate(7)).toBe("## ❯ You");
	});

	test("drops the nameplate when the label does not fit", () => {
		expect(nameplate(4)).toBeUndefined();
	});
});

describe("styleUserMessage", () => {
	test("puts the nameplate above the message", () => {
		expect(styleUserMessage("hello", user(20))).toBe(`## ❯ You ${"─".repeat(14)}\n\nhello`);
	});

	test("leaves non-user messages and empty text unchanged", () => {
		const blank = "   \n  ";
		expect(styleUserMessage("hello", at("assistant"))).toBe("hello");
		expect(styleUserMessage("hello", at("assistant-thinking"))).toBe("hello");
		expect(styleUserMessage(blank, user())).toBe(blank);
		expect(styleUserMessage("", user())).toBe("");
	});
});

describe("rendered through the real Markdown component", () => {
	const render = (markdown: string, width = 40): string[] => {
		const component = new Markdown(markdown, 0, 0, fakeMarkdownTheme(), undefined, {
			transform: (text, availableWidth) => styleUserMessage(text, user(availableWidth)),
		});
		return component.render(width);
	};

	test("draws the heading label above the body without a hash prefix", () => {
		const lines = render("hello");
		expect(lines[0]).toContain("❯ You");
		expect(lines[0]).not.toContain("#");
		expect(lines.join("\n")).toContain("hello");
	});

	test("keeps a code-first message as code", () => {
		expect(render("```js\nconst x = 1;\n```").join("\n")).toContain("const x = 1;");
	});
});
