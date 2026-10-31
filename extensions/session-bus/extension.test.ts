import { afterAll, describe, expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import sessionBus from "./index.ts";
import { createSessionBus, type SessionBus } from "./runtime.ts";
import { createBusStore } from "./store.ts";
import { ENV_DISABLED_EXTENSIONS } from "../../lib/env.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { scratchDir } from "../../test/helpers/env.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { createFakePi, emit, emitFirst, fakeTheme } from "../../test/helpers/fakes.ts";
import { withEnv } from "../../test/helpers/env.ts";
import { type JoinResult, TEAM_JOIN_REQUEST } from "../../lib/session-tool.ts";
import { waitFor } from "../../test/helpers/process.ts";
import { onRailsSuppressed } from "../../lib/rails.ts";
import { SessionListComponent } from "./view/session-list.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** A named session is a joined one: starting the bus puts nobody on it. */
async function joined(bus: SessionBus, ctx: ExtensionContext, label: string): Promise<void> {
	await bus.start(ctx);
	await bus.join({ label, listen: false });
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

describe("a board's join request", () => {
	test("joins the session as the label it asked for, and leaves Pi's name alone", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const { pi, bus, ctx } = setup(dir);
		await emit(pi, "session_start", { type: "session_start" }, ctx);
		const answered = new Promise<JoinResult>((resolve) => {
			pi.events.emit(TEAM_JOIN_REQUEST, { ctx, input: { label: "team-agent-s1" }, respond: resolve });
		});
		expect(await answered).toEqual({ ok: true, label: "team-agent-s1", watching: { armed: true, wake: false } });
		// A join is membership, not a rename: Pi's name stays, and only the bar's label moves.
		expect(pi.getSessionName()).toBeUndefined();
		expect((await bus.status()).onBus).toBe(true);
		await bus.stop();
	});

	test("names Pi's session too when the caller asks for it", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const { pi, bus, ctx } = setup(dir);
		await emit(pi, "session_start", { type: "session_start" }, ctx);
		const answered = new Promise<JoinResult>((resolve) => {
			pi.events.emit(TEAM_JOIN_REQUEST, { ctx, input: { label: "billing-core", name: true }, respond: resolve });
		});
		expect(await answered).toEqual({ ok: true, label: "billing-core", watching: { armed: true, wake: false } });
		// `/team join <label>` is the one door that means "call me this from now on".
		expect(pi.getSessionName()).toBe("billing-core");
		await bus.stop();
	});

	test("answers a failure rather than leaving the board waiting", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const { pi, bus, ctx } = setup(dir);
		await emit(pi, "session_start", { type: "session_start" }, ctx);
		// A label another live session holds is refused, and the refusal is the answer.
		const peer = createSessionBus({} as ExtensionAPI, { dir, now: () => 1_000, heartbeatMs: 0, watchMs: 0 });
		const peerCtx = fakeCtx({ cwd: "/repo", sessionId: "s2", sessionName: "taken" }).ctx as ExtensionContext;
		await peer.start(peerCtx);
		await peer.join({ label: "taken", listen: false });
		const answered = new Promise<JoinResult>((resolve) => {
			pi.events.emit(TEAM_JOIN_REQUEST, { ctx, input: { label: "taken" }, respond: resolve });
		});
		const result = await answered;
		expect(result.ok).toBe(false);
		expect(pi.getSessionName()).toBeUndefined();
		await peer.stop();
		await bus.stop();
	});
});

describe("session-bus extension", () => {
	test("registers a tool and a command", () => {
		const { tools, commands } = setup(scratchDir(temps, "pi-session-bus-"));
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

	test("session_start alone lists nobody; joining puts this session on, and shutdown leaves", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const { pi, bus, ctx } = setup(dir);
		await emit(pi, "session_start", { type: "session_start" }, ctx);
		const store = createBusStore({ dir });
		// A terminal session is not on the bus because it started.
		expect(await store.sessions()).toEqual([]);
		await bus.join({ label: "frontend", listen: false });
		expect((await store.sessions()).map((session) => session.label)).toEqual(["frontend"]);
		await emit(pi, "session_shutdown", { type: "session_shutdown" }, ctx);
		expect(await store.sessions()).toEqual([]);
	});

	test("prints the listing outside the TUI, where reading is not joining", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const { pi, bus, ctx, notices, command } = setup(dir);
		if (!command) throw new Error("sessions command not registered");
		await bus.start(ctx);
		// Outside the TUI there is no dock, so the command prints the listing, and
		// reading is not joining: it lists a bus this session is not on.
		ctx.mode = "json";
		await command.handler("", ctx);
		expect(notices.at(-1)?.message).toContain("Sessions (0)");
		expect(notices.at(-1)?.message).toContain("not on the bus yet");
		// One act, no arguments: a stale `/sessions join backend` opens the same board
		// and joins nothing, so neither the bus nor Pi's session name moves.
		await command.handler("join backend", ctx);
		expect(notices.at(-1)?.message).toContain("Sessions (0)");
		expect(pi.getSessionName()).toBeUndefined();
		expect((await bus.status()).onBus).toBe(false);
		await bus.stop();
	});

	test("opens the bus board in the TUI and restores the rails", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const { pi, bus, ctx, command } = setup(dir);
		if (!command) throw new Error("sessions command not registered");
		await joined(bus, ctx, "frontend");

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

	test("a fresh session joins from the board's w", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const { pi, bus, ctx, command } = setup(dir);
		if (!command) throw new Error("sessions command not registered");

		let mounted: SessionListComponent | undefined;
		ctx.ui.custom = async (factory: any) => {
			mounted = factory({ requestRender: () => {}, terminal: { rows: 24 } }, fakeTheme, {}, () => {});
		};
		onRailsSuppressed(pi, () => {});
		await command.handler("", ctx);
		if (!mounted) throw new Error("the board did not mount");
		// Opening the board is a read: the bus it draws lists nobody, itself included.
		expect(mounted.render(80).join("\n")).toContain("No sessions on this bus yet. Press w to join and listen.");
		expect(await createBusStore({ dir }).sessions()).toEqual([]);

		// `w` is the one act the board offers that also joins, so it is how a TUI
		// session gets on the bus without a tool call.
		mounted.handleInput("w");
		await waitFor(() => mounted?.render(80).join("\n").includes('On the bus as "frontend", listening') ?? false);
		expect((await createBusStore({ dir }).sessions()).map((session) => session.label)).toEqual(["frontend"]);
		await bus.stop();
	});

	test("reads unread mail and releases its own claim from the board", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
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
		await waitFor(() => mounted?.render(80).join("\n").includes("Released src/api.") ?? false);

		expect(await createBusStore({ dir }).claims()).toEqual([]);
		expect(mounted.render(80).join("\n")).toContain("Released src/api.");
		await peer.stop();
		await bus.stop();
	});

	test("an armed wake raises exactly one turn for new mail", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
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

		await bus.join({ wake: true });
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
		const dir = scratchDir(temps, "pi-session-bus-");
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

		await bus.join({});
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

	test("a wake that arrives mid-turn raises one turn once the run settles", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
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
		await bus.join({ wake: true });

		await emit(pi, "agent_start", {}, ctx);
		await peer.send({ to: "frontend", text: "mid-turn" });
		await bus.poll();
		expect(customMessages).toEqual([]);
		expect(bus.pending()).toHaveLength(1);

		await emit(pi, "agent_settled", { aborted: false }, ctx);
		expect(customMessages).toHaveLength(1);
		expect(customMessages[0]?.options).toEqual({ triggerTurn: true });
		expect(customMessages[0]?.message.content).toContain("mid-turn");
		// The settle retry already reported it, so the next turn adds nothing.
		expect(await emitFirst(pi, "before_agent_start", {}, ctx)).toBeUndefined();
		// Announcing never consumes: only `inbox` deletes.
		expect(await bus.inbox()).toHaveLength(1);

		await peer.stop();
		await emit(pi, "session_shutdown", { type: "session_shutdown" }, ctx);
	});

	test("an aborted run leaves the inbox wake for the next turn", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const { pi, bus, ctx, customMessages } = setup(dir);
		const peer = createSessionBus({} as ExtensionAPI, {
			dir,
			repo: { root: "/repo", key: "shared" },
			now: () => 1_000,
			heartbeatMs: 0,
			watchMs: 0,
		});
		const peerCtx = fakeCtx({ cwd: "/repo", sessionId: "s7", sessionName: "integrator" }).ctx as ExtensionContext;
		await emit(pi, "session_start", { type: "session_start" }, ctx);
		await peer.start(peerCtx);
		await bus.join({ wake: true });

		await emit(pi, "agent_start", {}, ctx);
		await peer.send({ to: "frontend", text: "after the abort" });
		await bus.poll();
		await emit(pi, "agent_settled", { aborted: true }, ctx);
		expect(customMessages).toEqual([]);
		// The interruption leaves the burst queued rather than consuming it.
		expect(bus.pending()).toHaveLength(1);

		const reported = await emitFirst(pi, "before_agent_start", {}, ctx);
		expect(reported?.message.content).toContain("after the abort");

		await peer.stop();
		await emit(pi, "session_shutdown", { type: "session_shutdown" }, ctx);
	});

	test("arming mid-turn wakes for mail already waiting once the run settles", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const { pi, bus, ctx, customMessages } = setup(dir);
		const peer = createSessionBus({} as ExtensionAPI, {
			dir,
			repo: { root: "/repo", key: "shared" },
			now: () => 1_000,
			heartbeatMs: 0,
			watchMs: 0,
		});
		const peerCtx = fakeCtx({ cwd: "/repo", sessionId: "s5", sessionName: "integrator" }).ctx as ExtensionContext;
		await emit(pi, "session_start", { type: "session_start" }, ctx);
		await bus.join({ label: "frontend", listen: false });
		await peer.start(peerCtx);
		await peer.join({ label: "integrator", listen: false });
		await peer.send({ to: "frontend", text: "already here" });

		// The tool call that arms the watch always runs inside a turn.
		await emit(pi, "agent_start", {}, ctx);
		await bus.join({ wake: true });
		expect(customMessages).toEqual([]);

		await emit(pi, "agent_settled", { aborted: false }, ctx);
		expect(customMessages).toHaveLength(1);
		expect(customMessages[0]?.options).toEqual({ triggerTurn: true });
		expect(customMessages[0]?.message.content).toContain("already here");

		await peer.stop();
		await emit(pi, "session_shutdown", { type: "session_shutdown" }, ctx);
	});

	test("a plain armed watch waits for the next turn after a settle", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const { pi, bus, ctx, customMessages } = setup(dir);
		const peer = createSessionBus({} as ExtensionAPI, {
			dir,
			repo: { root: "/repo", key: "shared" },
			now: () => 1_000,
			heartbeatMs: 0,
			watchMs: 0,
		});
		const peerCtx = fakeCtx({ cwd: "/repo", sessionId: "s6", sessionName: "integrator" }).ctx as ExtensionContext;
		await emit(pi, "session_start", { type: "session_start" }, ctx);
		await peer.start(peerCtx);
		await bus.join({});

		await emit(pi, "agent_start", {}, ctx);
		await peer.send({ to: "frontend", text: "next turn" });
		await bus.poll();
		await emit(pi, "agent_settled", { aborted: false }, ctx);
		expect(customMessages).toEqual([]);

		const reported = await emitFirst(pi, "before_agent_start", {}, ctx);
		expect(reported?.message.content).toContain("next turn");

		await peer.stop();
		await emit(pi, "session_shutdown", { type: "session_shutdown" }, ctx);
	});
});
