import { describe, expect, test } from "bun:test";
import { INTERACTION_OTHER_LABEL } from "../../lib/interaction.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { askQuestions, confirmRequest, withLoader } from "./dialogs.ts";
import type { ClarifyQuestion } from "./schema.ts";

const choice = (): ClarifyQuestion => ({
	header: "Auth",
	question: "Which auth?",
	options: [{ label: "OAuth", description: "provider flow" }, { label: "Session" }],
});

describe("withLoader", () => {
	test("runs directly and forwards the signal outside tui mode", async () => {
		const controller = new AbortController();
		const ctx = { mode: "rpc", signal: controller.signal, ui: {} };
		const seen = await withLoader(ctx as never, "working", async (signal) => signal);
		expect(seen).toBe(controller.signal);
	});

	test("delegates to the custom component in tui mode", async () => {
		let usedCustom = false;
		const ctx = {
			mode: "tui",
			signal: undefined,
			ui: {
				custom: async () => {
					usedCustom = true;
					return "from-custom";
				},
			},
		};
		const result = await withLoader(ctx as never, "working", async () => "inner");
		expect(usedCustom).toBe(true);
		expect(result).toBe("from-custom");
	});
});

describe("askQuestions", () => {
	test("records the selected label for a choice question", async () => {
		const { ctx, selects } = fakeCtx({ select: "OAuth" });
		const answers = await askQuestions(ctx.ui, [choice()]);
		expect(answers).toEqual([{ header: "Auth", question: "Which auth?", answer: "OAuth" }]);
		expect(selects[0][0]).toBe("OAuth — provider flow");
		expect(selects[0].at(-1)).toBe(INTERACTION_OTHER_LABEL);
	});

	test("uses the free-form input for the Other choice", async () => {
		const { ctx } = fakeCtx({ select: INTERACTION_OTHER_LABEL, input: "passkeys" });
		const answers = await askQuestions(ctx.ui, [choice()]);
		expect(answers).toEqual([{ header: "Auth", question: "Which auth?", answer: "passkeys" }]);
	});

	test("uses the free-form input for a question without options", async () => {
		const { ctx } = fakeCtx({ input: "next Friday" });
		const answers = await askQuestions(ctx.ui, [{ header: "When", question: "Deadline?", options: [] }]);
		expect(answers).toEqual([{ header: "When", question: "Deadline?", answer: "next Friday" }]);
	});

	test("asks every question and drops empty answers", async () => {
		const { ctx } = fakeCtx({ select: ["OAuth", "Session"], input: "" });
		const answers = await askQuestions(ctx.ui, [choice(), { ...choice(), header: "Second" }]);
		expect(answers).toEqual([
			{ header: "Auth", question: "Which auth?", answer: "OAuth" },
			{ header: "Second", question: "Which auth?", answer: "Session" },
		]);
	});

	test("returns undefined when a dialog is cancelled", async () => {
		const { ctx } = fakeCtx({ select: [undefined] });
		expect(await askQuestions(ctx.ui, [choice()])).toBeUndefined();
	});

	test("sanitizes the question shown in the dialog", async () => {
		const titles: string[] = [];
		const ui = {
			select: async (title: string) => {
				titles.push(title);
				return "OAuth";
			},
		};
		await askQuestions(ui as never, [
			{ header: "Auth", question: "Which\u001b[31m auth?", options: [{ label: "OAuth" }, { label: "Session" }] },
		]);
		expect(titles[0]).toBe("Which [31m auth?");
	});
});

describe("confirmRequest", () => {
	test("shows the goal and the answers, and returns the dialog result", async () => {
		const calls: Array<{ title: string; message: string }> = [];
		const ui = {
			confirm: async (title: string, message: string) => {
				calls.push({ title, message });
				return true;
			},
		};
		const confirmed = await confirmRequest(ui as never, "Make tests pass", [
			{ header: "Scope", question: "Which?", answer: "unit" },
		]);
		expect(confirmed).toBe(true);
		expect(calls[0].title).toBe("Submit with this goal?");
		expect(calls[0].message).toContain("Clarified goal: Make tests pass");
		expect(calls[0].message).toContain("Scope: unit");
	});

	test("passes through a declined confirmation", async () => {
		const { ctx } = fakeCtx({ confirm: false });
		expect(await confirmRequest(ctx.ui, "Goal", [{ header: "H", question: "Q", answer: "A" }])).toBe(false);
	});
});
