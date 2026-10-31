/**
 * End-to-end wiring for the goal extension: registration, the `/goal` command
 * grammar and flow, the session hooks, the injected reminder, and the widget.
 * Pure formatting, the tool, the clarify loop, and runtime state live in their
 * own suites.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ENV_DISABLED_EXTENSIONS } from "../../lib/env.ts";
import { PLAN_ENTER_REQUEST, type PlanModeRequest } from "../../lib/plan-entry.ts";
import { fakeCtx, type FakeCtxOptions } from "../../test/helpers/context.ts";
import { lastWidget, otherMessage } from "../../test/helpers/entries.ts";
import { tempDir, withAgentDir, withEnv } from "../../test/helpers/env.ts";
import { emitCollect as emit, makeFakePi } from "../../test/helpers/fakes.ts";
import { clarifyRegistry, clarifyReply, goalContextMessage, resultEntry } from "../../test/helpers/fixtures/goal.ts";
import { NOTES_FENCE } from "./clarify.ts";
import { GOAL_VERBS, type GoalCommand, completeGoalArg, parseGoalCommand } from "./commands.ts";
import { GOAL_HELP } from "./format.ts";
import goal, { GOAL_CONTEXT_MARKER } from "./index.ts";
import { TOOL_NAME } from "./tools.ts";
import { WIDGET_KEY } from "./tui.ts";
import type { Goal } from "./types.ts";

const active = (objective: string): Goal => ({ objective, status: "active" });
const achieved = (objective: string): Goal => ({ objective, status: "achieved" });
const planning = (objective: string): Goal => ({ objective, status: "planning" });

/** A branch that plan mode has turned on. */
const PLAN_MODE_ON = { type: "custom", customType: "plan-mode", data: { enabled: true } };

describe("/goal argument grammar", () => {
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

	test("the verb table is the only list: every verb completes and is named in the help", () => {
		for (const verb of GOAL_VERBS) {
			const value = verb.argument === "none" ? verb.word : `${verb.word} `;
			expect(completeGoalArg(verb.word)).toContainEqual({ value, label: verb.word });
			expect(GOAL_HELP).toContain(verb.word);
		}
	});

	test("completes a keyword in any case, as the parser accepts it", () => {
		expect(completeGoalArg("S")).toContainEqual({ value: "set ", label: "set" });
		expect(completeGoalArg("A")).toContainEqual({ value: "achieved", label: "achieved" });
		expect(completeGoalArg("RAW")).toContainEqual({ value: "raw ", label: "raw" });
	});

	test("a bare verb is never treated as a prompt or as the show form", () => {
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

describe("goal extension registration and lifecycle", () => {
	test("registers nothing when disabled through PI_DISABLED_EXTENSIONS", async () => {
		await withEnv({ [ENV_DISABLED_EXTENSIONS]: "goal" }, () => {
			const { pi, tools, commands, handlers } = makeFakePi();
			goal(pi);
			expect(tools.size).toBe(0);
			expect(commands.size).toBe(0);
			expect(handlers.size).toBe(0);
		});
	});

	test("registers the tool and the /goal command", () => {
		const { pi, tools, commands } = makeFakePi();
		goal(pi);
		expect(tools.has(TOOL_NAME)).toBe(true);
		expect(commands.has("goal")).toBe(true);
	});

	test("completes the goal keywords but leaves a free-form prompt alone", () => {
		const { pi, commands } = makeFakePi();
		goal(pi);
		const complete = (prefix: string): string[] =>
			(commands.get("goal").getArgumentCompletions(prefix) ?? []).map((item: { label: string }) => item.label);
		expect(complete("")).toEqual(["set", "edit", "raw", "clear", "done", "achieved", "help", "-h", "--help"]);
		expect(complete("e")).toEqual(["edit"]);
		expect(complete("fix the bug")).toEqual([]);
	});

	test("reconstructs the goal from the branch on session start", async () => {
		const { pi, commands } = makeFakePi();
		goal(pi);
		const { ctx, notifications } = fakeCtx({
			mode: "print",
			branch: [resultEntry(active("first")), resultEntry(achieved("second"))],
		});

		await emit(pi, "session_start", { reason: "startup" }, ctx);
		await commands.get("goal").handler("", ctx);

		expect(notifications.at(-1)).toBe("Goal achieved: second");
	});

	test("reconstructs on session_tree", async () => {
		const { pi, commands } = makeFakePi();
		goal(pi);
		const { ctx, notifications } = fakeCtx({ mode: "print", branch: [resultEntry(active("branched"))] });

		await emit(pi, "session_tree", {}, ctx);
		await commands.get("goal").handler("", ctx);

		expect(notifications.at(-1)).toBe("Goal (active): branched");
	});

	test("reconstructs a goal set by the /goal command from a custom entry", async () => {
		const { pi, commands } = makeFakePi();
		goal(pi);
		const { ctx, notifications } = fakeCtx({
			mode: "print",
			branch: [{ type: "custom", customType: "goal", data: { goal: active("from command") } }],
		});

		await emit(pi, "session_start", { reason: "startup" }, ctx);
		await commands.get("goal").handler("", ctx);

		expect(notifications.at(-1)).toBe("Goal (active): from command");
	});

	test("sets the widget on session start in interactive mode but not in print mode", async () => {
		const tui = makeFakePi();
		goal(tui.pi);
		const interactive = fakeCtx({ mode: "tui", branch: [resultEntry(active("one"))] });
		await emit(tui.pi, "session_start", { reason: "startup" }, interactive.ctx);
		expect(interactive.widgetCalls.at(-1)?.key).toBe(WIDGET_KEY);
		expect(lastWidget(interactive.widgetCalls)).toBeInstanceOf(Function);

		const print = makeFakePi();
		goal(print.pi);
		const headless = fakeCtx({ mode: "print", branch: [resultEntry(active("one"))] });
		await emit(print.pi, "session_start", { reason: "startup" }, headless.ctx);
		expect(headless.widgetCalls).toHaveLength(0);
	});

	test("clears the widget on shutdown", async () => {
		const { pi } = makeFakePi();
		goal(pi);
		const { ctx, widgetCalls } = fakeCtx({ mode: "tui", branch: [resultEntry(active("one"))] });
		await emit(pi, "session_start", { reason: "startup" }, ctx);
		await emit(pi, "session_shutdown", {}, ctx);
		expect(widgetCalls.at(-1)).toEqual({ key: WIDGET_KEY, content: undefined });
	});

	test("honors a project config that hides achieved goals", async () => {
		const repo = tempDir("goal-ext-repo-");
		mkdirSync(join(repo, ".pi"), { recursive: true });
		writeFileSync(join(repo, ".pi", "bytefly.json"), JSON.stringify({ goal: { achieved: "hide" } }));

		await withAgentDir(async () => {
			const { pi } = makeFakePi();
			goal(pi);
			const { ctx, widgetCalls } = fakeCtx({
				mode: "tui",
				cwd: repo,
				branch: [resultEntry(achieved("done"))],
			});
			await emit(pi, "session_start", { reason: "startup" }, ctx);

			expect(widgetCalls.at(-1)).toEqual({ key: WIDGET_KEY, content: undefined });
		}, "goal-ext-global-");
	});
});

describe("goal reminder", () => {
	test("injects the marker before the agent starts while active", async () => {
		const { pi } = makeFakePi();
		goal(pi);
		const { ctx } = fakeCtx({ branch: [resultEntry(active("ship it"))] });
		await emit(pi, "session_start", { reason: "startup" }, ctx);

		const [result] = await emit(pi, "before_agent_start", {}, ctx);
		expect(result.message.customType).toBe("goal-context");
		expect(result.message.content).toContain(GOAL_CONTEXT_MARKER);
		expect(result.message.content).toContain("ship it");
		expect(result.message.display).toBe(false);
	});

	test("does not inject when the goal is absent or achieved", async () => {
		for (const branch of [[], [resultEntry(achieved("done"))]]) {
			const { pi } = makeFakePi();
			goal(pi);
			const { ctx } = fakeCtx({ branch });
			await emit(pi, "session_start", { reason: "startup" }, ctx);

			const [result] = await emit(pi, "before_agent_start", {}, ctx);
			expect(result).toBeUndefined();
		}
	});

	test("restates a goal that is still being planned", async () => {
		const { pi } = makeFakePi();
		goal(pi);
		const { ctx } = fakeCtx({ branch: [resultEntry(planning("design it")), PLAN_MODE_ON] });
		await emit(pi, "session_start", { reason: "startup" }, ctx);

		const [result] = await emit(pi, "before_agent_start", {}, ctx);
		expect(result.message.content).toContain("design it");
	});

	test("settles a planning goal once plan mode is left without a plan", async () => {
		const { pi, entries } = makeFakePi();
		goal(pi);
		const { ctx } = fakeCtx({ branch: [resultEntry(planning("design it"))] });
		await emit(pi, "session_start", { reason: "startup" }, ctx);

		expect(entries.at(-1)?.data).toEqual({ goal: { objective: "design it", status: "active" } });
	});

	test("leaves a planning goal alone while plan mode is on", async () => {
		const { pi, entries } = makeFakePi();
		goal(pi);
		const { ctx } = fakeCtx({ branch: [resultEntry(planning("design it")), PLAN_MODE_ON] });
		await emit(pi, "session_start", { reason: "startup" }, ctx);

		expect(entries).toEqual([]);
	});

	test("filters stale goal context when the goal is cleared", async () => {
		const { pi } = makeFakePi();
		goal(pi);
		const { ctx } = fakeCtx();
		await emit(pi, "session_start", { reason: "startup" }, ctx);

		const [result] = await emit(pi, "context", { messages: [goalContextMessage(), otherMessage()] }, ctx);
		expect(result.messages).toEqual([otherMessage()]);
	});

	test("filters stale goal context once the goal is achieved", async () => {
		const { pi } = makeFakePi();
		goal(pi);
		const { ctx } = fakeCtx({ branch: [resultEntry(achieved("done"))] });
		await emit(pi, "session_start", { reason: "startup" }, ctx);

		const [result] = await emit(pi, "context", { messages: [goalContextMessage(), otherMessage()] }, ctx);
		expect(result.messages).toEqual([otherMessage()]);
	});

	test("keeps messages while active and keeps only the newest injection", async () => {
		const { pi } = makeFakePi();
		goal(pi);
		const { ctx } = fakeCtx({ branch: [resultEntry(active("ship it"))] });
		await emit(pi, "session_start", { reason: "startup" }, ctx);

		const [only] = await emit(pi, "context", { messages: [goalContextMessage()] }, ctx);
		expect(only).toBeUndefined();

		const newest = goalContextMessage("newest");
		const [result] = await emit(pi, "context", { messages: [goalContextMessage(), otherMessage(), newest] }, ctx);
		expect(result.messages).toEqual([otherMessage(), newest]);
	});

	test("does not strip a user message that contains the marker", async () => {
		const { pi } = makeFakePi();
		goal(pi);
		const { ctx } = fakeCtx({ branch: [resultEntry(null)] });
		await emit(pi, "session_start", { reason: "startup" }, ctx);

		const user = { role: "user", content: "Why does my prompt show [SESSION GOAL] at the top?" };
		const [result] = await emit(pi, "context", { messages: [goalContextMessage(), user] }, ctx);
		expect(result.messages).toEqual([user]);
	});
});

describe("/goal command", () => {
	async function started(branch: unknown[] = [], ctxOptions: Partial<FakeCtxOptions> = {}, plan = false) {
		const fakePi = makeFakePi(plan ? { allTools: [{ name: "plan" }] } : {});
		goal(fakePi.pi);
		const fake = fakeCtx({ mode: "print", branch, ...ctxOptions });
		await emit(fakePi.pi, "session_start", { reason: "startup" }, fake.ctx);
		return {
			pi: fakePi.pi,
			command: fakePi.commands.get("goal"),
			entries: fakePi.entries,
			sentMessages: fakePi.sentMessages,
			...fake,
		};
	}

	test("records a draft when the user accepts planning before the run", async () => {
		const { pi, command, ctx, notifications, entries, sentMessages } = await started(
			[],
			{ mode: "rpc", hasUI: true, confirm: true },
			true,
		);
		pi.events.on(PLAN_ENTER_REQUEST, (data: unknown) => (data as PlanModeRequest).respond(true));

		await command.handler("raw ship the parser", ctx);

		expect(entries.at(-1)?.data).toEqual({ goal: { objective: "ship the parser", status: "planning" } });
		expect(notifications.at(-1)).toStartWith("Goal (planning): ship the parser");
		expect(notifications.at(-1)).toContain("Approve the plan to set the final goal");
		expect(sentMessages.at(-1)).toEqual({ content: "ship the parser", options: undefined });
	});

	test("records the objective when the user declines planning", async () => {
		const { command, ctx, entries, sentMessages } = await started(
			[],
			{ mode: "rpc", hasUI: true, confirm: false },
			true,
		);

		await command.handler("raw ship the parser", ctx);

		expect(entries.at(-1)?.data).toEqual({ goal: { objective: "ship the parser", status: "active" } });
		expect(sentMessages.at(-1)?.content).toBe("ship the parser");
	});

	test("does not ask about planning when the plan extension is not loaded", async () => {
		const { command, ctx, confirms } = await started([], { mode: "rpc", hasUI: true, confirm: true });

		await command.handler("raw ship the parser", ctx);

		expect(confirms).toEqual([]);
	});

	test("shows usage when no goal is set and the goal when one is", async () => {
		const none = await started();
		await none.command.handler("", none.ctx);
		expect(none.notifications.at(-1)).toBe(GOAL_HELP);

		const some = await started([resultEntry(active("ship it"))]);
		await some.command.handler("", some.ctx);
		expect(some.notifications.at(-1)).toBe("Goal (active): ship it");
	});

	test("names the exits when the goal is still being planned", async () => {
		const { command, ctx, notifications } = await started([resultEntry(planning("ship it")), PLAN_MODE_ON], {}, true);
		await command.handler("", ctx);

		expect(notifications.at(-1)).toContain("Goal (planning): ship it");
		expect(notifications.at(-1)).toContain("leaving plan mode keeps this wording");
	});

	test("shows usage for /goal help with or without a goal", async () => {
		const none = await started();
		await none.command.handler("help", none.ctx);
		expect(none.notifications.at(-1)).toBe(GOAL_HELP);

		const some = await started([resultEntry(active("ship it"))]);
		await some.command.handler("--help", some.ctx);
		expect(some.notifications.at(-1)).toBe(GOAL_HELP);
	});

	test("clearing an unset goal is a no-op with a report", async () => {
		const { command, ctx, notifications, entries } = await started();
		await command.handler("clear", ctx);
		expect(notifications.at(-1)).toBe("No goal set.");
		expect(entries).toHaveLength(0);
	});

	test("sets a goal, persists it, and starts the run", async () => {
		const { command, ctx, notifications, entries, sentMessages } = await started();
		await command.handler("  ship the parser  ", ctx);
		expect(notifications.at(-1)).toBe("Goal (active): ship the parser");
		expect(entries.at(-1)).toEqual({
			type: "custom",
			customType: "goal",
			data: { goal: { objective: "ship the parser", status: "active" } },
		});
		expect(sentMessages.at(-1)).toEqual({ content: "ship the parser", options: undefined });
	});

	test("confirms before replacing an active goal and leaves it alone when declined", async () => {
		const { command, ctx, entries, sentMessages, notifications } = await started([resultEntry(active("old goal"))], {
			mode: "rpc",
			hasUI: true,
			confirm: false,
		});

		await command.handler("ship the parser", ctx);

		expect(notifications.at(-1)).toBe("Goal unchanged.");
		expect(entries).toHaveLength(0);
		expect(sentMessages).toHaveLength(0);
	});

	test("replaces the active goal when the confirmation is accepted", async () => {
		const { command, ctx, entries, sentMessages } = await started([resultEntry(active("old goal"))], {
			mode: "rpc",
			hasUI: true,
			confirm: true,
		});

		await command.handler("ship the parser", ctx);

		expect(entries.at(-1)?.data).toEqual({ goal: { objective: "ship the parser", status: "active" } });
		expect(sentMessages).toHaveLength(1);
	});

	test("does not guard an explicit record-only set with text", async () => {
		const { command, ctx, entries, notifications, confirms } = await started([resultEntry(active("old goal"))], {
			mode: "rpc",
			hasUI: true,
			confirm: undefined,
		});

		await command.handler("set ship the parser", ctx);

		expect(confirms).toEqual([]);
		expect(entries.at(-1)?.data).toEqual({ goal: { objective: "ship the parser", status: "active" } });
		expect(notifications.at(-1)).toBe("Goal (active): ship the parser");
	});

	test("records a goal without starting a run with /goal set", async () => {
		const { command, ctx, notifications, entries, sentMessages } = await started();
		await command.handler("set ship the parser", ctx);
		expect(notifications.at(-1)).toBe("Goal (active): ship the parser");
		expect(entries.at(-1)).toEqual({
			type: "custom",
			customType: "goal",
			data: { goal: { objective: "ship the parser", status: "active" } },
		});
		expect(sentMessages).toHaveLength(0);
	});

	test("/goal edit <text> records the text without starting a run", async () => {
		const { command, ctx, entries, sentMessages } = await started();
		await command.handler("edit ship the parser", ctx);
		expect(entries.at(-1)?.data).toEqual({ goal: { objective: "ship the parser", status: "active" } });
		expect(sentMessages).toHaveLength(0);
	});

	test("/goal raw <text> records and runs without comprehension", async () => {
		const { calls, registry } = clarifyRegistry(["ignored"]);
		const { command, ctx, entries, sentMessages, editorCalls } = await started([], {
			mode: "rpc",
			hasUI: true,
			editor: "ignored",
			extra: { model: { id: "m" }, modelRegistry: registry },
		});

		await command.handler("raw ship the parser", ctx);

		expect(entries.at(-1)?.data).toEqual({ goal: { objective: "ship the parser", status: "active" } });
		expect(sentMessages.at(-1)).toEqual({ content: "ship the parser", options: undefined });
		expect(calls).toHaveLength(0);
		expect(editorCalls).toHaveLength(0);
	});

	test("/goal raw without text shows the usage", async () => {
		const { command, ctx, notifications, entries, sentMessages } = await started();
		await command.handler("raw", ctx);
		expect(notifications.at(-1)).toBe(GOAL_HELP);
		expect(entries).toHaveLength(0);
		expect(sentMessages).toHaveLength(0);
	});

	test("records without running when /goal set clarifies through the editor", async () => {
		const { registry } = clarifyRegistry(["Refactor the parser"]);
		const { command, ctx, entries, sentMessages, editorCalls } = await started([], {
			mode: "rpc",
			hasUI: true,
			editor: "Refactor the parser to stream input",
			extra: { model: { id: "m" }, modelRegistry: registry },
		});

		await command.handler("set refactor the parser", ctx);

		expect(editorCalls[0].prefill).toBe("Refactor the parser");
		expect(entries.at(-1)?.data).toEqual({
			goal: { objective: "Refactor the parser to stream input", status: "active" },
		});
		expect(sentMessages).toHaveLength(0);
	});

	test("a bare set or edit prefills the current goal and saves without running", async () => {
		for (const verb of ["set", "edit"]) {
			const { command, ctx, entries, sentMessages, editorCalls, confirms } = await started(
				[resultEntry(active("old goal"))],
				{ mode: "rpc", hasUI: true, editor: "new goal" },
			);

			await command.handler(verb, ctx);

			expect(editorCalls[0].prefill).toBe("old goal");
			expect(confirms).toEqual([]);
			expect(entries.at(-1)?.data).toEqual({ goal: { objective: "new goal", status: "active" } });
			expect(sentMessages).toHaveLength(0);
		}
	});

	test("cancels a bare /goal set when the editor is dismissed", async () => {
		const { command, ctx, entries, sentMessages, notifications } = await started([resultEntry(active("old goal"))], {
			mode: "rpc",
			hasUI: true,
			editor: undefined,
		});

		await command.handler("set", ctx);

		expect(entries).toHaveLength(0);
		expect(sentMessages).toHaveLength(0);
		expect(notifications).toHaveLength(0);
	});

	test("shows usage for a bare /goal set without a UI", async () => {
		const { command, ctx, notifications } = await started();
		await command.handler("set", ctx);
		expect(notifications.at(-1)).toContain("/goal set");
	});

	test("asks the model's questions in-command and records the edited goal", async () => {
		const { calls, registry } = clarifyRegistry([clarifyReply()]);
		const { command, ctx, entries, sentMessages, editorCalls, selects } = await started([], {
			mode: "rpc",
			hasUI: true,
			select: "The new one",
			editor: "Add parser tests for the new parser, in CI",
			extra: { model: { id: "m" }, modelRegistry: registry },
		});

		await command.handler("add tests to the parser", ctx);

		expect(calls).toHaveLength(1);
		expect(selects).toEqual([["The new one", "The old one"]]);
		expect(editorCalls[0].prefill).toBe(`Add parser tests\n\n${NOTES_FENCE}\nAlso: Which parser? → The new one`);
		expect(entries.at(-1)?.data).toEqual({
			goal: { objective: "Add parser tests for the new parser, in CI", status: "active" },
		});
		expect(sentMessages.at(-1)).toEqual({ content: "Add parser tests for the new parser, in CI", options: undefined });
	});

	test("cancels an unclear goal when a question dialog is dismissed", async () => {
		const { registry } = clarifyRegistry([clarifyReply()]);
		const { command, ctx, entries, sentMessages, editorCalls } = await started([], {
			mode: "rpc",
			hasUI: true,
			select: undefined,
			editor: "ignored",
			extra: { model: { id: "m" }, modelRegistry: registry },
		});

		await command.handler("add tests to the parser", ctx);

		expect(entries).toHaveLength(0);
		expect(sentMessages).toHaveLength(0);
		expect(editorCalls).toHaveLength(0);
	});

	test("submits the prompt as a follow-up while the agent is busy", async () => {
		const { command, ctx, sentMessages } = await started([], { isIdle: () => false });
		await command.handler("ship the parser", ctx);
		expect(sentMessages.at(-1)).toEqual({ content: "ship the parser", options: { deliverAs: "followUp" } });
	});

	test("does not send a prompt when clearing or completing", async () => {
		const done = await started([resultEntry(active("ship it"))]);
		await done.command.handler("done", done.ctx);
		expect(done.sentMessages).toHaveLength(0);

		const cleared = await started([resultEntry(active("ship it"))]);
		await cleared.command.handler("clear", cleared.ctx);
		expect(cleared.sentMessages).toHaveLength(0);
	});

	test("does not send a prompt when validation fails", async () => {
		const { command, ctx, notifications, entries, sentMessages } = await started();
		await command.handler("x".repeat(5000), ctx);
		expect(notifications.at(-1)).toContain("Goal not set:");
		expect(entries).toHaveLength(0);
		expect(sentMessages).toHaveLength(0);
	});

	test("clarifies, prefills the editor, and sends the edited text", async () => {
		const { registry } = clarifyRegistry(["Refactor the parser to stream input"]);
		const { command, ctx, entries, sentMessages, editorCalls } = await started([], {
			mode: "rpc",
			hasUI: true,
			editor: "Refactor the parser to stream input, with tests",
			extra: { model: { id: "m" }, modelRegistry: registry },
		});

		await command.handler("refactor the parser", ctx);

		expect(editorCalls[0].prefill).toBe("Refactor the parser to stream input");
		expect(entries.at(-1)).toEqual({
			type: "custom",
			customType: "goal",
			data: { goal: { objective: "Refactor the parser to stream input, with tests", status: "active" } },
		});
		expect(sentMessages.at(-1)).toEqual({
			content: "Refactor the parser to stream input, with tests",
			options: undefined,
		});
	});

	test("aborts when the editor is dismissed", async () => {
		const { registry } = clarifyRegistry(["Clarified goal"]);
		const { command, ctx, entries, sentMessages, notifications } = await started([], {
			mode: "rpc",
			hasUI: true,
			editor: undefined,
			extra: { model: { id: "m" }, modelRegistry: registry },
		});

		await command.handler("refactor the parser", ctx);

		expect(entries).toHaveLength(0);
		expect(sentMessages).toHaveLength(0);
		expect(notifications).toHaveLength(0);
	});

	test("skips clarify and dialogs without a UI", async () => {
		const { calls, registry } = clarifyRegistry(["Clarified goal"]);
		const { command, ctx, editorCalls, sentMessages } = await started([], {
			extra: { model: { id: "m" }, modelRegistry: registry },
		});

		await command.handler("ship the parser", ctx);

		expect(calls).toHaveLength(0);
		expect(editorCalls).toHaveLength(0);
		expect(sentMessages.at(-1)?.content).toBe("ship the parser");
	});

	test("clears a goal and persists the clear", async () => {
		const { command, ctx, notifications, entries } = await started([resultEntry(active("ship it"))]);
		await command.handler("clear", ctx);
		expect(notifications.at(-1)).toBe("Goal cleared.");
		expect(entries.at(-1)).toEqual({ type: "custom", customType: "goal", data: { goal: null } });
	});

	test("marks a goal done and persists it", async () => {
		const { command, ctx, notifications, entries } = await started([resultEntry(active("ship it"))]);
		await command.handler("done", ctx);
		expect(notifications.at(-1)).toBe("Goal achieved: ship it");
		expect(entries.at(-1)).toEqual({
			type: "custom",
			customType: "goal",
			data: { goal: { objective: "ship it", status: "achieved" } },
		});
	});

	test("names the todo items still open when /goal done completes the goal", async () => {
		const { command, ctx, notifications } = await started([
			resultEntry(active("ship it")),
			{
				type: "message",
				message: {
					role: "toolResult",
					toolName: "todo",
					details: {
						todos: [
							{ content: "Close the docs", status: "completed" },
							{ content: "Ship the parser", status: "in_progress" },
						],
						action: "write",
					},
				},
			},
		]);
		await command.handler("done", ctx);
		expect(notifications.at(-1)).toBe(
			"Goal achieved: ship it\n1 todo item is still open; close or clear the list if that work is done.",
		);
	});

	test("marking an already achieved goal done again is a no-op", async () => {
		const { command, ctx, notifications, entries } = await started([resultEntry(achieved("ship it"))]);
		await command.handler("done", ctx);
		expect(notifications.at(-1)).toBe("Goal already achieved: ship it");
		expect(entries).toHaveLength(0);
	});

	test("accepts the achieved keyword as a synonym for done", async () => {
		const { command, ctx, notifications, entries } = await started([resultEntry(active("ship it"))]);
		await command.handler("achieved", ctx);
		expect(notifications.at(-1)).toBe("Goal achieved: ship it");
		expect(entries.at(-1)).toEqual({
			type: "custom",
			customType: "goal",
			data: { goal: { objective: "ship it", status: "achieved" } },
		});
	});

	test("refuses to complete a missing goal", async () => {
		const { command, ctx, notifications } = await started();
		await command.handler("done", ctx);
		expect(notifications.at(-1)).toBe("No goal set.");
	});
});
