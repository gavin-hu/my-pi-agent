import { describe, expect, test } from "bun:test";
import { coloringTheme, fakeTheme } from "../../../test/helpers/fakes.ts";
import { callFallback, resultFallback } from "./fallback.ts";

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
