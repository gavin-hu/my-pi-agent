import { describe, expect, test } from "bun:test";
import { Text } from "@earendil-works/pi-tui";
import { createFakePi, coloringTheme, fakeTheme } from "../../../test/helpers/fakes.ts";
import type { PadSource } from "../pad.ts";
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
const resolver = (pad?: PadSource) => {
	const { pi, toolRenderers } = createFakePi();
	registerToolBlocks(pi, pad);
	return toolRenderers[0];
};

describe("registerToolBlocks", () => {
	test("switches the row to the self shell and leads with the call headline", () => {
		const renderers = resolver()("read", () => ({ renderCall: () => new Text("base call", 0, 0) }));
		expect(renderers?.renderShell).toBe("self");
		const lines = renderers?.renderCall?.({}, fakeTheme, ctx()).render(40) ?? [];
		expect(lines).toEqual(["base call"]);
	});

	test("hands the theme to the frame so a shell command is recoloured", () => {
		const renderers = resolver()("bash", () => ({ renderCall: () => new Text("\u001b[1m$ ls\u001b[0m", 0, 0) }));
		const lines = renderers?.renderCall?.({ command: "ls" }, coloringTheme, ctx()).render(40) ?? [];
		expect(lines).toEqual(["\u001b[1mbash \u001b[22m[text]ls\u001b[0m"]);
	});

	test("trims a self-shell call's blank edges under its headline", () => {
		const base = {
			renderShell: "self" as const,
			renderCall: () => new Text(["", "own", ""].join("\n"), 0, 0),
		};
		const renderers = resolver()("edit", () => base);
		expect(renderers?.renderShell).toBe("self");
		const lines = renderers?.renderCall?.({}, fakeTheme, ctx()).render(40) ?? [];
		expect(lines).toEqual(["own"]);
	});

	test("indents the result under the call's body column", () => {
		const renderers = resolver()("read", () => ({ renderResult: () => new Text("base result", 0, 0) }));
		const lines =
			renderers
				?.renderResult?.({ content: [] } as any, { expanded: false, isPartial: false }, fakeTheme, ctx())
				.render(40) ?? [];
		expect(lines[0]?.trimEnd()).toBe("  base result");
	});

	test("takes the output pad from the frame, never the base renderer", () => {
		const seen: number[] = [];
		const renderers = resolver()("edit", () => ({
			renderShell: "self" as const,
			renderCall: (_args: unknown, _theme: unknown, context: any) => {
				seen.push(context.outputPad);
				return new Text("edit x\nbody", 0, 0);
			},
			renderResult: (_r: unknown, _o: unknown, _t: unknown, context: any) => {
				seen.push(context.outputPad);
				return new Text("done", 0, 0);
			},
		}));
		// The base owns no pad; the frame applies the host's once (headline at 1, body at 3).
		const lines = renderers?.renderCall?.({}, fakeTheme, ctx({ outputPad: 1 })).render(40) ?? [];
		expect(seen).toEqual([0]);
		expect(lines.map((line: string) => line.trimEnd())).toEqual([" edit x", "   body"]);
		renderers?.renderResult?.(
			{ content: [] } as any,
			{ expanded: false, isPartial: false },
			fakeTheme,
			ctx({ outputPad: 1 }),
		);
		expect(seen).toEqual([0, 0]);
	});

	test("takes the frame margin from the injected pad source", () => {
		// A fixed source overrides the host pad the context carries.
		const pad: PadSource = { resolve: () => 2, observe: () => {} };
		const renderers = resolver(pad)("read", () => ({ renderCall: () => new Text("read x\nbody", 0, 0) }));
		const lines = renderers?.renderCall?.({}, fakeTheme, ctx({ outputPad: 1 })).render(40) ?? [];
		expect(lines.map((line: string) => line.trimEnd())).toEqual(["  read x", "    body"]);
	});

	test("frames a generic fallback when the base has no renderer", () => {
		const renderers = resolver()("mystery", () => undefined);
		const lines = renderers?.renderCall?.({ q: "hi" }, fakeTheme, ctx()).render(60) ?? [];
		expect(lines[0]).toContain("mystery");
		expect(lines.join("\n")).toContain("mystery hi");
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
