import { describe, expect, test } from "bun:test";
import { NOTICE_TYPE } from "../../../lib/notice.ts";
import { fakeCtx } from "../../../test/helpers/context.ts";
import { makeFakePi } from "../../../test/helpers/fakes.ts";
import { settle } from "../../../test/helpers/process.ts";
import { registerUpdate } from "./register.ts";
import { createUpdateState } from "./state.ts";
import type { UpdateSuppression } from "./suppress.ts";
import type { PackageUpdate } from "./types.ts";

const OWN: PackageUpdate = {
	source: "@gavin-hu/my-pi-agent",
	displayName: "@gavin-hu/my-pi-agent",
	type: "npm",
	scope: "user",
};
const OTHER: PackageUpdate = {
	source: "github.com/example/tool",
	displayName: "example/tool",
	type: "git",
	scope: "project",
};

interface BootOptions {
	list?: PackageUpdate[];
	mode?: string;
	fail?: boolean;
	latest?: string | undefined;
}

/** Boot the update surface over a fixed package list. */
function boot(options: BootOptions = {}) {
	const { pi, customMessages } = makeFakePi({ settings: { npmCommand: ["npm"] } });
	const { ctx } = fakeCtx({ mode: options.mode ?? "tui" });
	const state = createUpdateState();
	const reads: number[] = [];
	const updates: number[] = [];
	const restore: number[] = [];
	const latestCalls: string[] = [];
	const suppression: UpdateSuppression = {
		check: async () => options.list ?? [],
		restore: () => restore.push(1),
	};
	registerUpdate(pi, state, {
		suppress: () => suppression,
		readUpdates: async (_ctx, check) => {
			reads.push(1);
			if (options.fail) throw new Error("npm unreachable");
			expect(check).toBe(suppression.check);
			return options.list ?? [];
		},
		readLatest: async (_ctx, name) => {
			latestCalls.push(name);
			return options.latest ?? "0.14.0";
		},
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
	return { pi, state, customMessages, reads, updates, restore, latestCalls, start, shutdown };
}

describe("update check", () => {
	test("records the list, marks this package's new version, and posts one notice", async () => {
		const { state, customMessages, updates, latestCalls, start } = boot({ list: [OWN, OTHER] });
		await start();

		expect(state.updates()).toEqual([OWN, OTHER]);
		expect(state.ownLatest()).toBe("0.14.0");
		expect(updates).toHaveLength(1);
		expect(latestCalls).toEqual(["@gavin-hu/my-pi-agent"]);
		expect(customMessages).toHaveLength(1);
		const { message } = customMessages[0] as { message: any };
		expect(message.customType).toBe(NOTICE_TYPE);
		expect(message.details.source).toBe("bytefly");
		expect(message.details.title).toBe("2 package updates available");
		expect(message.content).toContain("example/tool");
	});

	test("does not put another package's update on the header", async () => {
		const { state, customMessages, latestCalls, start } = boot({ list: [OTHER] });
		await start();

		expect(state.updates()).toEqual([OTHER]);
		expect(state.ownLatest()).toBeUndefined();
		expect(latestCalls).toEqual([]);
		expect(customMessages).toHaveLength(1);
	});

	test("stays silent when Pi reports no updates", async () => {
		const { state, customMessages, updates, start } = boot({ list: [] });
		await start();

		expect(state.updates()).toEqual([]);
		expect(updates).toEqual([]);
		expect(customMessages).toEqual([]);
	});

	test("stays silent when the read fails", async () => {
		const { state, customMessages, start } = boot({ fail: true });
		await start();

		expect(state.updates()).toEqual([]);
		expect(customMessages).toEqual([]);
	});

	test("makes no request outside the interactive mode", async () => {
		const { reads, customMessages, restore, start } = boot({ list: [OWN], mode: "print" });
		await start();

		expect(reads).toEqual([]);
		expect(customMessages).toEqual([]);
		expect(restore).toEqual([]);
	});

	test("announces once per load, even if the session starts again", async () => {
		const { customMessages, reads, start } = boot({ list: [OWN] });
		await start();
		await start();

		expect(reads).toHaveLength(1);
		expect(customMessages).toHaveLength(1);
	});

	test("clears the store and restores Pi's check on shutdown", async () => {
		const { state, start, shutdown, restore } = boot({ list: [OWN] });
		await start();
		await shutdown();

		expect(state.updates()).toEqual([]);
		expect(state.ownLatest()).toBeUndefined();
		expect(restore).toEqual([1]);
	});

	test("ignores a reply that lands after shutdown", async () => {
		const { pi, customMessages } = makeFakePi();
		const { ctx } = fakeCtx({ mode: "tui" });
		const state = createUpdateState();
		let answer: (value: PackageUpdate[]) => void = () => {};
		const suppression: UpdateSuppression = { check: async () => [], restore: () => {} };
		registerUpdate(pi, state, {
			suppress: () => suppression,
			readUpdates: () =>
				new Promise<PackageUpdate[]>((resolve) => {
					answer = resolve;
				}),
		});
		for (const handler of pi.handlers.get("session_start") ?? []) await handler({}, ctx);
		for (const handler of pi.handlers.get("session_shutdown") ?? []) await handler({}, ctx);
		answer([OWN]);
		await settle();

		expect(state.updates()).toEqual([]);
		expect(customMessages).toEqual([]);
	});
});
