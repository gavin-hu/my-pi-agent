import { describe, expect, test } from "bun:test";
import { fakeCtx } from "../../test/helpers/context.ts";
import { makeFakePi } from "../../test/helpers/fakes.ts";
import { registerCommands } from "./commands.ts";
import { createPromptRuntime } from "./runtime.ts";

function setup(): {
	runtime: ReturnType<typeof createPromptRuntime>;
	handler: (args: string, ctx: unknown) => Promise<void>;
} {
	const { pi, commands } = makeFakePi();
	const runtime = createPromptRuntime();
	registerCommands(pi, runtime);
	const command = commands.get("prompt");
	if (!command) throw new Error("missing /prompt command");
	return { runtime, handler: command.handler };
}

describe("registerCommands", () => {
	test("registers the /prompt command", () => {
		const { handler } = setup();
		expect(typeof handler).toBe("function");
	});

	test("bare and help calls show usage and state", async () => {
		const { handler } = setup();
		const { ctx, notifications } = fakeCtx({});

		await handler("", ctx);
		expect(notifications.at(-1)).toContain("Usage: /prompt refine");
		expect(notifications.at(-1)).toContain("Prompt refinement is on");

		await handler("help", ctx);
		expect(notifications.at(-1)).toContain("Usage: /prompt refine");
	});

	test("refine status reports the current state and config", async () => {
		const { handler } = setup();
		const { ctx, notifications } = fakeCtx({});

		await handler("refine", ctx);
		expect(notifications.at(-1)).toContain("up to 3 questions");

		await handler("refine status", ctx);
		expect(notifications.at(-1)).toContain("20+ characters");
	});

	test("refine on and off flip the session override", async () => {
		const { handler, runtime } = setup();
		const { ctx, notifications } = fakeCtx({});

		await handler("refine off", ctx);
		expect(runtime.isEnabled()).toBe(false);
		expect(notifications.at(-1)).toBe("Prompt refinement off.");

		await handler("refine on", ctx);
		expect(runtime.isEnabled()).toBe(true);
		expect(notifications.at(-1)).toBe("Prompt refinement on.");
	});

	test("rejects unknown subcommands and arguments", async () => {
		const { handler } = setup();
		const { ctx, notices } = fakeCtx({});

		await handler("nope", ctx);
		expect(notices.at(-1)?.kind).toBe("warning");
		expect(notices.at(-1)?.message).toContain("Unknown subcommand");

		await handler("refine sideways", ctx);
		expect(notices.at(-1)?.kind).toBe("warning");
		expect(notices.at(-1)?.message).toContain("Unknown argument");
	});
});
