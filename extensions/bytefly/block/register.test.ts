import { describe, expect, test } from "bun:test";
import { Text } from "@earendil-works/pi-tui";
import { RAIL } from "../../../lib/tui/rail.ts";
import { createFakePi, fakeTheme } from "../../../test/helpers/fakes.ts";
import { registerToolBlocks } from "./register.ts";

/** A minimal render context: the fields the resolver reads, plus the shared state. */
const ctx = (overrides: Record<string, unknown> = {}) =>
	({
		isPartial: false,
		isError: false,
		expanded: false,
		outputPad: 0,
		lastComponent: undefined,
		state: {},
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
		expect(lines[0]?.startsWith(RAIL)).toBe(true);
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

	test("hands the base its own previous component, never the frame", () => {
		const seen: unknown[] = [];
		const renderers = resolver()("read", () => ({
			renderCall: (_args: unknown, _theme: unknown, context: any) => {
				seen.push(context.lastComponent);
				return new Text("base", 0, 0);
			},
		}));
		const shared = {};
		const first = renderers?.renderCall?.({}, fakeTheme, ctx({ state: shared }));
		renderers?.renderCall?.({}, fakeTheme, ctx({ state: shared, lastComponent: first }));

		// The base sees no component, then its own previous one — never our frame.
		expect(seen[0]).toBeUndefined();
		expect(seen[1]).toBeInstanceOf(Text);
		expect(seen[1]).not.toBe(first);
	});
});
