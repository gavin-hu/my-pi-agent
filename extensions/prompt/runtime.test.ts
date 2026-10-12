import { describe, expect, test } from "bun:test";
import { DEFAULT_PROMPT_CONFIG } from "./config.ts";
import { createPromptRuntime } from "./runtime.ts";

describe("createPromptRuntime", () => {
	test("starts enabled with the default config", () => {
		const runtime = createPromptRuntime();
		expect(runtime.getConfig()).toEqual(DEFAULT_PROMPT_CONFIG);
		expect(runtime.isEnabled()).toBe(true);
	});

	test("a disabled config turns refinement off", () => {
		const runtime = createPromptRuntime();
		runtime.setConfig({ ...DEFAULT_PROMPT_CONFIG, enabled: false });
		expect(runtime.isEnabled()).toBe(false);
	});

	test("the session override wins until the config is replaced", () => {
		const runtime = createPromptRuntime();
		runtime.setEnabled(false);
		expect(runtime.isEnabled()).toBe(false);
		runtime.setEnabled(true);
		expect(runtime.isEnabled()).toBe(true);

		// Replacing the config (session_start) clears the override.
		runtime.setEnabled(false);
		runtime.setConfig({ ...DEFAULT_PROMPT_CONFIG, enabled: true });
		expect(runtime.isEnabled()).toBe(true);
	});

	test("the busy guard admits one refinement at a time", () => {
		const runtime = createPromptRuntime();
		expect(runtime.isBusy()).toBe(false);
		expect(runtime.begin()).toBe(true);
		expect(runtime.isBusy()).toBe(true);
		expect(runtime.begin()).toBe(false);
		runtime.end();
		expect(runtime.isBusy()).toBe(false);
		expect(runtime.begin()).toBe(true);
	});
});
