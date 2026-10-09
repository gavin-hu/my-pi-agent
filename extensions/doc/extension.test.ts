import { describe, expect, test } from "bun:test";
import doc from "./index.ts";
import { TOOL_NAME } from "./tool.ts";
import { createFakePi } from "../../test/helpers/fakes.ts";

describe("doc extension", () => {
	test("registers read_doc as a direct, active, read-only tool", () => {
		const { pi, tools } = createFakePi();
		doc(pi);

		const tool = tools.get(TOOL_NAME);
		expect(tool).toBeDefined();
		expect(tool.exposure).toBe("direct");
		expect(tool.defaultActive).toBe(true);
		expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: false, destructiveHint: false });
		expect(tool.outputSchema).toBeDefined();
		expect(typeof tool.execute).toBe("function");
		expect(typeof tool.renderCall).toBe("function");
		expect(typeof tool.renderResult).toBe("function");
	});
});
