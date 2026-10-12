import { describe, expect, test } from "bun:test";
import { DEFAULT_PROMPT_CONFIG, type PromptConfig } from "./config.ts";
import { createCompleter, refinePrompt, shouldRefine, type RefineDeps, type RefineGate } from "./refine.ts";
import type { Answer, ClarifyQuestion } from "./schema.ts";

const question: ClarifyQuestion = { header: "H", question: "Which one?", options: [] };
const answer: Answer = { header: "H", question: "Which one?", answer: "The first" };

const gate = (overrides: Partial<RefineGate> = {}): RefineGate => ({
	enabled: true,
	hasUI: true,
	hasModel: true,
	isIdle: true,
	source: "interactive",
	streaming: false,
	text: "please add a parser for the config file",
	minLength: 20,
	busy: false,
	...overrides,
});

const clarification = (overrides: Record<string, unknown> = {}): string =>
	JSON.stringify({ clear: false, goal: "Add the parser", questions: [question], ...overrides });

function deps(overrides: Partial<RefineDeps> = {}): RefineDeps {
	return {
		complete: async () => clarification(),
		ask: async () => [answer],
		confirm: async () => true,
		...overrides,
	};
}

const config = (overrides: Partial<PromptConfig> = {}): PromptConfig => ({ ...DEFAULT_PROMPT_CONFIG, ...overrides });

describe("shouldRefine", () => {
	test("accepts an eligible prompt", () => {
		expect(shouldRefine(gate())).toBe(true);
	});

	test("rejects every disqualifying fact", () => {
		expect(shouldRefine(gate({ enabled: false }))).toBe(false);
		expect(shouldRefine(gate({ hasUI: false }))).toBe(false);
		expect(shouldRefine(gate({ hasModel: false }))).toBe(false);
		expect(shouldRefine(gate({ isIdle: false }))).toBe(false);
		expect(shouldRefine(gate({ busy: true }))).toBe(false);
		expect(shouldRefine(gate({ source: "extension" }))).toBe(false);
		expect(shouldRefine(gate({ streaming: true }))).toBe(false);
	});

	test("rejects short prompts, slash commands, and bash", () => {
		expect(shouldRefine(gate({ text: "yes" }))).toBe(false);
		expect(shouldRefine(gate({ text: "/compact now please" }))).toBe(false);
		expect(shouldRefine(gate({ text: "!git status" }))).toBe(false);
	});
});

describe("refinePrompt", () => {
	test("transforms the prompt with the goal and the answers", async () => {
		const outcome = await refinePrompt({ text: "do the thing", config: config(), history: "", deps: deps() });
		expect(outcome.action).toBe("transform");
		if (outcome.action !== "transform") throw new Error("expected transform");
		expect(outcome.text).toContain("do the thing");
		expect(outcome.text).toContain("Clarified goal: Add the parser");
		expect(outcome.text).toContain("Answer: The first");
	});

	test("continues when the clarifier says the request is clear", async () => {
		let asked = false;
		const outcome = await refinePrompt({
			text: "do the thing",
			config: config(),
			history: "",
			deps: deps({
				complete: async () => clarification({ clear: true }),
				ask: async () => {
					asked = true;
					return [answer];
				},
			}),
		});
		expect(outcome).toEqual({ action: "continue" });
		expect(asked).toBe(false);
	});

	test("continues when the clarifier fails or answers with junk", async () => {
		const failure = await refinePrompt({
			text: "do the thing",
			config: config(),
			history: "",
			deps: deps({ complete: async () => undefined }),
		});
		expect(failure).toEqual({ action: "continue" });

		const junk = await refinePrompt({
			text: "do the thing",
			config: config(),
			history: "",
			deps: deps({ complete: async () => "not json" }),
		});
		expect(junk).toEqual({ action: "continue" });
	});

	test("continues when a seam throws", async () => {
		const outcome = await refinePrompt({
			text: "do the thing",
			config: config(),
			history: "",
			deps: deps({
				complete: async () => {
					throw new Error("provider down");
				},
			}),
		});
		expect(outcome).toEqual({ action: "continue" });
	});

	test("continues when the questions are cancelled or unanswered", async () => {
		const cancelled = await refinePrompt({
			text: "do the thing",
			config: config(),
			history: "",
			deps: deps({ ask: async () => undefined }),
		});
		expect(cancelled).toEqual({ action: "continue" });

		const empty = await refinePrompt({
			text: "do the thing",
			config: config(),
			history: "",
			deps: deps({ ask: async () => [] }),
		});
		expect(empty).toEqual({ action: "continue" });
	});

	test("continues when the goal is declined", async () => {
		const outcome = await refinePrompt({
			text: "do the thing",
			config: config({ confirmGoal: true }),
			history: "",
			deps: deps({ confirm: async () => false }),
		});
		expect(outcome).toEqual({ action: "continue" });
	});

	test("skips confirmation when confirmGoal is false", async () => {
		let confirmed = false;
		const outcome = await refinePrompt({
			text: "do the thing",
			config: config({ confirmGoal: false }),
			history: "",
			deps: deps({
				confirm: async () => {
					confirmed = true;
					return false;
				},
			}),
		});
		expect(outcome.action).toBe("transform");
		expect(confirmed).toBe(false);
	});
});

describe("createCompleter", () => {
	const model = { id: "test-model" } as never;

	test("returns undefined without a model", async () => {
		const completer = createCompleter({ model: undefined, modelRegistry: {} as never }, 1000, async (fn) =>
			fn(undefined),
		);
		expect(await completer("SYS", "USER")).toBeUndefined();
	});

	test("joins the assistant text parts", async () => {
		const calls: Array<{ systemPrompt?: string; text?: string }> = [];
		const registry = {
			complete: async (
				_model: unknown,
				context: { systemPrompt?: string; messages: Array<{ content: unknown[] }> },
			) => {
				calls.push({
					systemPrompt: context.systemPrompt,
					text: (context.messages[0].content[0] as { text: string }).text,
				});
				return {
					stopReason: "stop",
					content: [
						{ type: "text", text: "part one" },
						{ type: "text", text: "part two" },
					],
				};
			},
		};
		const completer = createCompleter({ model, modelRegistry: registry as never }, 1000, async (fn) => fn(undefined));
		expect(await completer("SYS", "USER")).toBe("part one\npart two");
		expect(calls[0].systemPrompt).toBe("SYS");
		expect(calls[0].text).toBe("USER");
	});

	test("returns undefined on an aborted response or a throw", async () => {
		const aborted = createCompleter(
			{ model, modelRegistry: { complete: async () => ({ stopReason: "aborted", content: [] }) } as never },
			1000,
			async (fn) => fn(undefined),
		);
		expect(await aborted("SYS", "USER")).toBeUndefined();

		const thrown = createCompleter(
			{
				model,
				modelRegistry: {
					complete: async () => {
						throw new Error("nope");
					},
				} as never,
			},
			1000,
			async (fn) => fn(undefined),
		);
		expect(await thrown("SYS", "USER")).toBeUndefined();
	});

	test("aborts the request when the loader signal aborts", async () => {
		let aborted: boolean | undefined;
		const registry = {
			complete: async (_model: unknown, _context: unknown, options: { signal: AbortSignal }) => {
				await Promise.resolve();
				aborted = options.signal.aborted;
				return { stopReason: "stop", content: [] };
			},
		};
		const completer = createCompleter({ model, modelRegistry: registry as never }, 1000, async (fn) => {
			const controller = new AbortController();
			const pending = fn(controller.signal);
			controller.abort();
			return pending;
		});
		await completer("SYS", "USER");
		expect(aborted).toBe(true);
	});
});
