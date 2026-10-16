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

/** The two-row nameplate Markdown: `You` padded to the width, then the rule. */
const plate = (width: number): string => `## You${" ".repeat(width - 3)}${"─".repeat(width)}`;

describe("nameplate", () => {
	test("draws the label over a full-width rule", () => {
		expect(nameplate(20)).toBe(plate(20));
	});

	test("still draws the full-width rule when the label just fits", () => {
		expect(nameplate(3)).toBe(plate(3));
	});

	test("drops the nameplate when the label does not fit", () => {
		expect(nameplate(2)).toBeUndefined();
	});
});

describe("styleUserMessage", () => {
	test("puts the nameplate above the message", () => {
		expect(styleUserMessage("hello", user(20))).toBe(`${plate(20)}\n\nhello`);
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

	test("draws the label over the rule above the body without a hash prefix", () => {
		const lines = render("hello").map((line) => line.replace(/\s+$/, ""));
		expect(lines[0]).toBe("You");
		expect(lines[1]).toBe("─".repeat(40));
		const joined = lines.join("\n");
		expect(joined).not.toContain("#");
		expect(joined).not.toContain("❯");
		expect(joined).toContain("hello");
	});

	test("keeps a code-first message as code", () => {
		expect(render("```js\nconst x = 1;\n```").join("\n")).toContain("const x = 1;");
	});
});
