/**
 * The send request a command context makes, answered.
 *
 * A command can sign a card but cannot call a tool, so `/board approve` asks here instead:
 * the bus starts through the caller's context, `bus.send` writes the mail the tool would
 * have written, and `sendOutcome` says what it was worth. These cases pin the four answers
 * a caller reads — delivered, delivered-to-some, delivered-to-nobody, and refused — and the
 * one thing a request with no answer must not do, which is start a bus.
 */

import { afterAll, describe, expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	type SendInput,
	type SendResult,
	SESSION_SEND_REQUEST,
	type SessionSendRequest,
} from "../../lib/session-tool.ts";
import { blockInbox } from "../../test/helpers/bus.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { scratchDir } from "../../test/helpers/env.ts";
import { createFakePi } from "../../test/helpers/fakes.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { createSessionBus, type SessionBus } from "./runtime.ts";
import { registerSendRequests } from "./send-request.ts";
import { createBusStore } from "./store.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** One session on a shared bus, holding the context a command has rather than a tool's. */
function commandSession(dir: string, id: string, label: string): { bus: SessionBus; pi: any; ctx: ExtensionContext } {
	const bus = createSessionBus({} as ExtensionAPI, {
		dir,
		repo: { root: "/repo", key: "shared" },
		now: () => 1_000,
		heartbeatMs: 0,
	});
	const fake = createFakePi();
	registerSendRequests(fake.pi, bus);
	// `executeTool` destructured away: that field is the whole difference between a command's
	// context and a tool's, so a case that kept it would prove the wrong transport.
	const { executeTool: _executeTool, ...ctx } = fakeCtx({ cwd: "/repo", sessionId: id, sessionName: label }).ctx;
	return { bus, pi: fake.pi, ctx: ctx as ExtensionContext };
}

/** A peer that is on the bus under a label, so a send has somewhere to land. */
async function peerOn(dir: string, id: string, label: string) {
	const peer = commandSession(dir, id, label);
	await peer.bus.start(peer.ctx);
	await peer.bus.join({ label, listen: false });
	return peer;
}

/** Ask the bus to send, the way `lib/session-tool.ts` asks for a command context. */
function ask(pi: any, ctx: ExtensionContext, input: SendInput): Promise<SendResult> {
	return new Promise<SendResult>((resolve) => {
		const request: SessionSendRequest = { ctx, input, respond: resolve };
		pi.events.emit(SESSION_SEND_REQUEST, request);
	});
}

describe("a send request", () => {
	test("writes the message into the peer's inbox and reports the label it wrote for", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const sender = commandSession(dir, "s1", "team-lead");
		const peer = await peerOn(dir, "s2", "api-core");

		expect(await ask(sender.pi, sender.ctx, { kind: "event", to: "api-core", text: "#4 approved" })).toEqual({
			ok: true,
			delivered: ["api-core"],
			failed: [],
		});
		// The owner really holds it: the answer is not a claim the mail does not back.
		const read = await createBusStore({ dir }).inbox("s2", 10);
		expect(read.messages.map((message) => [message.fromLabel, message.kind, message.text])).toEqual([
			["team-lead", "event", "#4 approved"],
		]);

		await sender.bus.stop();
		await peer.bus.stop();
	});

	test("a fan-out names the peer it could not write for, and keeps the message for the rest", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const sender = commandSession(dir, "s1", "team-lead");
		const reachable = await peerOn(dir, "s2", "api-core");
		const blocked = await peerOn(dir, "s3", "api-web");
		blockInbox(dir, "s3");

		const result = await ask(sender.pi, sender.ctx, { kind: "event", to: "*", text: "signed" });
		expect(result.ok).toBe(true);
		expect(result.ok && result.delivered).toEqual(["api-core"]);
		expect(result.ok && result.failed.map((entry) => entry.label)).toEqual(["api-web"]);

		await sender.bus.stop();
		await reachable.bus.stop();
		await blocked.bus.stop();
	});

	test("reaching nobody is a refusal, so a caller never reads it as told", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const sender = commandSession(dir, "s1", "team-lead");
		const blocked = await peerOn(dir, "s2", "api-core");
		blockInbox(dir, "s2");

		const result = await ask(sender.pi, sender.ctx, { kind: "event", to: "api-core", text: "signed" });
		expect(result.ok).toBe(false);
		expect(result.ok === false && result.error).toContain("Not delivered to api-core");

		await sender.bus.stop();
		await blocked.bus.stop();
	});

	test("a send the bus refuses is its sentence, not a rejection", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const sender = commandSession(dir, "s1", "team-lead");
		expect(await ask(sender.pi, sender.ctx, { kind: "event", to: "", text: "signed" })).toEqual({
			ok: false,
			error: "to is required.",
		});
		await sender.bus.stop();
	});

	test("a request with nobody to answer claims nothing, and starts no bus", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const sender = commandSession(dir, "s1", "team-lead");
		// The answer is a function the payload carries; a payload without one is not a request.
		sender.pi.events.emit(SESSION_SEND_REQUEST, undefined);
		sender.pi.events.emit(SESSION_SEND_REQUEST, { input: { kind: "event", to: "*", text: "signed" } });
		expect(await createBusStore({ dir }).sessions()).toEqual([]);
	});
});
