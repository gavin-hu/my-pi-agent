import { describe, expect, test } from "bun:test";
import { GLYPHS, STATUS_KEYS } from "../../lib/ui.ts";
import { settle } from "../../test/helpers/process.ts";
import { makeHarness } from "../../test/helpers/fixtures/keep-awake.ts";

describe("auto mode", () => {
	test("holds no inhibitor until the agent starts", () => {
		const { runtime, ctx } = makeHarness();
		runtime.start(ctx);
		expect(runtime.status().active).toBe(false);
		expect(ctx.statuses.has(STATUS_KEYS.keepAwake)).toBe(false);
	});

	test("acquires while the agent runs and releases when it settles", () => {
		const { runtime, ctx, children, kills } = makeHarness();
		runtime.start(ctx);

		runtime.agentStart(ctx);
		expect(children).toHaveLength(1);
		expect(children[0]?.command).toBe("caffeinate -i -w 4242");
		expect(ctx.statuses.get(STATUS_KEYS.keepAwake)).toBe(`${GLYPHS.keepAwake} auto`);

		runtime.agentSettled(ctx);
		expect(kills).toHaveLength(1);
		expect(runtime.status().active).toBe(false);
		expect(ctx.statuses.has(STATUS_KEYS.keepAwake)).toBe(false);
	});
});

describe("always mode", () => {
	test("acquires on session start and releases on shutdown", () => {
		const { runtime, ctx, children, kills } = makeHarness({ config: { mode: "always" } });
		runtime.start(ctx);
		expect(children).toHaveLength(1);
		expect(ctx.statuses.get(STATUS_KEYS.keepAwake)).toBe(`${GLYPHS.keepAwake} always`);

		runtime.stop(ctx);
		expect(kills).toHaveLength(1);
		expect(runtime.status().active).toBe(false);
	});

	test("stop is idempotent", () => {
		const { runtime, ctx, kills } = makeHarness({ config: { mode: "always" } });
		runtime.start(ctx);
		runtime.stop(ctx);
		runtime.stop(ctx);
		expect(kills).toHaveLength(1);
	});
});

describe("overrides", () => {
	test("off prevents the inhibitor even in always mode", () => {
		const { runtime, ctx, children } = makeHarness({ config: { mode: "always" } });
		runtime.start(ctx);
		runtime.setOverride("off", ctx);
		expect(children).toHaveLength(1);
		expect(runtime.status().active).toBe(false);
		expect(runtime.status().override).toBe("off");
	});

	test("on forces the inhibitor while idle, and auto releases it", () => {
		const { runtime, ctx, children, kills } = makeHarness();
		runtime.start(ctx);

		runtime.setOverride("on", ctx);
		expect(children).toHaveLength(1);
		expect(ctx.statuses.get(STATUS_KEYS.keepAwake)).toBe(`${GLYPHS.keepAwake} on`);

		runtime.setOverride(undefined, ctx);
		expect(kills).toHaveLength(1);
		expect(runtime.status().active).toBe(false);
		expect(runtime.status().override).toBeUndefined();
	});

	test("session start clears a previous override", () => {
		const { runtime, ctx } = makeHarness();
		runtime.setOverride("on", ctx);
		runtime.start(ctx);
		expect(runtime.status().override).toBeUndefined();
	});
});

describe("failures", () => {
	test("a spawn error is recorded and not retried", async () => {
		const { runtime, ctx, children } = makeHarness({
			script: (child) => child.emit("error", new Error("spawn systemd-inhibit ENOENT")),
		});
		runtime.start(ctx);
		runtime.agentStart(ctx);
		await settle();

		expect(runtime.status().active).toBe(false);
		expect(runtime.status().unavailable).toBe("spawn systemd-inhibit ENOENT");
		expect(ctx.statuses.has(STATUS_KEYS.keepAwake)).toBe(false);

		runtime.agentSettled(ctx);
		runtime.agentStart(ctx);
		expect(children).toHaveLength(1);
	});

	test("an unsupported platform is unavailable and holds nothing", () => {
		const { runtime, ctx, children } = makeHarness({ platform: "freebsd", config: { mode: "always" } });
		runtime.start(ctx);
		expect(children).toHaveLength(0);
		expect(runtime.status().unavailable).toBe("no keep-awake command for freebsd");
	});

	test("an inhibitor that exits on its own clears the chip and is not retried", async () => {
		const { runtime, ctx, children } = makeHarness({ script: (child) => child.close(0) });
		runtime.start(ctx);
		runtime.agentStart(ctx);
		expect(runtime.status().active).toBe(true);
		await settle();

		expect(runtime.status().active).toBe(false);
		expect(runtime.status().unavailable).toBe("keep-awake inhibitor exited unexpectedly (code 0)");
		expect(ctx.statuses.has(STATUS_KEYS.keepAwake)).toBe(false);

		runtime.agentSettled(ctx);
		runtime.agentStart(ctx);
		expect(children).toHaveLength(1);
	});
});
