import { describe, expect, test } from "bun:test";
import { toolError } from "./tool-result.ts";

describe("toolError", () => {
	test("builds the error content, the extension details, and the flag", () => {
		const result = toolError("no such job", { action: "status", error: "no such job" });
		expect(result).toEqual({
			content: [{ type: "text", text: "Error: no such job" }],
			details: { action: "status", error: "no such job" },
			isError: true,
		});
	});
});
