import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MarkdownTransformContext } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { tempDir, withAgentDir } from "../../../test/helpers/env.ts";
import { coloringTheme, createFakePi, emit, fakeTheme } from "../../../test/helpers/fakes.ts";
import { fakeCtx } from "../../../test/helpers/context.ts";
import { GLYPHS } from "../../../lib/tui/glyphs.ts";
import { DEFAULT_RAIL_GLYPH } from "../chrome.ts";
import { styleMessage } from "../message/format.ts";
import { NextStepsComponent, NEXT_STEPS_LABEL, nextStepsLines } from "./component.ts";
import { DEFAULT_SUGGEST_CONFIG, loadSuggestConfig, normalizeSuggestConfig, type SuggestConfig } from "./config.ts";
import { NEXT_STEP_SECTION, nextStepInstruction } from "./instruction.ts";
import { MAX_ITEM_COLUMNS, parseNextSteps } from "./parse.ts";
import { registerNextSteps } from "./register.ts";
import { registerTurnSeparator } from "../separator/register.ts";
import { NEXT_STEPS_ENTRY_TYPE } from "./types.ts";

const theme = fakeTheme;

/** A transcript-transform context for one message type. */
function transform(messageType: "user" | "assistant" | "assistant-thinking", width = 80): MarkdownTransformContext {
	return { messageType, isStreaming: false, availableWidth: width };
}

/** A temp project directory with no `bytefly.json` of its own. */
function projectDir(): string {
	return tempDir("bytefly-next-");
}

/** Write a project-scope `bytefly.json` under `<repo>/.pi`. */
function writeProject(repo: string, config: unknown): void {
	mkdirSync(join(repo, ".pi"), { recursive: true });
	writeFileSync(join(repo, ".pi", "bytefly.json"), JSON.stringify(config));
}

describe("nextStepInstruction", () => {
	test("names the exact block the parser accepts", () => {
		const text = nextStepInstruction();
		expect(text).toContain("Next:");
		expect(text).toContain("1. <one action");
		expect(text).toContain("2. <a different action>");
		expect(text).toContain("Two or three options");
	});

	test("asks for one block and says when to omit it", () => {
		const text = nextStepInstruction();
		expect(text).toContain("exactly one final block");
		expect(text).toContain("Omit the block when the turn finished the work");
		expect(text).toContain("Do not");
		expect(text).toContain("backticks");
	});

	test("stays inside its ceiling", () => {
		expect(nextStepInstruction().length).toBeLessThanOrEqual(420);
		expect(nextStepInstruction()).toBe(nextStepInstruction());
	});
});

describe("parseNextSteps", () => {
	test("lifts a two-item block and leaves the reply behind", () => {
		const reply = "Done.\n\nNext:\n1. Run `bun run check`\n2. Land the branch";
		expect(parseNextSteps(reply)).toEqual({
			items: ["Run `bun run check`", "Land the branch"],
			stripped: "Done.",
		});
	});

	test("accepts bullets and three items", () => {
		const reply = "Done.\n\nNext:\n- One\n- Two\n- Three";
		expect(parseNextSteps(reply)?.items).toEqual(["One", "Two", "Three"]);
	});

	test("keeps the first three of four and drops the numbering", () => {
		const reply = "Done.\n\nNext:\n1. One\n2. Two\n3) Three\n4. Four";
		const parsed = parseNextSteps(reply);
		expect(parsed?.items).toEqual(["One", "Two", "Three"]);
		expect(parsed?.stripped).toBe("Done.");
	});

	test("ignores a marker that is not the last block", () => {
		const reply = "Next:\n1. One\n2. Two\n\nI kept talking after the list.";
		expect(parseNextSteps(reply)).toBeUndefined();
	});

	test("ignores a marker inside a fenced example", () => {
		const reply = "The protocol line looks like this:\n\n```\nNext:\n1. 12.5s\n2. 8.1s\n```";
		expect(parseNextSteps(reply)).toBeUndefined();
	});

	test("treats one item as prose", () => {
		expect(parseNextSteps("Done.\n\nNext:\n1. Only one")).toBeUndefined();
	});

	test("rejects a block whose lines are not list items", () => {
		expect(parseNextSteps("Done.\n\nNext:\n1. One\njust more prose")).toBeUndefined();
	});

	test("accepts CRLF line endings", () => {
		const parsed = parseNextSteps("Done.\r\n\r\nNext:\r\n1. One\r\n2. Two");
		expect(parsed?.items).toEqual(["One", "Two"]);
		expect(parsed?.stripped).toBe("Done.");
	});

	test("an empty reply has nothing to lift", () => {
		expect(parseNextSteps("")).toBeUndefined();
		expect(parseNextSteps("   \n\n")).toBeUndefined();
	});

	test("a reply that is only the block strips to nothing", () => {
		expect(parseNextSteps("Next:\n1. One\n2. Two")?.stripped).toBe("");
	});

	test("clips a long item and strips control characters", () => {
		const long = "word ".repeat(60).trim();
		const parsed = parseNextSteps(`Done.\n\nNext:\n1. ${long}\n2. Two\u001b[31m`);
		expect(visibleWidth(parsed?.items[0] ?? "")).toBeLessThanOrEqual(MAX_ITEM_COLUMNS);
		expect(stripTerminalSequences(parsed?.items[0] ?? "")).toEndWith("…");
		// The control byte is neutralized; the printable tail of an escape is not
		// this boundary's job (the text is the model's own, not program output).
		expect(parsed?.items[1]).not.toContain("\u001b");
		expect(parsed?.items[1]).toStartWith("Two");
	});
});

describe("nextStepsLines", () => {
	const ITEMS = ["Cut the release", "Recapture `assets/chrome.png`"];

	test("draws the label at the margin and one glyph row per item", () => {
		const lines = nextStepsLines(ITEMS, coloringTheme, 80).map(stripTerminalSequences);
		expect(lines[0]).toContain(NEXT_STEPS_LABEL);
		expect(lines[1]).toContain(GLYPHS.next);
		expect(lines[1]).toContain("Cut the release");
		expect(lines[2]).toContain("Recapture `assets/chrome.png`");
	});

	test("never draws the model's numbering", () => {
		const lines = nextStepsLines(["One", "Two", "Three"], theme, 80).join("\n");
		expect(lines).not.toContain("1.");
		expect(lines).not.toContain("2.");
	});

	test("paints the label, the marker, and the item text in their roles", () => {
		const lines = nextStepsLines(ITEMS, coloringTheme, 80);
		expect(lines[0]).toContain("[accent]");
		expect(lines[1]).toContain("[muted]");
	});

	test("wraps a long item under the marker instead of clipping it", () => {
		const item = "Recapture the hero at the new version, then update the two entry READMEs' rows";
		const lines = nextStepsLines([item, "Short"], theme, 40).map((line) => stripTerminalSequences(line).trimEnd());
		const wrapped = lines.filter((line) => line.includes("Recapture") || line.includes("READMEs"));
		expect(wrapped.length).toBeGreaterThan(1);
		expect(lines.join(" ")).toContain("READMEs");
	});

	test("keeps every line inside the width", () => {
		const item = "Recapture the hero at the new version and update the two entry READMEs' catalog rows";
		for (const width of [1, 12, 40, 80]) {
			for (const line of nextStepsLines([item, "Short"], theme, width)) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(Math.max(1, width));
			}
		}
	});

	test("honours the configured rail glyph", () => {
		const lines = nextStepsLines(["One", "Two"], theme, 80, "│").join("\n");
		expect(lines).toContain("│");
		expect(lines).not.toContain(DEFAULT_RAIL_GLYPH);
	});

	test("repeats a render from the component", () => {
		const component = new NextStepsComponent({ items: ITEMS }, theme);
		expect(component.render(80)).toEqual(component.render(80));
	});
});

describe("suggest config", () => {
	test("is on by default", async () => {
		await withAgentDir(() => {
			expect(loadSuggestConfig(projectDir())).toEqual(DEFAULT_SUGGEST_CONFIG);
			expect(DEFAULT_SUGGEST_CONFIG.enabled).toBe(true);
		}, "bytefly-next-agent-");
	});

	test("reads the project file", async () => {
		const repo = projectDir();
		writeProject(repo, { suggest: { enabled: false } });
		await withAgentDir(() => {
			expect(loadSuggestConfig(repo).enabled).toBe(false);
		}, "bytefly-next-agent-");
	});

	test("falls back on a value that is not a boolean", () => {
		const base: SuggestConfig = { enabled: true };
		expect(normalizeSuggestConfig({ enabled: "yes" }, base)).toEqual(base);
		expect(normalizeSuggestConfig({ enabled: false }, base).enabled).toBe(false);
		expect(normalizeSuggestConfig(undefined, base)).toEqual(base);
	});
});

describe("styleMessage", () => {
	test("keeps the nameplate for a user message", () => {
		const text = styleMessage("hi", transform("user"));
		expect(text).toContain("## You");
		expect(text).toEndWith("hi");
	});

	test("strips a lifted block from an assistant reply", () => {
		const reply = "Done.\n\nNext:\n1. One\n2. Two";
		expect(styleMessage(reply, transform("assistant"))).toBe("Done.");
	});

	test("leaves an assistant reply without a block alone", () => {
		const reply = "Just an answer, with a list:\n\n- a\n- b";
		expect(styleMessage(reply, transform("assistant"))).toBe(reply);
	});

	test("strips while streaming too", () => {
		const reply = "Done.\n\nNext:\n1. One\n2. Two";
		expect(styleMessage(reply, { ...transform("assistant"), isStreaming: true })).toBe("Done.");
	});

	test("leaves thinking text alone", () => {
		const reply = "Next:\n1. One\n2. Two";
		expect(styleMessage(reply, transform("assistant-thinking"))).toBe(reply);
	});
});

describe("registerNextSteps", () => {
	/** A fake pi plus one settled turn whose reply is `reply`. */
	async function settle(options: { reply?: string; aborted?: boolean; mode?: string; cwd?: string } = {}) {
		const { pi, appended, renderers } = createFakePi();
		registerNextSteps(pi);
		const reply = options.reply ?? "Done.\n\nNext:\n1. One\n2. Two";
		const ctx = fakeCtx({ mode: options.mode ?? "tui", cwd: options.cwd }).ctx;
		const prompt = { prompt: "go", systemPrompt: "", systemPromptOptions: { sections: {} as Record<string, string> } };
		await emit(pi, "before_agent_start", prompt, ctx);
		await emit(pi, "agent_start", { type: "agent_start" }, ctx);
		await emit(pi, "message_end", { message: { role: "assistant", content: [{ type: "text", text: reply }] } }, ctx);
		await emit(pi, "agent_settled", { type: "agent_settled", aborted: options.aborted ?? false }, ctx);
		return { pi, appended, renderers, prompt, ctx };
	}

	test("registers the entry renderer under its own type", async () => {
		const { renderers } = await settle();
		expect(renderers.has(NEXT_STEPS_ENTRY_TYPE)).toBe(true);
	});

	test("writes the instruction into the system-prompt sections", async () => {
		const { prompt } = await settle();
		expect(prompt.systemPromptOptions.sections[NEXT_STEP_SECTION]).toBe(nextStepInstruction());
	});

	test("appends the lifted items as an entry", async () => {
		const { appended } = await settle();
		expect(appended).toEqual([{ customType: NEXT_STEPS_ENTRY_TYPE, data: { items: ["One", "Two"] } }]);
	});

	test("appends nothing for an aborted run", async () => {
		const { appended } = await settle({ aborted: true });
		expect(appended).toEqual([]);
	});

	test("appends nothing outside interactive mode", async () => {
		const { appended } = await settle({ mode: "print" });
		expect(appended).toEqual([]);
	});

	test("appends nothing when the reply has no block", async () => {
		const { appended } = await settle({ reply: "Just an answer." });
		expect(appended).toEqual([]);
	});

	test("appends nothing when the section is off", async () => {
		const repo = projectDir();
		writeProject(repo, { suggest: { enabled: false } });
		await withAgentDir(async () => {
			const { appended, prompt } = await settle({ cwd: repo });
			expect(prompt.systemPromptOptions.sections[NEXT_STEP_SECTION]).toBeUndefined();
			expect(appended).toEqual([]);
		}, "bytefly-next-agent-");
	});

	test("lands its entry after the turn separator's", async () => {
		const { pi, appended } = createFakePi();
		registerTurnSeparator(pi);
		registerNextSteps(pi);
		const ctx = fakeCtx().ctx;
		await emit(
			pi,
			"before_agent_start",
			{ prompt: "go", systemPrompt: "", systemPromptOptions: { sections: {} as Record<string, string> } },
			ctx,
		);
		await emit(pi, "agent_start", { type: "agent_start" }, ctx);
		await emit(
			pi,
			"message_end",
			{ message: { role: "assistant", content: [{ type: "text", text: "Done.\n\nNext:\n1. One\n2. Two" }] } },
			ctx,
		);
		await emit(pi, "agent_settled", { type: "agent_settled", aborted: false }, ctx);

		expect(appended.map((entry) => entry.customType)).toEqual(["bytefly-separator", NEXT_STEPS_ENTRY_TYPE]);
	});

	test("renders the entry for its stored items and nothing for an empty one", () => {
		let renderer: ((entry: unknown, options: unknown, theme: unknown) => unknown) | undefined;
		const pi = {
			registerEntryRenderer: (_type: string, fn: typeof renderer) => {
				renderer = fn;
			},
			on: () => {},
		} as never;
		registerNextSteps(pi);
		expect(renderer?.({ data: { items: ["One", "Two"] } }, {}, theme)).toBeInstanceOf(NextStepsComponent);
		expect(renderer?.({ data: { items: [] } }, {}, theme)).toBeUndefined();
		expect(renderer?.({ data: undefined }, {}, theme)).toBeUndefined();
	});
});
