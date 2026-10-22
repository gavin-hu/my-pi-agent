import { afterAll, describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import sessionBus from "./index.ts";
import { createSessionBus } from "./runtime.ts";
import { createBusStore } from "./store.ts";
import { ENV_DISABLED_EXTENSIONS } from "../../lib/env.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { tempDir } from "../../test/helpers/env.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { createFakePi, emit } from "../../test/helpers/fakes.ts";
import { withEnv } from "../../test/helpers/env.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

function busDir(): string {
	return temps.track(tempDir("pi-session-bus-"));
}

function setup(dir: string) {
	const fake = createFakePi();
	const bus = createSessionBus({} as ExtensionAPI, {
		dir,
		repo: { root: "/repo", key: "shared" },
		now: () => 1_000,
		heartbeatMs: 0,
	});
	sessionBus(fake.pi, { bus });
	const { ctx, notices } = fakeCtx({ cwd: "/repo", sessionId: "s1", sessionName: "frontend" });
	return { ...fake, bus, ctx, notices, command: fake.commands.get("sessions") };
}

describe("session-bus extension", () => {
	test("registers a tool and a command", () => {
		const { tools, commands } = setup(busDir());
		expect(tools.has("session")).toBe(true);
		expect(commands.has("sessions")).toBe(true);
	});

	test("registers nothing when disabled", async () => {
		await withEnv({ [ENV_DISABLED_EXTENSIONS]: "session-bus" }, () => {
			const fake = createFakePi();
			sessionBus(fake.pi);
			expect(fake.tools.size).toBe(0);
			expect(fake.commands.size).toBe(0);
		});
	});

	test("joins on session_start and leaves on shutdown", async () => {
		const dir = busDir();
		const { pi, ctx } = setup(dir);
		await emit(pi, "session_start", { type: "session_start" }, ctx);
		const store = createBusStore({ dir });
		expect((await store.sessions()).map((session) => session.label)).toEqual(["frontend"]);
		await emit(pi, "session_shutdown", { type: "session_shutdown" }, ctx);
		expect(await store.sessions()).toEqual([]);
	});

	test("lists and names through /sessions", async () => {
		const dir = busDir();
		const { bus, ctx, notices, command } = setup(dir);
		if (!command) throw new Error("sessions command not registered");
		await bus.start(ctx);
		await command.handler("", ctx);
		expect(notices.at(-1)?.message).toContain("Sessions (1)");
		await command.handler("name backend", ctx);
		expect(notices.at(-1)?.message).toContain("backend");
		await command.handler("name", ctx);
		expect(notices.at(-1)?.message).toContain("Usage:");
		await command.handler("nope", ctx);
		expect(notices.at(-1)?.message).toContain("Unknown sessions command");
		await bus.stop();
	});
});
