import { describe, expect, test } from "bun:test";
import { defaultTimer } from "./timer.ts";

describe("defaultTimer", () => {
	test("runs the callback once after the delay", async () => {
		let fired = 0;
		defaultTimer(1, () => {
			fired += 1;
		});
		await Bun.sleep(20);
		expect(fired).toBe(1);
	});

	test("never runs a cancelled timer", async () => {
		let fired = 0;
		const cancel = defaultTimer(1, () => {
			fired += 1;
		});
		cancel();
		await Bun.sleep(20);
		expect(fired).toBe(0);
	});
});
