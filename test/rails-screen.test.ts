/**
 * Dock-screen suppression: every screen entry point hides the rails while it is
 * open and restores them afterwards.
 *
 * The rails themselves are exercised in `rails.test.ts`; here we only check that
 * each command/tool emits the suppression open/close pair on `pi.events`.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onRailsSuppressed, setRailsSuppressed, withRailsSuppressed } from "../extensions/_shared/rails.ts";
import askUserQuestion from "../extensions/ask-user-question/index.ts";
import { TOOL_NAME as ASK_TOOL } from "../extensions/ask-user-question/tools.ts";
import jobs from "../extensions/jobs/index.ts";
import planMode from "../extensions/plan-mode/index.ts";
import todo from "../extensions/todo/index.ts";
import { createFakePi } from "./helpers/fakes.ts";

/** Record the boolean the rails would see for each suppression event. */
function capture(pi: any): boolean[] {
	const events: boolean[] = [];
	onRailsSuppressed(pi, (suppressed) => events.push(suppressed));
	return events;
}

/** A TUI context whose `ui.custom` stays pending until `release` is called. */
function screenCtx(options: { cwd?: string; branch?: unknown[] } = {}) {
	let releaseResult!: (value?: unknown) => void;
	const demo = new Promise<unknown>((resolve) => {
		releaseResult = resolve;
	});
	let markCalled!: () => void;
	const called = new Promise<void>((resolve) => {
		markCalled = resolve;
	});
	const ctx: any = {
		cwd: options.cwd ?? process.cwd(),
		mode: "tui",
		hasUI: true,
		isIdle: () => true,
		sessionManager: {
			getBranch: () => options.branch ?? [],
			getSessionId: () => "s1",
			getLeafId: () => undefined,
		},
		ui: {
			theme: { fg: (_c: string, t: string) => t, bold: (t: string) => t },
			notify: () => {},
			setStatus: () => {},
			setWidget: () => {},
			confirm: async () => true,
			select: async () => undefined,
			custom: () => {
				markCalled();
				return demo;
			},
		},
	};
	return { ctx, called, release: (value?: unknown) => releaseResult(value) };
}

/** Minimal jobs runtime: the command only touches it before/after the screen. */
function stubJobsRuntime(): any {
	return {
		config: {},
		setUiSuppressed() {},
		reassertWidget() {},
		setStatus() {},
		takePending: () => [],
		shutdown: async () => {},
		onFinish: undefined,
	};
}

describe("withRailsSuppressed", () => {
	test("emits open then close and returns the screen result", async () => {
		const { pi } = createFakePi();
		const events = capture(pi);

		const result = await withRailsSuppressed(pi, async () => "ok");

		expect(result).toBe("ok");
		expect(events).toEqual([true, false]);
	});

	test("restores the rails when the screen throws", async () => {
		const { pi } = createFakePi();
		const events = capture(pi);

		await expect(
			withRailsSuppressed(pi, async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");

		expect(events).toEqual([true, false]);
	});
});

describe("onRailsSuppressed nesting", () => {
	test("reports true until the last nested screen closes", () => {
		const { pi } = createFakePi();
		const events = capture(pi);

		setRailsSuppressed(pi, true);
		setRailsSuppressed(pi, true);
		setRailsSuppressed(pi, false);
		setRailsSuppressed(pi, false);

		expect(events).toEqual([true, true, true, false]);
	});
});

describe("dock screens suppress the rails", () => {
	test("/todos", async () => {
		const { pi, commands } = createFakePi();
		todo(pi);
		const events = capture(pi);
		const { ctx, called, release } = screenCtx();

		const running = commands.get("todos").handler("", ctx);
		await called;
		expect(events).toEqual([true]);

		release();
		await running;
		expect(events).toEqual([true, false]);
	});

	test("/jobs", async () => {
		const { pi, commands } = createFakePi();
		jobs(pi, { runtime: stubJobsRuntime() });
		const events = capture(pi);
		const { ctx, called, release } = screenCtx();

		const running = commands.get("jobs").handler("", ctx);
		await called;
		expect(events).toEqual([true]);

		release();
		await running;
		expect(events).toEqual([true, false]);
	});

	test("/plans", async () => {
		const { pi, commands } = createFakePi();
		planMode(pi);
		const events = capture(pi);
		const { ctx, called, release } = screenCtx({ cwd: mkdtempSync(join(tmpdir(), "pi-rails-screen-")) });

		const running = commands.get("plans").handler("", ctx);
		await called;
		expect(events).toEqual([true]);

		release();
		await running;
		expect(events).toEqual([true, false]);
	});

	test("ask_user_question", async () => {
		const { pi, tools } = createFakePi();
		askUserQuestion(pi);
		const events = capture(pi);
		const { ctx, called, release } = screenCtx();

		const running = tools
			.get(ASK_TOOL)
			.execute(
				"call-1",
				{ questions: [{ question: "Pick one", options: [{ label: "a" }, { label: "b" }] }] },
				undefined,
				undefined,
				ctx,
			);
		await called;
		expect(events).toEqual([true]);

		release({ type: "cancelled", selections: new Map() });
		await running;
		expect(events).toEqual([true, false]);
	});
});
