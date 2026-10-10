import { describe, expect, test } from "bun:test";
import { makeFakePi } from "../../test/helpers/fakes.ts";
import { makeHarness } from "../../test/helpers/fixtures/keep-awake.ts";
import { registerCommands } from "./commands.ts";

function setup(config?: { mode: "auto" | "always" }) {
	const harness = makeHarness(config ? { config } : {});
	const { pi, commands } = makeFakePi();
	registerCommands(pi, harness.runtime);
	const handler = commands.get("keep-awake").handler as (args: string, ctx: unknown) => Promise<void>;
	return { ...harness, handler };
}

describe("keep-awake command", () => {
	test("registers the command", () => {
		const { pi, commands } = makeFakePi();
		registerCommands(pi, makeHarness().runtime);
		expect(commands.has("keep-awake")).toBe(true);
	});

	test("status reports the current state", async () => {
		const { handler, ctx, ctxFake } = setup();
		await handler("status", ctx);
		expect(ctxFake.notices[0]?.message).toContain("not holding the machine awake");
	});

	test("on forces the inhibitor", async () => {
		const { handler, ctx, ctxFake, children, runtime } = setup();
		runtime.start(ctx);
		await handler("on", ctx);
		expect(children).toHaveLength(1);
		expect(ctxFake.notices[0]?.message).toContain("will not sleep");
	});

	test("off releases and suppresses the inhibitor", async () => {
		const { handler, ctx, ctxFake, runtime, kills } = setup({ mode: "always" });
		runtime.start(ctx);
		await handler("off", ctx);
		expect(kills).toHaveLength(1);
		expect(runtime.status().override).toBe("off");
		expect(ctxFake.notices[0]?.message).toContain("may sleep");
	});

	test("auto clears the override", async () => {
		const { handler, ctx, runtime } = setup();
		await handler("on", ctx);
		await handler("auto", ctx);
		expect(runtime.status().override).toBeUndefined();
	});

	test("an unknown argument shows usage", async () => {
		const { handler, ctx, ctxFake } = setup();
		await handler("bogus", ctx);
		expect(ctxFake.notices[0]).toEqual({ message: "Usage: /keep-awake [on|off|auto|status]", kind: "warning" });
	});
});
