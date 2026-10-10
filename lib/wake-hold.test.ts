import { describe, expect, test } from "bun:test";
import { createFakePi } from "../test/helpers/fakes.ts";
import { WAKE_HOLD_CHANNEL, onWakeHoldChange, releaseWakeHold, requestWakeHold } from "./wake-hold.ts";

describe("wake-hold", () => {
	test("request and release carry the owner and flag on the shared channel", () => {
		const { pi } = createFakePi();
		const seen: Array<{ channel: string; data: unknown }> = [];
		onWakeHoldChange(pi, (event) => seen.push({ channel: WAKE_HOLD_CHANNEL, data: event }));

		requestWakeHold(pi, "wechat");
		releaseWakeHold(pi, "wechat");

		expect(seen).toEqual([
			{ channel: WAKE_HOLD_CHANNEL, data: { owner: "wechat", held: true } },
			{ channel: WAKE_HOLD_CHANNEL, data: { owner: "wechat", held: false } },
		]);
	});

	test("unsubscribe stops delivery", () => {
		const { pi } = createFakePi();
		let calls = 0;
		const off = onWakeHoldChange(pi, () => {
			calls++;
		});
		requestWakeHold(pi, "wechat");
		off();
		requestWakeHold(pi, "wechat");
		expect(calls).toBe(1);
	});

	test("ignores malformed payloads from a foreign emitter", () => {
		const { pi } = createFakePi();
		const seen: unknown[] = [];
		onWakeHoldChange(pi, (event) => seen.push(event));

		pi.events.emit(WAKE_HOLD_CHANNEL, undefined);
		pi.events.emit(WAKE_HOLD_CHANNEL, { owner: "", held: true });
		pi.events.emit(WAKE_HOLD_CHANNEL, { owner: "wechat" });
		pi.events.emit(WAKE_HOLD_CHANNEL, { held: true });
		expect(seen).toHaveLength(0);
	});
});
