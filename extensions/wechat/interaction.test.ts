import { describe, expect, test } from "bun:test";
import { INTERACTION_OTHER_LABEL, type InteractionRequest } from "../../lib/interaction.ts";
import type { PeerLanguage } from "./format.ts";
import { createWechatInteractionChannel, PROMPT_TIMEOUT_MS, type WechatInteractionDeps } from "./interaction.ts";
import type { ArmTimer } from "./timer.ts";

const SELECT: InteractionRequest = { kind: "select", title: "Pick", options: ["A", "B", INTERACTION_OTHER_LABEL] };
const INPUT: InteractionRequest = { kind: "input", title: "Name" };
const CONFIRM: InteractionRequest = { kind: "confirm", title: "Sure?" };

/** A timer seam keyed by delay, so the tests can fire the reminder and the expiry apart. */
function fakeTimers(): { arm: ArmTimer; fire: (ms: number) => void; armed: () => number } {
	const pending = new Map<number, { ms: number; fn: () => void }>();
	let next = 0;
	return {
		arm: (ms, fn) => {
			next += 1;
			const id = next;
			pending.set(id, { ms, fn });
			return () => pending.delete(id);
		},
		fire: (ms) => {
			for (const [id, timer] of [...pending]) {
				if (timer.ms !== ms) continue;
				pending.delete(id);
				timer.fn();
			}
		},
		armed: () => pending.size,
	};
}

function setup(initialPeer: string | undefined = "owner", options: { timer?: ArmTimer; language?: PeerLanguage } = {}) {
	const sent: string[] = [];
	const files: Array<{ path: string; name: string }> = [];
	let peer: string | undefined = initialPeer;
	const deps: WechatInteractionDeps = {
		send: async (text) => {
			sent.push(text);
			return true;
		},
		sendFile: async (path, name) => {
			files.push({ path, name });
			return true;
		},
		activePeer: () => peer,
		language: () => options.language ?? "en",
		armTimer: options.timer,
	};
	const channel = createWechatInteractionChannel(deps);
	return { channel, sent, files, setPeer: (value: string | undefined) => (peer = value) };
}

describe("post and postFile", () => {
	test("post delegates to send", async () => {
		const { channel, sent } = setup();
		await channel.post("hello");
		expect(sent).toEqual(["hello"]);
	});

	test("postFile delegates to sendFile", async () => {
		const { channel, files } = setup();
		expect(await channel.postFile("/tmp/plan.md", "plan.md")).toBe(true);
		expect(files).toEqual([{ path: "/tmp/plan.md", name: "plan.md" }]);
	});
});

describe("isActive", () => {
	test("follows the active peer", () => {
		const { channel, setPeer } = setup();
		expect(channel.isActive()).toBe(true);
		setPeer(undefined);
		expect(channel.isActive()).toBe(false);
	});
});

describe("hasPending", () => {
	test("tracks whether a reply is awaited", async () => {
		const { channel } = setup();
		expect(channel.hasPending()).toBe(false);
		const answer = channel.request(SELECT);
		expect(channel.hasPending()).toBe(true);
		channel.handleInbound("owner", "1");
		await answer;
		expect(channel.hasPending()).toBe(false);
	});
});

describe("request", () => {
	test("sends the prompt and resolves on a matching reply", async () => {
		const { channel, sent } = setup();
		const answer = channel.request(SELECT);
		expect(sent).toHaveLength(1);
		expect(channel.handleInbound("owner", "2")).toBe(true);
		expect(await answer).toEqual({ kind: "value", value: "B" });
	});

	test("cancels immediately without an active peer", async () => {
		const { channel, setPeer } = setup();
		setPeer(undefined);
		expect(await channel.request(SELECT)).toEqual({ kind: "cancelled" });
	});

	test("cancels a concurrent second request", async () => {
		const { channel } = setup();
		const first = channel.request(SELECT);
		expect(await channel.request(SELECT)).toEqual({ kind: "cancelled" });
		channel.handleInbound("owner", "1");
		await first;
	});

	test("cancels on abort", async () => {
		const { channel } = setup();
		const controller = new AbortController();
		const answer = channel.request(SELECT, controller.signal);
		controller.abort();
		expect(await answer).toEqual({ kind: "cancelled" });
	});

	test("cancels when the send fails", async () => {
		const deps: WechatInteractionDeps = {
			send: async () => false,
			sendFile: async () => false,
			activePeer: () => "owner",
			language: () => "en",
		};
		const channel = createWechatInteractionChannel(deps);
		expect(await channel.request(SELECT)).toEqual({ kind: "cancelled" });
	});

	test("reminds once and then cancels an unanswered prompt", async () => {
		const timers = fakeTimers();
		const { channel, sent } = setup("owner", { timer: timers.arm });
		const answer = channel.request(CONFIRM);
		await Bun.sleep(1);
		expect(sent).toHaveLength(1); // the prompt itself

		timers.fire(PROMPT_TIMEOUT_MS / 2);
		expect(sent.at(-1)).toContain("Still waiting for your reply");
		expect(channel.hasPending()).toBe(true);

		timers.fire(PROMPT_TIMEOUT_MS);
		expect(await answer).toEqual({ kind: "cancelled" });
		expect(sent.at(-1)).toBe("That question timed out.");
		expect(channel.hasPending()).toBe(false);
	});

	test("cancels the timeout timers once the peer answers", async () => {
		const timers = fakeTimers();
		const { channel, sent } = setup("owner", { timer: timers.arm });
		const answer = channel.request(CONFIRM);
		await Bun.sleep(1);
		expect(channel.handleInbound("owner", "yes")).toBe(true);
		expect(await answer).toEqual({ kind: "confirmed", confirmed: true });
		expect(timers.armed()).toBe(0);

		timers.fire(PROMPT_TIMEOUT_MS);
		expect(sent).toHaveLength(1);
	});

	test("speaks the peer's language in the timeout notices", async () => {
		const timers = fakeTimers();
		const { channel, sent } = setup("owner", { timer: timers.arm, language: "zh" });
		const answer = channel.request(CONFIRM);
		await Bun.sleep(1);

		timers.fire(PROMPT_TIMEOUT_MS / 2);
		expect(sent.at(-1)).toContain("还在等你的回复");
		timers.fire(PROMPT_TIMEOUT_MS);
		expect(await answer).toEqual({ kind: "cancelled" });
		expect(sent.at(-1)).toBe("问题超时，已取消。");
	});
});

describe("handleInbound", () => {
	test("ignores a reply from another peer", async () => {
		const { channel } = setup();
		const answer = channel.request(SELECT);
		expect(channel.handleInbound("stranger", "1")).toBe(false);
		expect(channel.handleInbound("owner", "1")).toBe(true);
		await answer;
	});

	test("ignores an inbound message with no pending prompt", () => {
		const { channel } = setup();
		expect(channel.handleInbound("owner", "hi")).toBe(false);
	});

	test("re-prompts with a notice on a retry and keeps waiting", async () => {
		const { channel, sent } = setup();
		const answer = channel.request(CONFIRM);
		expect(channel.handleInbound("owner", "maybe")).toBe(true);
		expect(sent).toHaveLength(2);
		expect(sent[1]).toContain("didn't recognize");
		expect(channel.handleInbound("owner", "是")).toBe(true);
		expect(await answer).toEqual({ kind: "confirmed", confirmed: true });
	});

	test("maps a cancel word to cancelled", async () => {
		const { channel } = setup();
		const answer = channel.request(SELECT);
		channel.handleInbound("owner", "取消");
		expect(await answer).toEqual({ kind: "cancelled" });
	});
});

describe("other flow", () => {
	test("select free text becomes Other and the next input returns it", async () => {
		const { channel, sent } = setup();
		const select = channel.request(SELECT);
		channel.handleInbound("owner", "custom value");
		expect(await select).toEqual({ kind: "value", value: INTERACTION_OTHER_LABEL });

		const before = sent.length;
		const input = await channel.request(INPUT);
		expect(input).toEqual({ kind: "value", value: "custom value" });
		expect(sent.length).toBe(before);
	});
});

describe("reset", () => {
	test("resolves a pending prompt as cancelled", async () => {
		const { channel } = setup();
		const answer = channel.request(SELECT);
		channel.reset();
		expect(await answer).toEqual({ kind: "cancelled" });
	});

	test("clears the other stash", async () => {
		const { channel } = setup();
		const select = channel.request(SELECT);
		channel.handleInbound("owner", "custom value");
		await select;
		channel.reset();
		// The stash is gone, so the next input is a fresh prompt rather than a replay.
		const input = channel.request(INPUT);
		expect(channel.handleInbound("owner", "typed")).toBe(true);
		expect(await input).toEqual({ kind: "value", value: "typed" });
	});
});

/**
 * Free text from an "Other" answer belongs to the peer who typed it. One prompt
 * runs at a time, but a stash keyed globally would hand peer A's text to peer B's
 * next input.
 */
describe("other-answer ownership", () => {
	test("returns free text to the peer who typed it, and to nobody else", async () => {
		const { channel, sent, setPeer } = setup("alice");
		const aliceSelect = channel.request(SELECT);
		expect(channel.handleInbound("alice", "something else")).toBe(true);
		expect(await aliceSelect).toEqual({ kind: "value", value: INTERACTION_OTHER_LABEL });

		// Another peer asks for input first: Alice's text must not leak into it.
		setPeer("bob");
		const bobInput = channel.request(INPUT);
		expect(channel.handleInbound("bob", "bob answer")).toBe(true);
		expect(await bobInput).toEqual({ kind: "value", value: "bob answer" });

		// Alice's own next input still gets her stashed text, without a round-trip.
		setPeer("alice");
		expect(await channel.request(INPUT)).toEqual({ kind: "value", value: "something else" });
		// The stashed answer costs no prompt; only the two real prompts were sent.
		expect(sent).toHaveLength(2);
	});
});
