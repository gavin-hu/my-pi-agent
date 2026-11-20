/**
 * The frame a tool with no renderer of its own gets.
 *
 * `block.test.ts` holds the call side of the resolver's fallback; this is the result side,
 * and it is its own suite because that one is at its pinned height. The case is the one that
 * matters when a tool gains a renderer: the next tool must still draw, or the "no renderer"
 * path loses its only coverage in the act of drawing one of them (#742).
 */

import { describe, expect, test } from "bun:test";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import bytefly from "../index.ts";
import { createFakePi, fakeTheme, toolRenderContext } from "../../../test/helpers/fakes.ts";

/** The resolver bytefly registers, with no tool behind a name it does not know. */
function frame(): any {
	const fake = createFakePi();
	bytefly(fake.pi as any);
	const resolver: any = fake.toolRenderers[0];
	if (!resolver) throw new Error("bytefly registered no tool frame");
	return resolver;
}

/** What a block draws, without the SGR a real theme would carry. */
function plain(lines: string[]): string {
	return lines.map((line) => stripTerminalSequences(line)).join("\n");
}

describe("the generic fallback", () => {
	test("a tool with no renderer still draws its call and its result", () => {
		const wrapped = frame()("mystery", () => undefined);
		const context = { ...toolRenderContext(), args: { path: "src/http.ts" } };
		const call = plain(wrapped.renderCall({ path: "src/http.ts" }, fakeTheme, context).render(80));
		const result = plain(
			wrapped
				.renderResult(
					{ content: [{ type: "text", text: "bare output" }], details: {} },
					{ expanded: false, isPartial: false },
					fakeTheme,
					context,
				)
				.render(80),
		);
		// The subject rides the call line, the way a built-in names its subject.
		expect(call).toContain("mystery");
		expect(call).toContain("src/http.ts");
		expect(result).toContain("bare output");
	});
});
