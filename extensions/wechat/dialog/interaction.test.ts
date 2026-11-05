/**
 * The chat's dialog channel, at its edges: a dialog that ends before its free
 * text is used, and a prompt the transport refuses to carry.
 *
 * Both are about the same promise — a prompt that reached nobody must not keep
 * answering for the peer — and both were leaks a peer could feel as silence. The
 * third case runs the promise the other way: the words a prompt showed are
 * answers, so a plan review's 退出 reaches it as a choice, not as a dismissal.
 */

import { describe, expect, test } from "bun:test";
import { INTERACTION_OTHER_LABEL } from "../../../lib/interaction.ts";
import { createWechatInteractionChannel, type WechatInteractionDeps } from "./interaction.ts";

const PEER = "alice@im.wechat";

/** The channel over recording senders; a case varies `active` or `send`. */
function channel(overrides: Partial<WechatInteractionDeps> = {}) {
	const sent: string[] = [];
	const channel = createWechatInteractionChannel({
		peer: PEER,
		send: async (text) => {
			sent.push(text);
			return true;
		},
		sendFile: async () => true,
		active: () => true,
		language: () => "en",
		// The reminder and the bound are the channel's own; each case settles first.
		armTimer: () => () => {},
		now: () => 0,
		...overrides,
	});
	return { channel, sent };
}

describe("the interaction channel", () => {
	test("free text stashed for a dialog that ended does not answer the next one", async () => {
		let active = true;
		const { channel: asked } = channel({ active: () => active });

		const select = asked.request({ kind: "select", title: "Pick", options: ["a", INTERACTION_OTHER_LABEL] });
		expect(asked.handleInbound("my own words")).toBe(true);
		expect(await select).toEqual({ kind: "value", value: INTERACTION_OTHER_LABEL });

		// The turn is gone before the follow-up input is asked for, so the stashed
		// text belongs to a question nobody is waiting on any more.
		active = false;
		expect(await asked.request({ kind: "input", title: "Name" })).toEqual({ kind: "cancelled" });
	});

	test("the status view gets a digest prompt's first line", async () => {
		const { channel: asked } = channel();
		const digest = ["Plan ready for review", "1. Add parseConfig", "2. Report a bad key", "Approve?"].join("\n");
		const select = asked.request({ kind: "select", title: digest, options: ["Approve"] });
		expect(asked.pendingInfo()?.title).toBe("Plan ready for review");
		asked.handleInbound("1");
		await select;
	});

	test("a prompt the transport throws on settles instead of waiting", async () => {
		const { channel: asked } = channel({
			send: async () => {
				throw new Error("socket hang up");
			},
		});

		expect(await asked.request({ kind: "input", title: "Name" })).toEqual({ kind: "cancelled" });
		expect(asked.hasPending()).toBe(false);
		// The peer's next message is the model's to answer, not a dead prompt's.
		expect(asked.handleInbound("hello")).toBe(false);
	});

	test("a plan review's exit label arrives as that choice, not as a withdrawal", async () => {
		const { channel: asked } = channel({ language: () => "zh" });
		const review = asked.request({
			kind: "select",
			title: "审阅计划：",
			options: ["批准", "继续规划", "退出", "修改意见"],
		});

		// The label the prompt shows is 退出, which is also a dismissal word: it has to
		// reach the plan's own option parser as the third choice.
		expect(asked.handleInbound("退出")).toBe(true);
		expect(await review).toEqual({ kind: "value", value: "退出" });
	});
});
