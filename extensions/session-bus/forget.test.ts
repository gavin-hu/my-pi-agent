/**
 * `/sessions forget`: a person's door to a stopped session's name.
 *
 * A killed process has no door of its own — `/team exit` is a session's, and `/sessions drop`
 * clears only mail no record holds — so its label stays reserved for the whole heartbeat window,
 * and `team.lead` is compared by label. The door acts on the same `stateOf` `gone` the row shows:
 * a record whose pid is dead is forgotten even with a fresh `lastSeen`, and one whose pid is alive
 * is refused. The removal is the two calls `leave()` makes, so the claims go with the row and the
 * inbox stays for `drop`.
 *
 * A suite of its own because it is a door of its own: `unaccounted.test.ts` owns the mail, and
 * `runtime.test.ts` and `extension.test.ts` are named in `LONG_SUITES` at heights that may only
 * fall.
 */

import { afterAll, describe, expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { SESSION_TTL_MS } from "../../lib/session-roster.ts";
import { busMessage, landMessage, sessionRecord } from "../../test/helpers/bus.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { scratchDir } from "../../test/helpers/env.ts";
import { createFakePi } from "../../test/helpers/fakes.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import sessionBus from "./index.ts";
import { createSessionBus } from "./runtime.ts";
import { createBusStore } from "./store.ts";
import type { SessionRecord } from "./types.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

const NOW = 1_000_000;
/** A process that is not running: `alive` below says so, whatever its heartbeat claims. */
const DEAD = 40_001;
/** A process that is running, with its heartbeat as fresh or as aged as the case wants. */
const ALIVE = 40_002;

/** A bus on its own directory, its own liveness answers, and this session joined as `frontend`. */
async function harness(dir: string) {
	const fake = createFakePi();
	const bus = createSessionBus({} as ExtensionAPI, {
		dir,
		repo: { root: "/repo", key: "shared" },
		now: () => NOW,
		heartbeatMs: 0,
		watchMs: 0,
		alive: (pid) => pid !== DEAD,
	});
	sessionBus(fake.pi, { bus });
	const { ctx, notices } = fakeCtx({ cwd: "/repo", sessionId: "s-me", sessionName: "frontend", mode: "json" });
	const command = fake.commands.get("sessions");
	if (!command) throw new Error("sessions command not registered");
	await bus.start(ctx as ExtensionContext);
	await bus.join({ label: "frontend", listen: false });
	return { bus, ctx: ctx as ExtensionContext, notices, command };
}

/** One record on the store, with a fresh heartbeat and `DEAD`'s pid unless the case says otherwise. */
async function seed(dir: string, fields: Partial<SessionRecord> = {}): Promise<SessionRecord> {
	const store = createBusStore({ dir });
	const record: SessionRecord = {
		...sessionRecord("s-dead", NOW),
		label: "crashed",
		pid: DEAD,
		...fields,
	};
	await store.writeSession(record);
	return record;
}

describe("the forget door", () => {
	test("forgets a stopped session whose heartbeat is still fresh, and the name is free at once", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const { bus } = await harness(dir);
		await seed(dir);
		const store = createBusStore({ dir });
		await store.claimAll(["src/a.ts"], "s-dead", "crashed", NOW);

		const result = await bus.forget(["crashed"]);

		expect(result.forgotten).toEqual([{ id: "s-dead", label: "crashed", released: ["src/a.ts"] }]);
		expect(result.kept).toEqual([]);
		expect(await store.session("s-dead")).toBeUndefined();
		expect(await store.claims()).toEqual([]);
		// The label is free the moment it returns: the same process takes it.
		expect((await bus.join({ label: "crashed" })).label).toBe("crashed");
		await bus.stop();
	});

	test("forgets by id as well as by label", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const { bus } = await harness(dir);
		await seed(dir);
		await seed(dir, { id: "s-other", label: "other", pid: DEAD });

		const result = await bus.forget(["s-other"]);

		expect(result.forgotten.map((entry) => entry.label)).toEqual(["other"]);
		expect(await createBusStore({ dir }).session("s-dead")).toBeDefined();
		await bus.stop();
	});

	test("refuses a record whose pid is alive, naming the holder", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const { bus } = await harness(dir);
		await seed(dir, { id: "s-alive", label: "asleep", pid: ALIVE });

		const result = await bus.forget(["asleep"]);

		expect(result.forgotten).toEqual([]);
		expect(result.kept).toEqual([{ name: "asleep", reason: "held", holder: "s-alive" }]);
		expect(await createBusStore({ dir }).session("s-alive")).toBeDefined();
		await bus.stop();
	});

	test("refuses a quiet record too, because its pid is alive and only the heartbeat aged", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const { bus } = await harness(dir);
		await seed(dir, { id: "s-quiet", label: "quietly", pid: ALIVE, lastSeen: NOW - SESSION_TTL_MS - 1 });

		expect((await bus.forget(["quietly"])).kept).toEqual([{ name: "quietly", reason: "held", holder: "s-quiet" }]);
		expect(await createBusStore({ dir }).session("s-quiet")).toBeDefined();
		await bus.stop();
	});

	test("refuses two records under one label as ambiguous, naming the ids", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const { bus } = await harness(dir);
		await seed(dir, { id: "s-gone", label: "twin", pid: DEAD });
		await seed(dir, { id: "s-fresh", label: "twin", pid: ALIVE });

		const result = await bus.forget(["twin"]);

		expect(result.forgotten).toEqual([]);
		expect(result.kept).toEqual([{ name: "twin", reason: "ambiguous", holders: ["s-fresh", "s-gone"] }]);
		expect(await createBusStore({ dir }).session("s-gone")).toBeDefined();
		await bus.stop();
	});

	test("keeps a name nothing holds as missing", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const { bus } = await harness(dir);

		expect((await bus.forget(["nobody"])).kept).toEqual([{ name: "nobody", reason: "missing" }]);
		await bus.stop();
	});

	test("leaves the inbox alone, so its unread turn up as unaccounted", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const { bus } = await harness(dir);
		await seed(dir);
		await landMessage(dir, busMessage("m-forgotten", "s-dead", NOW), NOW);

		await bus.forget(["crashed"]);

		const status = await bus.status();
		expect(status.unaccounted?.messages.map((entry) => entry.message.id)).toEqual(["m-forgotten"]);
		await bus.stop();
	});
});

describe("the command's forget", () => {
	test("forgets the name it was given and says what went back", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const { bus, ctx, notices, command } = await harness(dir);
		await seed(dir);
		await createBusStore({ dir }).claimAll(["src/a.ts", "src/b.ts"], "s-dead", "crashed", NOW);

		await command.handler("forget crashed", ctx);

		expect(notices.at(-1)?.message).toBe("Forgot crashed — its name is free, and 2 claims went back.");
		expect(notices.at(-1)?.kind).toBe("info");
		expect(await createBusStore({ dir }).session("s-dead")).toBeUndefined();
		await bus.stop();
	});

	test("warns, and keeps the record, when the pid is alive", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const { bus, ctx, notices, command } = await harness(dir);
		await seed(dir, { id: "s-alive", label: "asleep", pid: ALIVE });

		await command.handler("forget asleep", ctx);

		expect(notices.at(-1)?.kind).toBe("warning");
		expect(notices.at(-1)?.message).toBe("Not forgotten: asleep is already in use by session s-alive.");
		expect(await createBusStore({ dir }).session("s-alive")).toBeDefined();
		await bus.stop();
	});

	test("a bare forget frees nothing and names the syntax", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const { bus, ctx, notices, command } = await harness(dir);
		await seed(dir);

		await command.handler("forget", ctx);

		expect(notices.at(-1)?.message).toContain("/sessions forget <label|id>");
		expect(await createBusStore({ dir }).session("s-dead")).toBeDefined();
		await bus.stop();
	});
});
