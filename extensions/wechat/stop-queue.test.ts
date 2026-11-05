/**
 * `/stop` is the chat's whole brake: it ends the running turn and drops the
 * messages queued behind it, and both surfaces say how many went. The worker's
 * `drain` and the `/stop` reply, the bridge's one outcome for the chat command and
 * the terminal's `s` key, and the doc's contract are all proved here so the three
 * suites beside it keep their heights.
 */

import { describe, expect, test } from "bun:test";
import { fakeCtx } from "../../test/helpers/context.ts";
import { createFakePi, fakeTheme } from "../../test/helpers/fakes.ts";
import { commandHarness } from "../../test/helpers/fixtures/wechat.ts";
import { controllableClient, inbound, makeDeps } from "../../test/helpers/fixtures/wechat-bridge.ts";
import { settle, waitFor } from "../../test/helpers/process.ts";
import { createBridge } from "./bridge.ts";
import { type CommandDeps, registerCommands } from "./commands/commands.ts";
import { createTurnRunner, type ChatItem } from "./conversation/turn.ts";
import type { ChatTurn } from "./host/chat.ts";

/** One inbound message, as the worker takes it. */
function item(text: string): ChatItem {
	return { peer: "owner@im.wechat", text, language: "en" };
}

/** A chat turn whose first prompt is held, so a test can act on the queue behind it. */
function heldTurn() {
	const prompts: string[] = [];
	let release: (() => void) | undefined;
	const chatTurn = {
		session: {
			subscribe: () => () => {},
			async prompt(text: string): Promise<void> {
				prompts.push(text);
				if (prompts.length === 1) await new Promise<void>((resolve) => (release = resolve));
			},
			getLastAssistantText: () => "",
			async abort(): Promise<void> {
				release?.();
			},
		},
		dispose: async () => {},
	} as unknown as ChatTurn;
	return { chatTurn, prompts };
}

describe("the worker's queue", () => {
	test("drains what a stop leaves behind, and the dropped turns never run", async () => {
		const { chatTurn, prompts } = heldTurn();
		const sent: string[] = [];
		const worker = createTurnRunner({
			openChat: async () => chatTurn,
			send: async (_item, text) => {
				sent.push(text);
				return true;
			},
			fallback: (_item, reason) => `fallback:${reason}`,
			idleTimeoutMs: 0,
			armTimer: () => () => {},
		});
		worker.enqueue(item("first"));
		worker.enqueue(item("second"));
		worker.enqueue(item("third"));
		await settle();
		expect(worker.state()).toMatchObject({ status: "running", queued: 2 });

		expect(worker.abort()).toBe(true);
		expect(worker.drain()).toBe(2);
		await settle();
		await settle();

		expect(prompts).toEqual(["first"]);
		expect(sent).toEqual(["fallback:stopped"]);
		expect(worker.state()).toMatchObject({ status: "idle", queued: 0 });
		// Nothing is left to drop, and nothing is running.
		expect(worker.drain()).toBe(0);
		expect(worker.abort()).toBe(false);
	});
});

describe("the bridge's stop", () => {
	/** Open a bridge, hold its first turn, and queue two messages behind it. */
	async function queuedBridge() {
		const { client, sent, deliver } = controllableClient();
		const { deps, injected } = makeDeps(client, {}, { hold: true });
		const bridge = createBridge(deps);
		bridge.open();
		// The held first turn ("ping") runs; these two wait behind it, as a burst typed
		// during a bad answer does.
		await waitFor(() => injected.length === 1);
		deliver([inbound("first"), inbound("second")]);
		await waitFor(() => bridge.turnState().queued === 2);
		return { bridge, sent, deliver, injected };
	}

	test("a /stop takes the queue behind the turn it stopped", async () => {
		const { bridge, sent, deliver, injected } = await queuedBridge();
		deliver(inbound("/stop"));
		await waitFor(() => sent.some((message) => message.text === "Stopped."));

		// The chat's only brake brakes the burst too: those turns never run, and the peer
		// is told how many it took.
		expect(injected).toEqual(["ping"]);
		expect(sent.some((message) => message.text === "Dropped 2 queued message(s).")).toBe(true);
		await waitFor(() => bridge.turnState().status === "idle");
		expect(bridge.turnState()).toMatchObject({ status: "idle", queued: 0 });
		await bridge.close();
	});

	test("the terminal's stop reports the queue it dropped", async () => {
		const { bridge, injected } = await queuedBridge();
		// The screen's `s` key and the chat's `/stop` word one outcome.
		expect(bridge.stop()).toEqual({ stopped: true, dropped: 2 });
		await waitFor(() => bridge.turnState().status === "idle");
		expect(injected).toEqual(["ping"]);
		expect(bridge.stop()).toEqual({ stopped: false, dropped: 0 });
		await bridge.close();
	});
});

describe("the surfaces that word it", () => {
	test("the control screen's stop names the queue it took", async () => {
		const deps = commandHarness({ stop: true, dropped: 2 }).deps as CommandDeps;
		const fake = createFakePi();
		registerCommands(fake.pi, deps);
		const handler = fake.commands.get("wechat")?.handler;
		if (!handler) throw new Error("command not registered");

		const { ctx, customCalls } = fakeCtx({ custom: "close" });
		await handler("status", ctx);
		const screen = await customCalls[0]({ requestRender: () => {} }, fakeTheme, {}, () => {});
		screen.handleInput("s");
		// The screen already shows the queue, so its one line says what went with the stop.
		expect(screen.render(60).join("\n")).toContain("Dropped 2 queued message(s).");
	});
});
