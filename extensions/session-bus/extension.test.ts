import { afterAll, describe, expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import sessionBus from "./index.ts";
import { createSessionBus } from "./runtime.ts";
import { createBusStore } from "./store.ts";
import { ENV_DISABLED_EXTENSIONS } from "../../lib/env.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { tempDir } from "../../test/helpers/env.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { createFakePi, emit, emitFirst, fakeTheme } from "../../test/helpers/fakes.ts";
import { withEnv } from "../../test/helpers/env.ts";
import { settle } from "../../test/helpers/process.ts";
import { onRailsSuppressed } from "../../lib/rails.ts";
import { SessionListComponent } from "./tui.ts";

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
		watchMs: 0,
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
		const { pi, bus, ctx, notices, command } = setup(dir);
		if (!command) throw new Error("sessions command not registered");
		await bus.start(ctx);
		// Outside the TUI there is no dock, so the command prints the listing.
		ctx.mode = "json";
		await command.handler("", ctx);
		expect(notices.at(-1)?.message).toContain("Sessions (1)");
		await command.handler("name backend", ctx);
		expect(notices.at(-1)?.message).toContain("backend");
		// The label is also Pi's session name, so the footer and /resume agree.
		expect(pi.getSessionName()).toBe("backend");
		await command.handler("name", ctx);
		expect(notices.at(-1)?.message).toContain("Usage:");
		await command.handler("nope", ctx);
		expect(notices.at(-1)?.message).toContain("Unknown sessions command");
		await bus.stop();
	});

	test("a rejected name leaves Pi's session name alone", async () => {
		const dir = busDir();
		const { pi, bus, ctx, notices, command } = setup(dir);
		if (!command) throw new Error("sessions command not registered");
		await bus.start(ctx);

		const peer = createSessionBus({} as ExtensionAPI, {
			dir,
			repo: { root: "/repo", key: "shared" },
			now: () => 1_000,
			heartbeatMs: 0,
			watchMs: 0,
		});
		const peerCtx = fakeCtx({ cwd: "/repo", sessionId: "s2", sessionName: "taken" }).ctx as ExtensionContext;
		await peer.start(peerCtx);

		await command.handler("name taken", ctx);
		expect(notices.at(-1)?.message).toContain("already in use");
		expect(pi.getSessionName()).toBeUndefined();
		await peer.stop();
		await bus.stop();
	});

	test("opens the bus board in the TUI and restores the rails", async () => {
		const dir = busDir();
		const { pi, bus, ctx, command } = setup(dir);
		if (!command) throw new Error("sessions command not registered");
		await bus.start(ctx);

		let mounted: SessionListComponent | undefined;
		ctx.ui.custom = async (factory: any) => {
			mounted = factory({ requestRender: () => {}, terminal: { rows: 24 } }, fakeTheme, {}, () => {});
		};
		const suppressed: boolean[] = [];
		onRailsSuppressed(pi, (value) => suppressed.push(value));

		await command.handler("", ctx);
		expect(mounted).toBeInstanceOf(SessionListComponent);
		expect(mounted?.render(80).join("\n")).toContain("frontend · you");
		expect(suppressed).toEqual([true, false]);
		await bus.stop();
	});

	test("reads unread mail and releases its own claim from the board", async () => {
		const dir = busDir();
		const { pi, bus, ctx, command } = setup(dir);
		if (!command) throw new Error("sessions command not registered");
		await bus.start(ctx);
		await bus.claim(["src/api"]);

		const peer = createSessionBus({} as ExtensionAPI, {
			dir,
			repo: { root: "/repo", key: "shared" },
			now: () => 1_000,
			heartbeatMs: 0,
			watchMs: 0,
		});
		const peerCtx = fakeCtx({ cwd: "/repo", sessionId: "s2", sessionName: "integrator" }).ctx as ExtensionContext;
		await peer.start(peerCtx);
		await peer.send({ to: "frontend", text: "contract v2 landed" });

		let mounted: SessionListComponent | undefined;
		ctx.ui.custom = async (factory: any) => {
			mounted = factory({ requestRender: () => {}, terminal: { rows: 24 } }, fakeTheme, {}, () => {});
		};
		onRailsSuppressed(pi, () => {});
		await command.handler("", ctx);
		if (!mounted) throw new Error("the board did not mount");

		mounted.handleInput("\t");
		expect(mounted.render(80).join("\n")).toContain("contract v2 landed");
		mounted.handleInput("\r");
		expect(mounted.render(80).join("\n")).toContain("integrator · message");
		mounted.handleInput("\x1b");
		mounted.handleInput("\t");
		mounted.handleInput("x");
		expect(mounted.render(80).join("\n")).toContain("Release src/api? y/N");
		mounted.handleInput("y");
		await settle();

		expect(await createBusStore({ dir }).claims()).toEqual([]);
		expect(mounted.render(80).join("\n")).toContain("Released src/api.");
		await peer.stop();
		await bus.stop();
	});

	test("arms and disarms the inbox watch through /sessions watch", async () => {
		const dir = busDir();
		const { bus, ctx, notices, command } = setup(dir);
		if (!command) throw new Error("sessions command not registered");
		await bus.start(ctx);
		await command.handler("watch", ctx);
		expect(notices.at(-1)?.message).toContain('Inbox watch on for "frontend"');
		expect((await bus.status()).watching).toEqual({ armed: true, wake: false });
		await command.handler("watch wake", ctx);
		expect(notices.at(-1)?.message).toContain("Inbox watch on");
		await command.handler("watch advanced", ctx);
		expect(notices.at(-1)?.message).toContain("Unknown watch mode");
		await command.handler("watch off", ctx);
		expect(notices.at(-1)?.message).toContain("Inbox watch off");
		expect((await bus.status()).watching).toBeUndefined();
		await bus.stop();
	});

	test("an armed wake raises exactly one turn for new mail", async () => {
		const dir = busDir();
		const { pi, bus, ctx, customMessages } = setup(dir);
		const peer = createSessionBus({} as ExtensionAPI, {
			dir,
			repo: { root: "/repo", key: "shared" },
			now: () => 1_000,
			heartbeatMs: 0,
			watchMs: 0,
		});
		const peerCtx = fakeCtx({ cwd: "/repo", sessionId: "s2", sessionName: "integrator" }).ctx as ExtensionContext;
		await emit(pi, "session_start", { type: "session_start" }, ctx);
		await peer.start(peerCtx);

		await bus.watch({ wake: true });
		await peer.send({ to: "frontend", text: "contract v2 merged" });
		await bus.poll();

		expect(customMessages).toHaveLength(1);
		expect(customMessages[0]?.options).toEqual({ triggerTurn: true });
		const notice = customMessages[0]?.message;
		expect(notice?.details.source).toBe("session-bus");
		expect(notice?.content).toContain("[SESSION BUS]");
		expect(notice?.content).toContain("integrator · message · contract v2 merged");

		// The waking run's own turn start adds nothing: the notice was already reported.
		await bus.poll();
		expect(customMessages).toHaveLength(1);
		expect(await emitFirst(pi, "before_agent_start", {}, ctx)).toBeUndefined();

		await peer.stop();
		await emit(pi, "session_shutdown", { type: "session_shutdown" }, ctx);
		expect(bus.pending()).toEqual([]);
	});

	test("without wake the notice waits for the next turn, and arrives once", async () => {
		const dir = busDir();
		const { pi, bus, ctx, customMessages } = setup(dir);
		const peer = createSessionBus({} as ExtensionAPI, {
			dir,
			repo: { root: "/repo", key: "shared" },
			now: () => 1_000,
			heartbeatMs: 0,
			watchMs: 0,
		});
		const peerCtx = fakeCtx({ cwd: "/repo", sessionId: "s3", sessionName: "verify-billing" }).ctx as ExtensionContext;
		await emit(pi, "session_start", { type: "session_start" }, ctx);
		await peer.start(peerCtx);

		await bus.watch({});
		await peer.send({ to: "frontend", kind: "ask", text: "is checkout.ts free?" });
		await bus.poll();
		expect(customMessages).toEqual([]);

		const first = await emitFirst(pi, "before_agent_start", {}, ctx);
		expect(first?.message.content).toContain("verify-billing · ask · is checkout.ts free?");
		expect(first?.message.content).toContain("Run `session inbox` to read and consume them.");
		expect(await emitFirst(pi, "before_agent_start", {}, ctx)).toBeUndefined();

		// The mail is still on disk: only `inbox` consumes it.
		expect(await bus.inbox()).toHaveLength(1);
		await peer.stop();
		await emit(pi, "session_shutdown", { type: "session_shutdown" }, ctx);
	});

	test("a run in progress queues the wake instead of interrupting it", async () => {
		const dir = busDir();
		const { pi, bus, ctx, customMessages } = setup(dir);
		const peer = createSessionBus({} as ExtensionAPI, {
			dir,
			repo: { root: "/repo", key: "shared" },
			now: () => 1_000,
			heartbeatMs: 0,
			watchMs: 0,
		});
		const peerCtx = fakeCtx({ cwd: "/repo", sessionId: "s4", sessionName: "integrator" }).ctx as ExtensionContext;
		await emit(pi, "session_start", { type: "session_start" }, ctx);
		await peer.start(peerCtx);
		await bus.watch({ wake: true });

		await emit(pi, "agent_start", {}, ctx);
		await peer.send({ to: "frontend", text: "mid-turn" });
		await bus.poll();
		expect(customMessages).toEqual([]);

		await emit(pi, "agent_settled", {}, ctx);
		await bus.poll();
		expect(customMessages).toEqual([]);
		const reported = await emitFirst(pi, "before_agent_start", {}, ctx);
		expect(reported?.message.content).toContain("mid-turn");

		await peer.stop();
		await emit(pi, "session_shutdown", { type: "session_shutdown" }, ctx);
	});
});
