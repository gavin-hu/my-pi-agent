import { describe, expect, test } from "bun:test";
import { Box, Text } from "@earendil-works/pi-tui";
import { createFakePi, coloringTheme, fakeTheme, ROLE_SGR, roleSgrTheme } from "../../../test/helpers/fakes.ts";
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
		expect(lines.map((line: string) => line.trimEnd())).toEqual(["own"]);
	});

	test("rails the result body under the call's body column", () => {
		const renderers = resolver()("read", () => ({ renderResult: () => new Text("base result", 0, 0) }));
		const lines =
			renderers
				?.renderResult?.({ content: [] } as any, { expanded: false, isPartial: false }, fakeTheme, ctx())
				.render(40) ?? [];
		expect(lines[0]?.trimEnd()).toBe("╎ base result");
	});

	test("leaves the call plain-indented, with no rail", () => {
		const renderers = resolver()("read", () => ({ renderCall: () => new Text("call\nextra", 0, 0) }));
		const lines = renderers?.renderCall?.({}, fakeTheme, ctx()).render(40) ?? [];
		expect(lines.map((line: string) => line.trimEnd())).toEqual(["call", "  extra"]);
	});

	test("demotes a built-in call's subject to the body colour", () => {
		const base = {
			renderCall: () =>
				new Text(`${roleSgrTheme.fg("toolTitle", "read")} ${roleSgrTheme.fg("accent", "src/a.ts")}`, 0, 0),
		};
		const renderers = resolver()("read", () => base);
		const lines = renderers?.renderCall?.({ path: "src/a.ts" }, roleSgrTheme, ctx()).render(40) ?? [];
		expect(lines[0]).toContain(`${ROLE_SGR.accent}read`);
		expect(lines[0]).toContain(`${ROLE_SGR.text}src/a.ts`);
		expect(lines[0]).not.toContain(`${ROLE_SGR.accent}src/a.ts`);
	});

	test("demotes a self-shell box header that is rebuilt after renderCall", () => {
		// `edit` clears and re-adds its header when its result arrives, discarding the
		// resolver's rewrite, so the frame is what recolours the headline.
		const base = {
			renderShell: "self" as const,
			renderCall: () => {
				const box = new Box(0, 0, (text: string) => text);
				box.addChild(
					new Text(`${roleSgrTheme.fg("toolTitle", "edit")} ${roleSgrTheme.fg("accent", "src/a.ts")}`, 0, 0),
				);
				return box;
			},
		};
		const renderers = resolver()("edit", () => base);
		const lines = renderers?.renderCall?.({}, roleSgrTheme, ctx()).render(40) ?? [];
		expect(lines[0]).toContain(`${ROLE_SGR.accent}edit`);
		expect(lines[0]).toContain(`${ROLE_SGR.text}src/a.ts`);
		expect(lines[0]).not.toContain(`${ROLE_SGR.accent}src/a.ts`);
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
		expect(lines.map((line: string) => line.trimEnd())).toEqual([" edit x", " ╎ body"]);
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

	test("rails the edit call body by status", () => {
		const renderers = resolver()("edit", () => ({ renderCall: () => new Text("edit x\nbody", 0, 0) }));
		const body = (overrides: Record<string, unknown>) =>
			renderers?.renderCall?.({}, coloringTheme, ctx(overrides)).render(20)?.[1] ?? "";
		expect(body({ isPartial: true })).toContain("[accent]╎");
		expect(body({ isPartial: false, isError: false })).toContain("[dim]╎");
		expect(body({ isPartial: false, isError: true })).toContain("[error]╎");
	});

	test("rails a result by status", () => {
		const renderers = resolver()("write", () => ({ renderResult: () => new Text("done", 0, 0) }));
		const lines =
			renderers
				?.renderResult?.({ content: [] } as any, { expanded: false, isPartial: false }, coloringTheme, ctx())
				.render(20) ?? [];
		expect(lines[0]).toContain("[dim]╎");
	});

	test("leaves a normal tool's call body plain-indented", () => {
		const renderers = resolver()("read", () => ({ renderCall: () => new Text("read x\nbody", 0, 0) }));
		const lines = renderers?.renderCall?.({}, coloringTheme, ctx()).render(20) ?? [];
		expect(lines[1]).not.toContain("╎");
	});

	test("keeps the edit base renderer from painting its own background", () => {
		let painted = "";
		const renderers = resolver()("edit", () => ({
			renderCall: (_args: unknown, theme: any) => {
				painted = theme.bg("toolSuccessBg", "X");
				return new Text("edit x", 0, 0);
			},
		}));
		renderers?.renderCall?.({}, coloringTheme, ctx());
		// The facade makes the base's bg inert, so the transcript stays band-free.
		expect(painted).toBe("X");
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

	test("frames its own fallback when a base renderer throws", () => {
		// A base can throw on a partial (still-streaming) argument. The frame must
		// still own the pad, so the row never jumps to Pi's column-0 call line.
		const renderers = resolver()("read", () => ({
			renderCall: () => {
				throw new Error("partial args");
			},
		}));
		const lines = renderers?.renderCall?.({ path: "src/a.ts" }, fakeTheme, ctx({ outputPad: 1 })).render(60) ?? [];
		expect(lines[0]?.startsWith(" ")).toBe(true);
		expect(lines[0]).toContain("read");
	});

	test("frames its own result fallback when a base result renderer throws", () => {
		const renderers = resolver()("read", () => ({
			renderResult: () => {
				throw new Error("boom");
			},
		}));
		const lines =
			renderers
				?.renderResult?.(
					{ content: [{ type: "text", text: "out" }] } as any,
					{ expanded: false, isPartial: false },
					fakeTheme,
					ctx({ outputPad: 1 }),
				)
				.render(60) ?? [];
		expect(lines[0]?.startsWith(" ")).toBe(true);
		expect(lines.join("\n")).toContain("out");
	});
});
