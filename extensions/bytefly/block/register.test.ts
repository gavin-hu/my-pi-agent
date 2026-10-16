import { describe, expect, test } from "bun:test";
import { Text } from "@earendil-works/pi-tui";
import { createFakePi, fakeTheme } from "../../../test/helpers/fakes.ts";
import { registerToolBlocks } from "./register.ts";

/** A minimal render context: only the fields the resolver reads matter. */
const ctx = (overrides: Record<string, unknown> = {}) =>
	({
		isPartial: false,
		isError: false,
		expanded: false,
		outputPad: 0,
		lastComponent: undefined,
		...overrides,
	}) as any;

/** Register on a fake pi and hand back the single resolver. */
const resolver = () => {
	const { pi, toolRenderers } = createFakePi();
	registerToolBlocks(pi);
	return toolRenderers[0];
};

describe("registerToolBlocks", () => {
	test("switches the row to the self shell and wraps the base call", () => {
		const renderers = resolver()("read", () => ({ renderCall: () => new Text("base call", 0, 0) }));
		expect(renderers?.renderShell).toBe("self");
		const lines = renderers?.renderCall?.({}, fakeTheme, ctx()).render(40) ?? [];
		expect(lines.join("\n")).toContain("base call");
		expect(lines[0]?.startsWith("│")).toBe(true);
	});

	test("leaves a tool that renders its own shell unchanged", () => {
		const base = { renderShell: "self" as const, renderCall: () => new Text("own", 0, 0) };
		expect(resolver()("edit", () => base)).toBe(base);
	});

	test("frames a generic fallback when the base has no renderer", () => {
		const renderers = resolver()("mystery", () => undefined);
		const text = (renderers?.renderCall?.({ q: "hi" }, fakeTheme, ctx()).render(60) ?? []).join("\n");
		expect(text).toContain("mystery");
		expect(text).toContain('q="hi"');
	});
});
