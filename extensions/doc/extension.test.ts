import { describe, expect, test } from "bun:test";
import doc from "./index.ts";
import { TOOL_NAME } from "./tool.ts";
import { createFakePi } from "../../test/helpers/fakes.ts";
import { withEnv } from "../../test/helpers/env.ts";
import { ENV_DISABLED_EXTENSIONS } from "../../lib/env.ts";

describe("doc extension", () => {
	test("registers nothing when disabled through PI_DISABLED_EXTENSIONS", async () => {
		await withEnv({ [ENV_DISABLED_EXTENSIONS]: "doc" }, () => {
			const { pi, tools, handlers } = createFakePi();
			doc(pi);
			expect(tools.size).toBe(0);
			expect(handlers.size).toBe(0);
		});
	});

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
