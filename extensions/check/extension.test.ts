import { describe, expect, test } from "bun:test";
import { withEnv } from "../../test/helpers/env.ts";
import { createFakePi } from "../../test/helpers/fakes.ts";
import checkExtension, { registerCheck } from "./index.ts";
import { TOOL_NAME } from "./tools.ts";

describe("check extension registration", () => {
	test("registers the tool, command, and shutdown hook", () => {
		const fake = createFakePi();
		registerCheck(fake.pi);

		expect(fake.tools.has(TOOL_NAME)).toBe(true);
		expect(fake.commands.has("check")).toBe(true);
		expect(fake.handlers.get("session_shutdown")).toHaveLength(1);
	});

	test("loads by default and obeys PI_DISABLED_EXTENSIONS", async () => {
		await withEnv({ PI_DISABLED_EXTENSIONS: undefined }, () => {
			const enabled = createFakePi();
			checkExtension(enabled.pi);
			expect(enabled.commands.has("check")).toBe(true);
		});

		await withEnv({ PI_DISABLED_EXTENSIONS: "check" }, () => {
			const disabled = createFakePi();
			checkExtension(disabled.pi);
			expect(disabled.commands.has("check")).toBe(false);
			expect(disabled.tools.has(TOOL_NAME)).toBe(false);
		});
	});
});
