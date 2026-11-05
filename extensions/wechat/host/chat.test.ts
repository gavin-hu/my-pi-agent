/**
 * The chat session's dialog takeover: while a WeChat turn runs, `ctx.ui`'s four
 * dialogs answer from the chat, and every way the turn ends puts the terminal's
 * own back.
 */

import { describe, expect, test } from "bun:test";
import {
	INTERACTION_TURN_KEY,
	type InteractionAnswer,
	isRemoteTurn,
	type InteractionRequest,
} from "../../../lib/interaction.ts";
import { settle } from "../../../test/helpers/process.ts";
import { type ChatTurn, type HostEventName, openChatTurn } from "./chat.ts";

function host() {
	const handlers = new Map<HostEventName, (payload: unknown) => void>();
	const sent: unknown[] = [];
	const aborted: string[] = [];
	/** What the terminal would answer, and whether it was asked. */
	const terminalCalls: string[] = [];
	let answer: InteractionAnswer = { kind: "confirmed", confirmed: true };
	const requests: InteractionRequest[] = [];
	let sendError: Error | undefined;

	const ui: Record<string, unknown> = {
		select: async (title: string) => {
			terminalCalls.push(`select:${title}`);
			return "terminal";
		},
		confirm: async (title: string) => {
			terminalCalls.push(`confirm:${title}`);
			return true;
		},
		input: async (title: string) => {
			terminalCalls.push(`input:${title}`);
			return "terminal";
		},
		editor: async (title: string) => {
			terminalCalls.push(`editor:${title}`);
			return "terminal";
		},
	};

	const turn: ChatTurn = openChatTurn("owner", {
		sendUserMessage: (content) => {
			if (sendError) throw sendError;
			sent.push(content);
		},
		isIdle: () => true,
		abortTurn: () => {
			aborted.push("turn");
		},
		ui,
		channel: () => ({
			isActive: () => true,
			request: async (request) => {
				requests.push(request);
				return answer;
			},
			post: async () => {},
			postFile: async () => true,
		}),
		subscribe: (event, handler) => {
			handlers.set(event, handler);
			return () => {
				handlers.delete(event);
			};
		},
	});

	return {
		turn,
		ui,
		sent,
		aborted,
		requests,
		terminalCalls,
		/** The dialog the terminal would be asked for, and what it would say. */
		ask: (title: string) => (ui.confirm as (title: string, message: string) => Promise<boolean>)(title, "body"),
		setAnswer: (value: InteractionAnswer) => {
			answer = value;
		},
		setSendError: (error: Error) => {
			sendError = error;
		},
		emit: (event: HostEventName, payload: unknown) => handlers.get(event)?.(payload),
	};
}

describe("a chat turn's dialogs", () => {
	test("the terminal answers before the turn starts", async () => {
		const h = host();
		expect(await h.ask("Go?")).toBe(true);
		expect(h.terminalCalls).toEqual(["confirm:Go?"]);
		expect(isRemoteTurn({ ui: h.ui })).toBe(false);
	});

	test("a turn in flight answers its dialogs from the chat", async () => {
		const h = host();
		const running = h.turn.session.prompt("hello");
		await settle();

		expect(isRemoteTurn({ ui: h.ui })).toBe(true);
		expect(h.sent).toEqual(["hello"]);
		expect(await h.ask("Enter plan mode?")).toBe(true);
		expect(h.requests).toEqual([{ kind: "confirm", title: "Enter plan mode?", message: "body" }]);
		expect(h.terminalCalls, "the terminal must not be asked").toEqual([]);

		h.emit("agent_settled", { aborted: false });
		await running;
		expect(isRemoteTurn({ ui: h.ui })).toBe(false);
		expect(h.ui[INTERACTION_TURN_KEY]).toBeUndefined();
	});

	test("the settle puts the terminal's dialogs back", async () => {
		const h = host();
		const running = h.turn.session.prompt("hello");
		await settle();
		h.emit("agent_settled", { aborted: false });
		await running;
		expect(await h.ask("Go?")).toBe(true);
		expect(h.terminalCalls).toEqual(["confirm:Go?"]);
	});

	test("an aborted run restores the dialogs and rejects the turn", async () => {
		const h = host();
		const running = h.turn.session.prompt("hello");
		await settle();
		h.emit("agent_settled", { aborted: true });
		await expect(running).rejects.toThrow("aborted");
		expect(isRemoteTurn({ ui: h.ui })).toBe(false);
		expect(await h.ask("Go?")).toBe(true);
		expect(h.terminalCalls).toEqual(["confirm:Go?"]);
	});

	test("a prompt the host refuses restores the dialogs", async () => {
		const h = host();
		h.setSendError(new Error("session busy"));
		const running = h.turn.session.prompt("hello");
		await expect(running).rejects.toThrow("session busy");
		expect(isRemoteTurn({ ui: h.ui })).toBe(false);
		expect(await h.ask("Go?")).toBe(true);
		expect(h.terminalCalls).toEqual(["confirm:Go?"]);
	});

	test("dispose restores the dialogs of the turn it abandons", async () => {
		const h = host();
		void h.turn.session.prompt("hello");
		await settle();
		expect(isRemoteTurn({ ui: h.ui })).toBe(true);
		await h.turn.dispose();
		expect(isRemoteTurn({ ui: h.ui })).toBe(false);
		expect(await h.ask("Go?")).toBe(true);
		expect(h.terminalCalls).toEqual(["confirm:Go?"]);
	});
});
