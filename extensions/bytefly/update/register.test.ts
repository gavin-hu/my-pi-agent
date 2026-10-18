import { describe, expect, test } from "bun:test";
import pkg from "../../../package.json";
import { NOTICE_TYPE } from "../../../lib/notice.ts";
import { fakeCtx } from "../../../test/helpers/context.ts";
import { makeFakePi } from "../../../test/helpers/fakes.ts";
import { settle } from "../../../test/helpers/process.ts";
import { registerUpdate } from "./register.ts";
import { createUpdateState } from "./state.ts";

/** A version guaranteed to be newer than the one under test. */
const NEWER = "99.0.0";

/** Boot the update surface over a fixed registry answer. */
function boot(reply: string | undefined, options: { offline?: boolean; mode?: string; fail?: boolean } = {}) {
	const { pi, customMessages } = makeFakePi();
	const { ctx } = fakeCtx({ mode: options.mode ?? "tui" });
	const state = createUpdateState();
	const reads: number[] = [];
	const updates: number[] = [];
	registerUpdate(pi, state, {
		fetchLatest: async () => {
			reads.push(1);
			if (options.fail) throw new Error("registry unreachable");
			return reply;
		},
		isOffline: () => options.offline ?? false,
		onUpdate: () => updates.push(1),
	});
	const start = async (): Promise<void> => {
		for (const handler of pi.handlers.get("session_start") ?? []) await handler({}, ctx);
		await settle();
	};
	const shutdown = async (): Promise<void> => {
		for (const handler of pi.handlers.get("session_shutdown") ?? []) await handler({}, ctx);
		await settle();
	};
	return { state, customMessages, reads, updates, start, shutdown };
}

describe("update check", () => {
	test("marks the store and posts one notice when a newer version is published", async () => {
		const { state, customMessages, updates, start } = boot(NEWER);
		await start();

		expect(state.latest()).toBe(NEWER);
		expect(updates).toHaveLength(1);
		expect(customMessages).toHaveLength(1);
		const { message } = customMessages[0] as { message: any };
		expect(message.customType).toBe(NOTICE_TYPE);
		expect(message.details.source).toBe("bytefly");
		expect(message.details.title).toBe(`${NEWER} is available`);
		expect(message.content).toContain(`current ${pkg.version}`);
	});

	test("stays quiet when the loaded version is current", async () => {
		const { state, customMessages, updates, start } = boot(pkg.version);
		await start();

		expect(state.latest()).toBeUndefined();
		expect(updates).toEqual([]);
		expect(customMessages).toEqual([]);
	});

	test("stays quiet when the registry is behind", async () => {
		const { state, customMessages, start } = boot("0.0.1");
		await start();

		expect(state.latest()).toBeUndefined();
		expect(customMessages).toEqual([]);
	});

	test("stays quiet when the read fails or returns nothing", async () => {
		for (const options of [{ fail: true }, {}]) {
			const { state, customMessages, start } = boot(undefined, options);
			await start();
			expect(state.latest()).toBeUndefined();
			expect(customMessages).toEqual([]);
		}
	});

	test("makes no request when offline", async () => {
		const { reads, customMessages, start } = boot(NEWER, { offline: true });
		await start();

		expect(reads).toEqual([]);
		expect(customMessages).toEqual([]);
	});

	test("makes no request outside the interactive mode", async () => {
		const { reads, customMessages, start } = boot(NEWER, { mode: "print" });
		await start();

		expect(reads).toEqual([]);
		expect(customMessages).toEqual([]);
	});

	test("announces once per load, even if the session starts again", async () => {
		const { customMessages, reads, start } = boot(NEWER);
		await start();
		await start();

		expect(reads).toHaveLength(1);
		expect(customMessages).toHaveLength(1);
	});

	test("drops the recorded version on shutdown", async () => {
		const { state, start, shutdown } = boot(NEWER);
		await start();
		await shutdown();

		expect(state.latest()).toBeUndefined();
	});

	test("ignores a reply that lands after shutdown", async () => {
		const { pi, customMessages } = makeFakePi();
		const { ctx } = fakeCtx({ mode: "tui" });
		const state = createUpdateState();
		let answer: (value: string | undefined) => void = () => {};
		registerUpdate(pi, state, {
			fetchLatest: () =>
				new Promise<string | undefined>((resolve) => {
					answer = resolve;
				}),
			isOffline: () => false,
		});
		for (const handler of pi.handlers.get("session_start") ?? []) await handler({}, ctx);
		for (const handler of pi.handlers.get("session_shutdown") ?? []) await handler({}, ctx);
		answer(NEWER);
		await settle();

		expect(state.latest()).toBeUndefined();
		expect(customMessages).toEqual([]);
	});
});
