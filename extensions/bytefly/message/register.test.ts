import { describe, expect, test } from "bun:test";
import { createFakePi } from "../../../test/helpers/fakes.ts";
import { registerUserMessage } from "./register.ts";

describe("registerUserMessage", () => {
	test("registers exactly one transformer", () => {
		const { pi, markdownTransformers } = createFakePi();
		registerUserMessage(pi);
		expect(markdownTransformers).toHaveLength(1);
	});

	test("marks a user message and leaves an assistant one alone", () => {
		const { pi, markdownTransformers } = createFakePi();
		registerUserMessage(pi);
		const transform = markdownTransformers[0];

		expect(transform("hello", { messageType: "user", isStreaming: false, availableWidth: 40 })).toContain("❯ You");
		expect(transform("hello", { messageType: "assistant", isStreaming: false, availableWidth: 40 })).toBe("hello");
	});
});
