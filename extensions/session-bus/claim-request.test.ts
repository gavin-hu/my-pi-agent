/**
 * The claim and release requests an event handler makes, answered.
 *
 * `before_agent_start` has no `executeTool`, so `board`’s re-claim of a resumed session’s
 * paths cannot be a nested call: it asks here instead, the way a command asks for a send.
 * These cases pin the four answers a caller reads — claimed, conflicted, released with what
 * was not held, and refused — that the claim is really on the bus, and the one thing a
 * request with no answer must not do, which is start a bus.
 */

import { afterAll, describe, expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	type ClaimPathsResult,
	type ReleasePathsResult,
	SESSION_CLAIM_REQUEST,
	SESSION_RELEASE_REQUEST,
	type SessionClaimRequest,
	type SessionReleaseRequest,
} from "../../lib/session-tool.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { scratchDir } from "../../test/helpers/env.ts";
import { createFakePi } from "../../test/helpers/fakes.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { createSessionBus, type SessionBus } from "./runtime.ts";
import { registerClaimRequests } from "./claim-request.ts";
import { createBusStore } from "./store.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** One session on a shared bus, holding the context an event handler has rather than a tool's. */
function eventSession(
	dir: string,
	id: string,
	label: string,
): { bus: SessionBus; pi: ExtensionAPI; ctx: ExtensionContext } {
	const bus = createSessionBus({} as ExtensionAPI, {
		dir,
		repo: { root: "/repo", key: "shared" },
		now: () => 1_000,
		heartbeatMs: 0,
	});
	const fake = createFakePi();
	registerClaimRequests(fake.pi, bus);
	// `executeTool` destructured away: that field is the whole difference between an event
	// context and a tool's, so a case that kept it would prove the wrong transport.
	const { executeTool: _executeTool, ...ctx } = fakeCtx({ cwd: "/repo", sessionId: id, sessionName: label }).ctx;
	return { bus, pi: fake.pi, ctx: ctx as ExtensionContext };
}

/** Ask the bus to claim, the way `lib/session-tool.ts` asks for an event context. */
function askClaim(pi: ExtensionAPI, ctx: ExtensionContext, paths: string[]): Promise<ClaimPathsResult> {
	return new Promise<ClaimPathsResult>((resolve) => {
		const request: SessionClaimRequest = { ctx, paths, respond: resolve };
		pi.events.emit(SESSION_CLAIM_REQUEST, request);
	});
}

/** The same ask, for a release. */
function askRelease(pi: ExtensionAPI, ctx: ExtensionContext, paths: string[]): Promise<ReleasePathsResult> {
	return new Promise<ReleasePathsResult>((resolve) => {
		const request: SessionReleaseRequest = { ctx, paths, respond: resolve };
		pi.events.emit(SESSION_RELEASE_REQUEST, request);
	});
}

describe("a claim request", () => {
	test("claims the paths and reports them, and the claim is really on the bus", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const caller = eventSession(dir, "s1", "api-core");

		expect(await askClaim(caller.pi, caller.ctx, ["src/api"])).toEqual({
			ok: true,
			claimed: ["src/api"],
			conflicts: [],
		});
		// The answer is not a claim the record does not back.
		expect((await createBusStore({ dir }).claims()).map((claim) => [claim.path, claim.owner])).toEqual([
			["src/api", "s1"],
		]);

		await caller.bus.stop();
	});

	test("names the session holding a path, rather than refusing the claim outright", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const holder = eventSession(dir, "s2", "billing-core");
		const caller = eventSession(dir, "s1", "api-core");
		await askClaim(holder.pi, holder.ctx, ["src/api"]);

		// A conflict is an answer: the paths were asked for and somebody else holds them.
		expect(await askClaim(caller.pi, caller.ctx, ["src/api"])).toEqual({
			ok: true,
			claimed: [],
			conflicts: [{ path: "src/api", owner: "s2", ownerLabel: "billing-core" }],
		});

		await holder.bus.stop();
		await caller.bus.stop();
	});

	test("a second batch is a real claim, so a later reader sees what the first one could not take", async () => {
		// The crossing asks twice when a peer holds one path: the first batch is voided all-or-nothing
		// and the second is the rest. This is the bus's half — what a reader of `claims()` sees after
		// it, which is the answer the card could not give before the rule changed.
		const dir = scratchDir(temps, "pi-session-bus-");
		const holder = eventSession(dir, "s2", "billing-core");
		const caller = eventSession(dir, "s1", "api-core");
		await askClaim(holder.pi, holder.ctx, ["src/web"]);

		const first = await askClaim(caller.pi, caller.ctx, ["src/api", "src/web", "src/db"]);
		expect(first).toEqual({
			ok: true,
			claimed: [],
			conflicts: [{ path: "src/web", owner: "s2", ownerLabel: "billing-core" }],
		});
		const second = await askClaim(caller.pi, caller.ctx, ["src/api", "src/db"]);
		expect(second).toEqual({ ok: true, claimed: ["src/api", "src/db"], conflicts: [] });

		// A later read, not the write's own line: the card's free paths are held, and the peer's is not.
		const held = (await createBusStore({ dir }).claims()).map((claim) => [claim.path, claim.owner]);
		expect(held).toEqual([
			["src/api", "s1"],
			["src/db", "s1"],
			["src/web", "s2"],
		]);

		await holder.bus.stop();
		await caller.bus.stop();
	});

	test("releases what it held and names the rest as not owned", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const caller = eventSession(dir, "s1", "api-core");
		await askClaim(caller.pi, caller.ctx, ["src/api"]);

		expect(await askRelease(caller.pi, caller.ctx, ["src/api", "src/web"])).toEqual({
			ok: true,
			released: ["src/api"],
			notOwned: ["src/web"],
		});
		expect(await createBusStore({ dir }).claims()).toEqual([]);

		await caller.bus.stop();
	});

	test("a claim the bus refuses is its sentence, not a rejection", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const caller = eventSession(dir, "s1", "api-core");

		const refused = await askClaim(caller.pi, caller.ctx, ["../outside"]);
		expect(refused.ok).toBe(false);
		expect(refused.ok === false && refused.error).toContain("is outside the repository");

		await caller.bus.stop();
	});

	test("a request with nobody to answer claims nothing, and starts no bus", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const caller = eventSession(dir, "s1", "api-core");
		// The answer is a function the payload carries; a payload without one is not a request.
		caller.pi.events.emit(SESSION_CLAIM_REQUEST, undefined);
		caller.pi.events.emit(SESSION_CLAIM_REQUEST, { paths: ["src/api"] });
		caller.pi.events.emit(SESSION_RELEASE_REQUEST, { paths: ["src/api"] });
		expect(await createBusStore({ dir }).sessions()).toEqual([]);
	});

	test("a renamed holder's conflict names the name its record holds now", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const holder = eventSession(dir, "s2", "billing-core");
		const caller = eventSession(dir, "s1", "api-core");
		await askClaim(holder.pi, holder.ctx, ["src/api"]);
		await holder.bus.join({ label: "renamed-core" });

		expect(await askClaim(caller.pi, caller.ctx, ["src/api"])).toEqual({
			ok: true,
			claimed: [],
			conflicts: [{ path: "src/api", owner: "s2", ownerLabel: "renamed-core" }],
		});
		// The file keeps the name it captured: a reader with no record of the id falls back to it.
		expect((await createBusStore({ dir }).claims())[0]?.ownerLabel).toBe("billing-core");

		await holder.bus.stop();
		await caller.bus.stop();
	});

	test("the status read draws a renamed session's claim under its current name", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const holder = eventSession(dir, "s2", "billing-core");
		await askClaim(holder.pi, holder.ctx, ["src/api"]);
		await holder.bus.join({ label: "renamed-core" });

		const read = await holder.bus.snapshot();
		expect(read.claims.map((claim) => [claim.path, claim.ownerLabel])).toEqual([["src/api", "renamed-core"]]);
		expect(read.sessions.find((row) => row.id === "s2")?.label).toBe("renamed-core");

		await holder.bus.stop();
	});
});
