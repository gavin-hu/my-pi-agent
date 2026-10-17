import { describe, expect, test } from "bun:test";
import { Text } from "@earendil-works/pi-tui";
import { coloringTheme, fakeTheme, innerOf, ROLE_SGR, roleSgrTheme } from "../../../test/helpers/fakes.ts";
import { headlineWithToolName, recolorCallHeadline, recolorShellCall, toolBlockLines } from "./component.ts";

describe("toolBlockLines", () => {
	test("adds outputPad to the indent", () => {
		expect(toolBlockLines(innerOf(["x"]), 40, 2)[0]).toBe(`${" ".repeat(4)}x`);
	});

	test("keeps the rail at the base indent when outputPad is set", () => {
		expect(toolBlockLines(innerOf(["a"]), 40, 2, { rail: "╎" })).toEqual([`${" ".repeat(2)}╎ a`]);
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
		expect(toolBlockLines(innerOf(["$ bun run check", "out"]), 40, 0, { headline: true, toolName: "bash" })[0]).toBe(
			"bash bun run check",
		);
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
		const line = roleSgrTheme.fg("toolTitle", "read") + " " + roleSgrTheme.fg("accent", "src/a.ts");
		const lines = toolBlockLines(innerOf([line]), 40, 0, { headline: true, toolName: "read", theme: roleSgrTheme });
		expect(lines[0]).toContain(`${ROLE_SGR.accent}read`);
		expect(lines[0]).toContain(`${ROLE_SGR.text}src/a.ts`);
		expect(lines[0]).not.toContain(`${ROLE_SGR.accent}src/a.ts`);
	});

	test("keeps a wrapped call line out of the rail", () => {
		// Pi wraps `edit <path>` by dropping the name onto its own line once the
		// path no longer fits, so the path is the call, not diff content.
		expect(
			toolBlockLines(innerOf(["edit", "src/a/long/path.ts", "", "-1 a", "+1 b"]), 40, 0, {
				headline: true,
				rail: "╎",
				toolName: "edit",
			}),
		).toEqual(["edit", "  src/a/long/path.ts", "╎ ", "╎ -1 a", "╎ +1 b"]);
	});

	test("rails from the first body line when the headline names its subject", () => {
		expect(
			toolBlockLines(innerOf(["edit src/a.ts", "", "-1 a"]), 40, 0, {
				headline: true,
				rail: "╎",
				toolName: "edit",
				trimLeading: true,
			}),
		).toEqual(["edit src/a.ts", "╎ -1 a"]);
	});

	test("rails from the first body line without a tool name to match", () => {
		expect(toolBlockLines(innerOf(["edit", "a", "", "b"]), 40, 0, { headline: true, rail: "╎" })).toEqual([
			"edit",
			"╎ a",
			"╎ ",
			"╎ b",
		]);
	});

	test("ignores a painted tool name when matching the headline", () => {
		const headline = roleSgrTheme.bold("edit");
		expect(
			toolBlockLines(innerOf([headline, "src/a/long/path.ts", "", "+1 b"]), 40, 0, {
				headline: true,
				rail: "╎",
				toolName: "edit",
				theme: roleSgrTheme,
			})[2],
		).toBe("╎ ");
	});
});

describe("recolorCallHeadline", () => {
	const call = (name: string, subject: string) =>
		roleSgrTheme.fg("toolTitle", name) + " " + roleSgrTheme.fg("accent", subject);

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

	test("repaints the command in label so only the tool name spends the accent", () => {
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

describe("recolorShellCall", () => {
	test("rewrites the first line and leaves later lines alone", () => {
		expect(recolorShellCall("\u001b[1m$ ls\u001b[0m\nnext", "bash", coloringTheme)).toBe(
			"\u001b[1mbash \u001b[22m[text]ls\u001b[0m\nnext",
		);
	});

	test("leaves a call that is not a shell prompt alone", () => {
		expect(recolorShellCall("read src/a.ts", "read", coloringTheme)).toBe("read src/a.ts");
	});

	test("keeps every wrapped fragment of the command in label", () => {
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
