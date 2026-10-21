import { describe, expect, test } from "bun:test";
import { Text } from "@earendil-works/pi-tui";
import {
	coloringTheme,
	createFakePi,
	fakeTheme,
	innerOf,
	ROLE_SGR,
	roleSgrTheme,
} from "../../../test/helpers/fakes.ts";
import type { PadSource } from "../pad.ts";
import { headlineWithToolName, recolorCallHeadline, recolorShellCall, ToolBlock, toolBlockLines } from "./component.ts";
import { callFallback, resultFallback } from "./fallback.ts";
import { registerToolBlocks } from "./register.ts";

const call = (name: string, subject: string) =>
	roleSgrTheme.fg("toolTitle", name) + " " + roleSgrTheme.fg("accent", subject);

/** A render context with only the fields the resolver reads. */
function renderContext(overrides: Record<string, unknown> = {}) {
	return {
		isPartial: false,
		isError: false,
		expanded: false,
		outputPad: 0,
		lastComponent: undefined,
		state: {},
		...overrides,
	} as any;
}

/** Register the frame and hand back the single resolver. */
function resolver(pad?: PadSource) {
	const { pi, toolRenderers } = createFakePi();
	registerToolBlocks(pi, pad);
	return toolRenderers[0];
}

describe("toolBlockLines", () => {
	test("adds the host's output pad to the body indent", () => {
		const line = toolBlockLines(innerOf(["x"]), 40, 2)[0] ?? "";
		expect(line.indexOf("x")).toBe(4);
	});

	test("keeps the rail at the base indent when outputPad is set", () => {
		const line = toolBlockLines(innerOf(["a"]), 40, 2, { rail: "╎" })[0] ?? "";
		expect(line.indexOf("╎")).toBe(2);
		expect(line.indexOf("a")).toBe(4);
	});

	test("renders the inner at the reduced width", () => {
		let seen = 0;
		toolBlockLines(
			innerOf(["x"], (width) => {
				seen = width;
			}),
			20,
			1,
		);
		expect(seen).toBe(17);
	});

	test("rewrites a shell prompt in the headline", () => {
		const lines = toolBlockLines(innerOf(["$ bun run check", "out"]), 40, 0, {
			headline: true,
			toolName: "bash",
		});
		expect(lines[0]).toBe("bash bun run check");
	});

	test("recolours a shell call's command through the frame", () => {
		const lines = toolBlockLines(innerOf(["\u001b[1m$ ls\u001b[0m"]), 40, 0, {
			headline: true,
			toolName: "bash",
			theme: coloringTheme,
		});
		expect(lines).toEqual(["\u001b[1mbash \u001b[22m[text]ls\u001b[0m"]);
	});

	test("renders nothing for an absent inner", () => {
		expect(toolBlockLines(undefined, 40, 0)).toEqual([]);
	});

	test("demotes a call subject to the body colour through the frame", () => {
		const line = call("read", "src/a.ts");
		const lines = toolBlockLines(innerOf([line]), 40, 0, {
			headline: true,
			toolName: "read",
			theme: roleSgrTheme,
		});
		expect(lines[0]).toContain(`${ROLE_SGR.accent}read`);
		expect(lines[0]).toContain(`${ROLE_SGR.text}src/a.ts`);
		expect(lines[0]).not.toContain(`${ROLE_SGR.accent}src/a.ts`);
	});

	test("keeps a wrapped call line and its continuation out of the rail", () => {
		// Pi wraps `edit <path>` by dropping the name onto its own line once the
		// path no longer fits, so the path is the call, not diff content.
		const lines = toolBlockLines(innerOf(["edit", "src/a/long/path.ts", "", "-1 a", "+1 b"]), 40, 0, {
			headline: true,
			rail: "╎",
			toolName: "edit",
		});
		expect(lines[0]).toBe("edit");
		expect(lines[1]?.trim()).toBe("src/a/long/path.ts");
		expect(lines.slice(0, 2).join("\n")).not.toContain("╎");
		expect(lines[2]?.trim()).toBe("╎");
		expect(lines[3]?.trim()).toBe("╎ -1 a");
		expect(lines[4]?.trim()).toBe("╎ +1 b");
	});

	test("demotes the wrapped call's continuation lines with its headline", () => {
		// The wrapped path is still the call, so it cannot keep the accent the
		// headline demotion takes off the first line. The result under the blank
		// line keeps whatever role its own renderer gave it.
		const body = [
			roleSgrTheme.fg("toolTitle", "edit"),
			roleSgrTheme.fg("accent", "src/a/long/path.ts"),
			"",
			roleSgrTheme.fg("accent", "+1 b"),
		];
		const lines = toolBlockLines(innerOf(body), 40, 0, {
			headline: true,
			rail: "╎",
			toolName: "edit",
			theme: roleSgrTheme,
		});
		expect(lines[0]).toContain(`${ROLE_SGR.accent}edit`);
		expect(lines[1]).toContain(`${ROLE_SGR.text}src/a/long/path.ts`);
		expect(lines[1]).not.toContain(ROLE_SGR.accent);
		expect(lines[3]).toContain(`${ROLE_SGR.accent}+1 b`);
	});

	test("leaves a named headline's body roles alone", () => {
		const body = ["edit src/a.ts", "", roleSgrTheme.fg("accent", "+1 b")];
		const lines = toolBlockLines(innerOf(body), 40, 0, {
			headline: true,
			rail: "╎",
			toolName: "edit",
			theme: roleSgrTheme,
		});
		expect(lines[2]).toContain(`${ROLE_SGR.accent}+1 b`);
	});

	test("rails from the first body line when the headline names its subject", () => {
		const lines = toolBlockLines(innerOf(["edit src/a.ts", "", "-1 a"]), 40, 0, {
			headline: true,
			rail: "╎",
			toolName: "edit",
			trimLeading: true,
		});
		expect(lines[0]).toBe("edit src/a.ts");
		expect(lines[0]).not.toContain("╎");
		expect(lines[1]?.trim()).toBe("╎ -1 a");
	});

	test("rails from the first body line without a tool name to match", () => {
		const lines = toolBlockLines(innerOf(["edit", "a", "", "b"]), 40, 0, { headline: true, rail: "╎" });
		expect(lines[0]).toBe("edit");
		expect(lines.slice(0, 1).join("\n")).not.toContain("╎");
		expect(lines[1]?.trim()).toBe("╎ a");
		expect(lines[2]?.trim()).toBe("╎");
		expect(lines[3]?.trim()).toBe("╎ b");
	});

	test("ignores a painted tool name when matching the headline", () => {
		const lines = toolBlockLines(innerOf([roleSgrTheme.bold("edit"), "src/a/long/path.ts", "", "+1 b"]), 40, 0, {
			headline: true,
			rail: "╎",
			toolName: "edit",
			theme: roleSgrTheme,
		});
		expect(lines[2]?.trim()).toBe("╎");
	});
});

describe("recolorCallHeadline", () => {
	test("keeps the tool name's accent and demotes the subject", () => {
		const line = recolorCallHeadline(call("read", "src/a.ts"), "read", roleSgrTheme);
		expect(line).toContain(`${ROLE_SGR.accent}read`);
		expect(line).toContain(`${ROLE_SGR.text}src/a.ts`);
		expect(line).not.toContain(`${ROLE_SGR.accent}src/a.ts`);
	});

	test("leaves a continuation line's accent alone", () => {
		const text = `${call("subagent", "parallel · 2 tasks")}\n${ROLE_SGR.accent}explorer`;
		const line = recolorCallHeadline(text, "subagent", roleSgrTheme);
		expect(line).toContain(`${ROLE_SGR.text}parallel · 2 tasks`);
		expect(line.split("\n")[1]).toContain(`${ROLE_SGR.accent}explorer`);
	});

	test("demotes every accent when the name is not in the headline", () => {
		const line = recolorCallHeadline(roleSgrTheme.fg("accent", "src/a.ts"), "read", roleSgrTheme);
		expect(line).toContain(`${ROLE_SGR.text}src/a.ts`);
	});

	test("is a no-op when the theme paints no colour", () => {
		expect(recolorCallHeadline("read src/a.ts", "read", fakeTheme)).toBe("read src/a.ts");
	});
});

describe("headlineWithToolName", () => {
	test("replaces a shell prompt with the tool name", () => {
		expect(headlineWithToolName("$ bun run check", "bash")).toBe("bash bun run check");
		expect(headlineWithToolName("> Get-ChildItem", "powershell")).toBe("powershell Get-ChildItem");
	});

	test("leaves a headline that already names the tool alone", () => {
		expect(headlineWithToolName("read src/cli.ts:1-8", "read")).toBe("read src/cli.ts:1-8");
	});

	test("rewrites the prompt in place, keeping its styling, when given no theme", () => {
		expect(headlineWithToolName("\u001b[1m$ ls\u001b[0m", "bash")).toBe("\u001b[1mbash ls\u001b[0m");
	});

	test("repaints the command in the body role so only the tool name spends the accent", () => {
		expect(headlineWithToolName("\u001b[1m$ bun run check\u001b[0m", "bash", coloringTheme)).toBe(
			"\u001b[1mbash \u001b[22m[text]bun run check\u001b[0m",
		);
	});

	test("leaves a headline that is not a shell prompt untouched even with a theme", () => {
		expect(headlineWithToolName("read src/cli.ts:1-8", "read", coloringTheme)).toBe("read src/cli.ts:1-8");
	});

	test("sanitizes the tool name", () => {
		expect(headlineWithToolName("$ ls", "ba\u0007sh")).toBe("ba sh ls");
	});
});

describe("ToolBlock", () => {
	test("serves a repeat frame from its memo and rebuilds on a width change", () => {
		const block = new ToolBlock(innerOf(["a"]), 0, { trimLeading: true, rail: "╎" });

		expect(block.render(40)).toBe(block.render(40));
		const wider = block.render(41);
		expect(wider).not.toBe(block.render(40));
		expect(wider[0]?.trim()).toBe("╎ a");
	});

	test("rebuilds after invalidate even when nothing else changed", () => {
		const block = new ToolBlock(innerOf(["a"]), 0);
		const first = block.render(40);

		block.invalidate();

		expect(block.render(40)).not.toBe(first);
	});

	test("rebuilds when the inner returns new lines", () => {
		let lines = ["a"];
		const block = new ToolBlock({ render: () => lines, invalidate: () => {} }, 0);

		block.render(40);
		lines = ["b"];

		expect(block.render(40)[0]?.trim()).toBe("b");
	});

	test("invalidates the inner it wraps", () => {
		let invalidations = 0;
		const block = new ToolBlock(
			{
				render: () => ["a"],
				invalidate: () => {
					invalidations++;
				},
			},
			0,
		);

		block.invalidate();

		expect(invalidations).toBe(1);
	});
});

describe("recolorShellCall", () => {
	test("rewrites the first line and leaves later lines alone", () => {
		expect(recolorShellCall("\u001b[1m$ ls\u001b[0m\nnext", "bash", coloringTheme)).toBe(
			"\u001b[1mbash \u001b[22m[text]ls\u001b[0m\nnext",
		);
	});

	test("leaves a call that is not a shell prompt alone", () => {
		expect(recolorShellCall("read src/a.ts", "read", coloringTheme)).toBe("read src/a.ts");
	});

	test("keeps every wrapped fragment of the command in the body role", () => {
		const raw = roleSgrTheme.fg("toolTitle", `$ ${Array.from({ length: 12 }, (_, i) => `arg${i}`).join(" ")}`);
		const lines = new Text(recolorShellCall(raw, "bash", roleSgrTheme), 0, 0).render(24);
		expect(lines.length).toBeGreaterThan(1);
		expect(lines[0]).toContain(ROLE_SGR.accent);
		expect(lines[0]).toContain(ROLE_SGR.text);
		for (const line of lines.slice(1)) {
			expect(line).toContain(ROLE_SGR.text);
			expect(line).not.toContain(ROLE_SGR.accent);
		}
	});
});

describe("callFallback", () => {
	test("shows a lone subject argument bare, like a built-in", () => {
		const line = callFallback("read", { path: "a.ts" }, fakeTheme, false);
		expect(line).toContain("read");
		expect(line).toContain("a.ts");
		expect(line).not.toContain("path=");
	});

	test("quotes a subject containing spaces and appends options", () => {
		const line = callFallback("enter_worktree", { name: "my branch", keep: true }, fakeTheme, false);
		expect(line).toContain('"my branch"');
		expect(line).toContain("(keep)");
	});

	test("renders a bare flag when there is no subject", () => {
		expect(callFallback("exit_worktree", { remove: true }, fakeTheme, false)).toEndWith("exit_worktree remove");
	});

	test("drops empty values and keeps a no-arg call to just the title", () => {
		expect(callFallback("prune_worktrees", {}, fakeTheme, false)).toBe("prune_worktrees");
		expect(callFallback("list_worktrees", undefined, fakeTheme, false)).toBe("list_worktrees");
	});

	test("splits a subject from its remaining options", () => {
		const line = callFallback("foo", { query: "retry", limit: 10, verbose: true }, fakeTheme, false);
		expect(line).toContain("retry (limit 10, verbose)");
	});

	test("colours the subject as the body and its options faint", () => {
		const line = callFallback("foo", { query: "retry", limit: 10 }, coloringTheme, false);
		expect(line).toContain("[text]retry[dim] (limit 10)");
	});

	test("colours a bare flag faint", () => {
		expect(callFallback("exit_worktree", { remove: true }, coloringTheme, false)).toContain("[dim]remove");
	});

	test("expands arguments onto indented lines and sanitizes them", () => {
		const text = callFallback("x", { a: "b\u0007c" }, fakeTheme, true);
		expect(text).toContain("a: b c");
		expect(text).not.toContain("\u0007");
	});

	test("caps the collapsed argument preview", () => {
		const line = callFallback("x", { a: "y".repeat(200) }, fakeTheme, false);
		expect(line).toEndWith("...");
	});
});

describe("resultFallback", () => {
	test("caps collapsed lines and notes the rest", () => {
		const content = [{ type: "text", text: Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join("\n") }];
		const output = resultFallback(content, fakeTheme, false);
		expect(output.split("\n")).toHaveLength(11);
		expect(output).toContain("10 more lines");
	});

	test("keeps every line when expanded", () => {
		expect(resultFallback([{ type: "text", text: "a\nb" }], fakeTheme, true)).toBe("a\nb");
	});

	test("is empty without text content", () => {
		expect(resultFallback([], fakeTheme, false)).toBe("");
	});
});

describe("registerToolBlocks", () => {
	test("switches the row to the self shell and leads with the call headline", () => {
		const renderers = resolver()("read", () => ({ renderCall: () => new Text("base call", 0, 0) }));
		expect(renderers?.renderShell).toBe("self");
		expect(renderers?.renderCall?.({}, fakeTheme, renderContext()).render(40)).toEqual(["base call"]);
	});

	test("hands the theme to the frame so a shell command is recoloured", () => {
		const renderers = resolver()("bash", () => ({ renderCall: () => new Text("\u001b[1m$ ls\u001b[0m", 0, 0) }));
		const lines = renderers?.renderCall?.({ command: "ls" }, coloringTheme, renderContext()).render(40) ?? [];
		expect(lines).toEqual(["\u001b[1mbash \u001b[22m[text]ls\u001b[0m"]);
	});

	test("trims a self-shell call's blank edges under its headline", () => {
		const base = {
			renderShell: "self" as const,
			renderCall: () => new Text(["", "own", ""].join("\n"), 0, 0),
		};
		const renderers = resolver()("edit", () => base);
		const lines = renderers?.renderCall?.({}, fakeTheme, renderContext()).render(40) ?? [];
		expect(lines.map((line: string) => line.trimEnd())).toEqual(["own"]);
	});

	test("rails the result body under the call's body column", () => {
		const renderers = resolver()("read", () => ({ renderResult: () => new Text("base result", 0, 0) }));
		const lines =
			renderers
				?.renderResult?.({ content: [] } as any, { expanded: false, isPartial: false }, fakeTheme, renderContext())
				.render(40) ?? [];
		expect(lines[0]?.trim()).toBe("╎ base result");
	});

	test("leaves a normal tool's call body plain-indented, with no rail", () => {
		const renderers = resolver()("read", () => ({ renderCall: () => new Text("call\nextra", 0, 0) }));
		const lines = renderers?.renderCall?.({}, fakeTheme, renderContext()).render(40) ?? [];
		expect(lines[0]?.trim()).toBe("call");
		expect(lines[1]?.trim()).toBe("extra");
		expect(lines[1]).not.toContain("╎");
	});

	test("demotes a built-in call's subject to the body colour", () => {
		const base = {
			renderCall: () =>
				new Text(`${roleSgrTheme.fg("toolTitle", "read")} ${roleSgrTheme.fg("accent", "src/a.ts")}`, 0, 0),
		};
		const renderers = resolver()("read", () => base);
		const lines = renderers?.renderCall?.({ path: "src/a.ts" }, roleSgrTheme, renderContext()).render(40) ?? [];
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
				const box = new Text("", 0, 0);
				box.setText(`${roleSgrTheme.fg("toolTitle", "edit")} ${roleSgrTheme.fg("accent", "src/a.ts")}`);
				return box;
			},
		};
		const renderers = resolver()("edit", () => base);
		const lines = renderers?.renderCall?.({}, roleSgrTheme, renderContext()).render(40) ?? [];
		expect(lines[0]).toContain(`${ROLE_SGR.accent}edit`);
		expect(lines[0]).toContain(`${ROLE_SGR.text}src/a.ts`);
		expect(lines[0]).not.toContain(`${ROLE_SGR.accent}src/a.ts`);
	});

	test("takes the output pad from the frame, never from the base renderer", () => {
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
		const lines = renderers?.renderCall?.({}, fakeTheme, renderContext({ outputPad: 1 })).render(40) ?? [];
		expect(seen).toEqual([0]);
		expect(lines[0]?.indexOf("edit x")).toBe(1);
		expect(lines[1]?.trim()).toBe("╎ body");
		renderers?.renderResult?.(
			{ content: [] } as any,
			{ expanded: false, isPartial: false },
			fakeTheme,
			renderContext({ outputPad: 1 }),
		);
		expect(seen).toEqual([0, 0]);
	});

	test("takes the frame margin from the injected pad source", () => {
		// A fixed source overrides the host pad the context carries.
		const pad: PadSource = { resolve: () => 2 };
		const renderers = resolver(pad)("read", () => ({ renderCall: () => new Text("read x\nbody", 0, 0) }));
		const lines = renderers?.renderCall?.({}, fakeTheme, renderContext({ outputPad: 1 })).render(40) ?? [];
		expect(lines[0]?.indexOf("read x")).toBe(2);
		expect(lines[1]?.indexOf("body")).toBe(4);
	});

	test("rails the edit call body by status", () => {
		const renderers = resolver()("edit", () => ({ renderCall: () => new Text("edit x\nbody", 0, 0) }));
		const body = (overrides: Record<string, unknown>) =>
			renderers?.renderCall?.({}, coloringTheme, renderContext(overrides)).render(20)?.[1] ?? "";
		expect(body({ isPartial: true })).toContain("[accent]╎");
		expect(body({ isPartial: false, isError: false })).toContain("[dim]╎");
		expect(body({ isPartial: false, isError: true })).toContain("[error]╎");
	});

	test("rails every result by status", () => {
		const renderers = resolver()("write", () => ({ renderResult: () => new Text("done", 0, 0) }));
		const lines =
			renderers
				?.renderResult?.({ content: [] } as any, { expanded: false, isPartial: false }, coloringTheme, renderContext())
				.render(20) ?? [];
		expect(lines[0]).toContain("[dim]╎");
	});

	test("keeps the edit base renderer from painting its own background", () => {
		let painted = "";
		const renderers = resolver()("edit", () => ({
			renderCall: (_args: unknown, theme: any) => {
				painted = theme.bg("toolSuccessBg", "X");
				return new Text("edit x", 0, 0);
			},
		}));
		renderers?.renderCall?.({}, coloringTheme, renderContext());
		// The facade makes the base's bg inert, so the transcript stays band-free.
		expect(painted).toBe("X");
	});

	test("frames a generic fallback when the base has no renderer", () => {
		const renderers = resolver()("mystery", () => undefined);
		const lines = renderers?.renderCall?.({ q: "hi" }, fakeTheme, renderContext()).render(60) ?? [];
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
		const first = renderers?.renderCall?.({}, fakeTheme, renderContext({ state: shared }));
		renderers?.renderCall?.({}, fakeTheme, renderContext({ state: shared, lastComponent: first }));

		// The base sees no component, then its own previous one — never our frame.
		expect(seen[0]).toBeUndefined();
		expect(seen[1]).toBeInstanceOf(Text);
		expect(seen[1]).not.toBe(first);
	});

	test("frames its own call fallback when a base renderer throws", () => {
		// A base can throw on a partial (still-streaming) argument. The frame must
		// still own the pad, so the row never jumps to Pi's column-0 call line.
		const renderers = resolver()("read", () => ({
			renderCall: () => {
				throw new Error("partial args");
			},
		}));
		const lines =
			renderers?.renderCall?.({ path: "src/a.ts" }, fakeTheme, renderContext({ outputPad: 1 })).render(60) ?? [];
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
					renderContext({ outputPad: 1 }),
				)
				.render(60) ?? [];
		expect(lines[0]?.startsWith(" ")).toBe(true);
		expect(lines.join("\n")).toContain("out");
	});
});
