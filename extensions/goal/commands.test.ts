import { describe, expect, test } from "bun:test";
import { GOAL_VERBS, type GoalCommand, completeGoalArg, parseGoalCommand } from "./commands.ts";
import { GOAL_HELP } from "./format.ts";

describe("parseGoalCommand", () => {
	const cases: Array<[string, GoalCommand]> = [
		["", { kind: "show" }],
		["   ", { kind: "show" }],
		["help", { kind: "usage" }],
		["-h", { kind: "usage" }],
		["--help", { kind: "usage" }],
		["HELP", { kind: "usage" }],
		["clear", { kind: "clear" }],
		["Clear", { kind: "clear" }],
		["done", { kind: "done" }],
		["achieved", { kind: "done" }],
		["set", { kind: "editor" }],
		["edit", { kind: "editor" }],
		["set   ", { kind: "editor" }],
		["set ship the parser", { kind: "record", text: "ship the parser" }],
		["edit ship the parser", { kind: "record", text: "ship the parser" }],
		["set   ship the parser", { kind: "record", text: "ship the parser" }],
		["raw ship the parser", { kind: "raw", text: "ship the parser" }],
		["raw", { kind: "usage" }],
		["raw   ", { kind: "usage" }],
		["ship the parser", { kind: "prompt", text: "ship the parser" }],
		["setfoo", { kind: "prompt", text: "setfoo" }],
		["edit-foo", { kind: "prompt", text: "edit-foo" }],
		["rawfoo", { kind: "prompt", text: "rawfoo" }],
		["clear the cache", { kind: "prompt", text: "clear the cache" }],
		["done already", { kind: "prompt", text: "done already" }],
		["help me refactor", { kind: "prompt", text: "help me refactor" }],
	];

	for (const [input, expected] of cases) {
		test(`parses ${JSON.stringify(input)}`, () => {
			expect(parseGoalCommand(input)).toEqual(expected);
		});
	}
});

describe("goal verbs", () => {
	test("the table is the only list: every verb completes and is named in the help", () => {
		for (const verb of GOAL_VERBS) {
			const value = verb.argument === "none" ? verb.word : `${verb.word} `;
			expect(completeGoalArg(verb.word)).toContainEqual({ value, label: verb.word });
			expect(GOAL_HELP).toContain(verb.word);
		}
	});

	test("a bare verb is never treated as a prompt", () => {
		for (const verb of GOAL_VERBS) {
			const kind = parseGoalCommand(verb.word).kind;
			expect(kind).not.toBe("prompt");
			expect(kind).not.toBe("show");
		}
	});

	test("an argument verb takes the rest of the line, trimming only its edges", () => {
		expect(parseGoalCommand("set  ship   the  parser ")).toEqual({ kind: "record", text: "ship   the  parser" });
		expect(parseGoalCommand("raw   ship the parser")).toEqual({ kind: "raw", text: "ship the parser" });
	});
});
