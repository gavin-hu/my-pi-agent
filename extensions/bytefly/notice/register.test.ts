import { describe, expect, test } from "bun:test";
import { NOTICE_TYPE } from "../../../lib/notice.ts";
import { createFakePi, fakeTheme } from "../../../test/helpers/fakes.ts";
import { registerNotice } from "./register.ts";

const options = { expanded: false, outputPad: 0 };

describe("registerNotice", () => {
	test("registers one renderer under the shared type", () => {
		const { pi, messageRenderers } = createFakePi();
		registerNotice(pi);
		expect(messageRenderers.has(NOTICE_TYPE)).toBe(true);
	});

	test("renders a notice and skips a message without details", () => {
		const { pi, messageRenderers } = createFakePi();
		registerNotice(pi);
		const renderer = messageRenderers.get(NOTICE_TYPE);

		const message = { customType: NOTICE_TYPE, content: "x", display: true, details: { source: "job", title: "done" } };
		expect(renderer(message, options, fakeTheme).render(60).join("\n")).toContain("done");

		expect(renderer({ customType: NOTICE_TYPE, content: "x", display: true }, options, fakeTheme)).toBeUndefined();
	});
});
