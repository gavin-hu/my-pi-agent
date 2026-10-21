/**
 * The extension surface: one command, no tool, the disabled switch, and the
 * guarded compact action.
 *
 * The command's host reads are all on the fake context and the fake Pi, so these
 * tests assert the wiring (`/context` in every mode, `/context compact` refusing
 * a running turn) rather than the report arithmetic, which `report.test.ts` owns.
 */

import { describe, expect, test } from "bun:test";
import context from "./index.ts";
import { ENV_DISABLED_EXTENSIONS } from "../../lib/env.ts";
import { createFakePi, fakeTheme } from "../../test/helpers/fakes.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { withEnv } from "../../test/helpers/env.ts";
import {
	SAMPLE_SYSTEM_PROMPT,
	SAMPLE_USAGE,
	sampleCompaction,
	sampleMessages,
} from "../../test/helpers/fixtures/context.ts";

/** A fake Pi with the sample tool surface and compaction settings. */
function makePi() {
	const pi = createFakePi({
		active: ["read", "write", "edit"],
		allTools: [
			{ name: "read", description: "read a file", parameters: { type: "object" } },
			{ name: "write", description: "write a file", parameters: { type: "object" } },
			{ name: "edit", description: "edit a file", parameters: { type: "object" } },
			{ name: "grep", description: "search", parameters: { type: "object" } },
			{ name: "find", description: "find files", parameters: { type: "object" } },
		],
		settings: { compaction: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 } },
	});
	return pi;
}

/** A fake context wired to the sample projection and a recording `compact`. */
function makeContextCtx(options: { mode?: string; idle?: boolean } = {}) {
	const branch = [sampleCompaction()];
	const messages = sampleMessages();
	const compactCalls: Array<Record<string, unknown>> = [];
	const fake = fakeCtx({
		mode: options.mode ?? "print",
		isIdle: () => options.idle ?? true,
		branch,
		extra: {
			model: { provider: "anthropic", id: "claude", contextWindow: 200000 },
			getContextUsage: () => SAMPLE_USAGE,
			getSystemPrompt: () => SAMPLE_SYSTEM_PROMPT,
			compact: (compactOptions: Record<string, unknown>) => {
				compactCalls.push(compactOptions);
			},
			sessionManager: {
				buildSessionProjection: () => ({ messages, entries: [], thinkingLevel: "off", model: null }),
				getBranch: () => branch,
			},
		},
	});
	return { ...fake, compactCalls };
}

/** Load the factory with no inherited disabled list. */
async function load(fake: ReturnType<typeof makePi>): Promise<void> {
	await withEnv({ [ENV_DISABLED_EXTENSIONS]: "" }, () => context(fake.pi));
}

describe("registration", () => {
	test("registers /context and no tool", async () => {
		const fake = makePi();
		await load(fake);
		expect([...fake.commands.keys()]).toEqual(["context"]);
		expect(fake.tools.size).toBe(0);
	});

	test("registers nothing when disabled", async () => {
		const fake = makePi();
		await withEnv({ [ENV_DISABLED_EXTENSIONS]: "context" }, () => context(fake.pi));
		expect(fake.commands.size).toBe(0);
	});

	test("offers compact as the argument", async () => {
		const fake = makePi();
		await load(fake);
		const command = fake.commands.get("context");
		expect(command.getArgumentCompletions("co")).toEqual([{ value: "compact ", label: "compact" }]);
		expect(command.getArgumentCompletions("x")).toBeNull();
		expect(command.getArgumentCompletions("compact extra")).toBeNull();
	});
});

describe("/context", () => {
	test("prints the report outside the TUI", async () => {
		const fake = makePi();
		await load(fake);
		const { ctx, notifications } = makeContextCtx({ mode: "print" });
		await fake.commands.get("context").handler("", ctx);
		expect(notifications).toHaveLength(1);
		const text = notifications[0] ?? "";
		expect(text).toContain("Context · 124k / 200k (62%)");
		expect(text).toContain("Tool definitions");
		expect(text).toContain("Compaction · 1 so far");
	});

	test("opens the screen in the TUI", async () => {
		const fake = makePi();
		await load(fake);
		const { ctx, customCalls } = makeContextCtx({ mode: "tui" });
		await fake.commands.get("context").handler("", ctx);
		expect(customCalls).toHaveLength(1);

		const tui = { requestRender: () => {}, terminal: { rows: 30 } };
		const component = customCalls[0](tui, fakeTheme, {}, () => {});
		expect(component.render(80).join("\n")).toContain("c compact");
	});

	test("warns on an unknown subcommand", async () => {
		const fake = makePi();
		await load(fake);
		const { ctx, notices } = makeContextCtx();
		await fake.commands.get("context").handler("nope", ctx);
		expect(notices[0]?.kind).toBe("warning");
		expect(notices[0]?.message).toContain("Usage: /context");
	});
});

describe("/context compact", () => {
	test("refuses while a turn is streaming", async () => {
		const fake = makePi();
		await load(fake);
		const { ctx, notices, compactCalls } = makeContextCtx({ idle: false });
		await fake.commands.get("context").handler("compact", ctx);
		expect(compactCalls).toHaveLength(0);
		expect(notices[0]?.kind).toBe("warning");
		expect(notices[0]?.message).toContain("never interrupts a turn");
	});

	test("compacts with the instructions and reports the result", async () => {
		const fake = makePi();
		await load(fake);
		const { ctx, notifications, compactCalls } = makeContextCtx();
		await fake.commands.get("context").handler("compact  keep the API notes", ctx);

		expect(compactCalls).toHaveLength(1);
		expect(compactCalls[0]?.customInstructions).toBe("keep the API notes");

		const onComplete = compactCalls[0]?.onComplete as (result: unknown) => void;
		onComplete({
			summary: "s",
			firstKeptEntryId: "kept",
			tokensBefore: 180000,
			estimatedTokensAfter: 40000,
		});
		expect(notifications.at(-1)).toBe("Compacted 180k → 40k.");
	});

	test("reports a failure", async () => {
		const fake = makePi();
		await load(fake);
		const { ctx, notifications, compactCalls } = makeContextCtx();
		await fake.commands.get("context").handler("compact", ctx);
		const onError = compactCalls[0]?.onError as (error: unknown) => void;
		onError(new Error("nope"));
		expect(notifications.at(-1)).toBe("Compaction failed: nope");
	});
});
