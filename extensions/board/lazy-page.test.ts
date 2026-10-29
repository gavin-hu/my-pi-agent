/**
 * The lazy board page: the command paths load the page once, and shutdown closes
 * only a page that was already opened.
 */

import { describe, expect, test } from "bun:test";
import type { BoardSession } from "../../lib/board/session.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { createLazyBoardPage, type BoardPageModule } from "./lazy-page.ts";
import type { BoardPage, BoardPageStatus } from "./page.ts";

function fakePage(calls: string[]): BoardPage {
	const status = async (): Promise<BoardPageStatus> => {
		calls.push("status");
		return { running: false };
	};
	return {
		start: async () => {
			calls.push("start");
			return { kind: "failed", reason: "not in this test" };
		},
		stop: async () => {
			calls.push("stop");
			return false;
		},
		status,
		dropStale: async () => {
			calls.push("dropStale");
			return false;
		},
		closeAll: async () => {
			calls.push("closeAll");
		},
	};
}

function moduleOf(page: BoardPage): BoardPageModule {
	return { createBoardPage: () => page } as unknown as BoardPageModule;
}

const deps = { mount: async () => ({ kind: "refused" as const, reason: "no server" }), session: () => "" };
const session = {} as BoardSession;
const ctx = fakeCtx().ctx as Parameters<BoardPage["start"]>[0];

describe("the lazy board page", () => {
	test("loads nothing until a command asks", async () => {
		const calls: string[] = [];
		let loads = 0;
		const page = createLazyBoardPage(session, deps, async () => {
			loads += 1;
			return moduleOf(fakePage(calls));
		});
		expect(loads).toBe(0);
		await page.closeAll();
		expect(loads).toBe(0);
		expect(await page.status()).toEqual({ running: false });
		expect(loads).toBe(1);
		await page.closeAll();
		expect(loads).toBe(1);
		expect(calls).toEqual(["status", "closeAll"]);
	});

	test("delegates every method to the one loaded page", async () => {
		const calls: string[] = [];
		let loads = 0;
		const page = createLazyBoardPage(session, deps, async () => {
			loads += 1;
			return moduleOf(fakePage(calls));
		});
		await page.start(ctx);
		await page.stop();
		await page.dropStale(ctx);
		await page.closeAll();
		expect(loads).toBe(1);
		expect(calls).toEqual(["start", "stop", "dropStale", "closeAll"]);
	});
});
