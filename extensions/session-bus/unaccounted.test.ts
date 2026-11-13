/**
 * The mail no record holds: what a status names, and the one door that clears it.
 *
 * The bus already counted this mail and could do nothing else with it — a person had to delete the
 * JSON by hand. Two things are new, and they are held here: the status names each message (sender,
 * kind, age, body) and `/sessions drop <id>` clears one, refusing any id a record's inbox still
 * carries. The drop is the store's, so the cases drive it where it is decided: the file, and the
 * records read at the moment of the delete.
 *
 * A suite of its own because the three obvious homes are barred: `store.test.ts` sits exactly at
 * the 400-line bar, and `runtime.test.ts` and `extension.test.ts` are named in `LONG_SUITES` at
 * heights that may only fall.
 */

import { afterAll, describe, expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { fakeCtx } from "../../test/helpers/context.ts";
import { scratchDir } from "../../test/helpers/env.ts";
import { createFakePi } from "../../test/helpers/fakes.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import sessionBus from "./index.ts";
import { createSessionBus, type SessionBus } from "./runtime.ts";
import { createBusStore } from "./store.ts";
import type { BusMessage } from "./types.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

const NOW = 1_000;

/** The one orphan the evidence names, written the way a send writes one: through the store. */
const ORPHAN = "1794547913406-450281a3";

/** A message for `to`, through the store — the only writer the bus has. */
async function land(dir: string, to: string, overrides: Partial<BusMessage> = {}): Promise<BusMessage> {
	const message: BusMessage = {
		id: ORPHAN,
		from: "s-gavin",
		fromLabel: "gavin",
		to,
		toLabel: "tina",
		kind: "ask",
		text: "can you take the roster card?",
		at: NOW,
		...overrides,
	};
	await createBusStore({ dir }).writeMessage(to, message);
	return message;
}

/**
 * A started session on a bus of its own directory, with `/sessions` registered on its Pi.
 *
 * The session joins as `frontend`, so the bus holds one record — which is what makes an id it does
 * not hold the interesting one.
 */
async function harness(dir: string): Promise<{
	bus: SessionBus;
	ctx: ExtensionContext;
	notices: Array<{ message: string; kind?: string }>;
	command: { handler(args: string, ctx: ExtensionContext): Promise<void> };
	tool: {
		execute(
			id: string,
			params: unknown,
			signal?: undefined,
			update?: undefined,
			ctx?: ExtensionContext,
		): Promise<{ content: Array<{ text: string }>; details: any; isError?: true }>;
	};
}> {
	const fake = createFakePi();
	const bus = createSessionBus({} as ExtensionAPI, {
		dir,
		repo: { root: "/repo", key: "shared" },
		now: () => NOW,
		heartbeatMs: 0,
		watchMs: 0,
		alive: () => true,
	});
	sessionBus(fake.pi, { bus });
	const { ctx, notices } = fakeCtx({ cwd: "/repo", sessionId: "s-live", sessionName: "frontend", mode: "json" });
	const command = fake.commands.get("sessions");
	if (!command) throw new Error("sessions command not registered");
	const tool = fake.tools.get("session");
	if (!tool) throw new Error("session tool not registered");
	await bus.start(ctx as ExtensionContext);
	await bus.join({ label: "frontend", listen: false });
	return { bus, ctx: ctx as ExtensionContext, notices, command, tool };
}

describe("the status naming the mail", () => {
	test("answers the message, its sender, its kind and its body", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const { bus } = await harness(dir);
		await land(dir, "s-gone");
		const status = await bus.status();
		expect(status.unaccounted?.map((entry) => entry.message.id)).toEqual([ORPHAN]);
		const [entry] = status.unaccounted ?? [];
		expect(entry?.message.fromLabel).toBe("gavin");
		expect(entry?.message.kind).toBe("ask");
		expect(entry?.message.text).toBe("can you take the roster card?");
		await bus.stop();
	});

	test("says nothing at all when every message has a record", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const { bus } = await harness(dir);
		await land(dir, "s-live");
		// A record holds it, so it is that session's unread mail and not the bus's unaccounted mail.
		expect((await bus.status()).unaccounted).toBeUndefined();
		await bus.stop();
	});
});

describe("the store's drop", () => {
	test("removes the file, and the inbox it emptied", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const { bus } = await harness(dir);
		await land(dir, "s-gone");
		expect(await bus.dropUnaccounted([ORPHAN])).toEqual({ dropped: [ORPHAN], kept: [] });
		expect((await bus.status()).unaccounted).toBeUndefined();
		await bus.stop();
	});

	test("keeps the copy a live session still has to read, and names its holder", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const { bus } = await harness(dir);
		// One broadcast, two files: one recipient the bus holds, one it does not.
		await land(dir, "s-live");
		await land(dir, "s-gone");
		expect(await bus.dropUnaccounted([ORPHAN])).toEqual({
			dropped: [ORPHAN],
			kept: [{ id: ORPHAN, reason: "held", holder: "frontend" }],
		});
		expect(await bus.unread()).toBe(1);
		await bus.stop();
	});

	test("refuses an id the bus holds nowhere", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const { bus } = await harness(dir);
		expect(await bus.dropUnaccounted(["1794000000000-aaaaaaaa"])).toEqual({
			dropped: [],
			kept: [{ id: "1794000000000-aaaaaaaa", reason: "missing" }],
		});
		await bus.stop();
	});

	test("reads the records at the delete, so a session that came back keeps its mail", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const { bus } = await harness(dir);
		await land(dir, "s-gone");
		// The listing said nobody holds it; between that read and the drop, the id is on the bus again.
		// The attribution is read here rather than by the caller for exactly this window.
		expect((await bus.status()).unaccounted).toHaveLength(1);
		await createBusStore({ dir }).writeSession({
			id: "s-gone",
			label: "tina",
			pid: 1,
			cwd: "/repo",
			repoRoot: "/repo",
			mode: "json",
			startedAt: NOW,
			lastSeen: NOW,
		});
		expect(await bus.dropUnaccounted([ORPHAN])).toEqual({
			dropped: [],
			kept: [{ id: ORPHAN, reason: "held", holder: "tina" }],
		});
		expect((await bus.status()).unaccounted).toBeUndefined();
		await bus.stop();
	});

	test("a bus that never started refuses rather than guessing where the mail is", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const bus = createSessionBus({} as ExtensionAPI, { dir, heartbeatMs: 0, watchMs: 0 });
		await expect(bus.dropUnaccounted([ORPHAN])).rejects.toThrow("session bus is not started.");
	});
});

describe("the tool's side", () => {
	test("status names the mail, with the id a person types back", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const { bus, ctx, tool } = await harness(dir);
		await land(dir, "s-gone");
		const result = await tool.execute("call", { action: "status" }, undefined, undefined, ctx);
		expect(result.content[0]?.text).toContain("Unaccounted (1)");
		expect(result.content[0]?.text).toContain(`- ${ORPHAN} · gavin · ask`);
		expect(result.details.status.unaccounted).toHaveLength(1);
		await bus.stop();
	});

	test("has no drop action, which is what keeps a bystander's model from clearing evidence", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const { bus, ctx, tool } = await harness(dir);
		await land(dir, "s-gone");
		const result = await tool.execute("call", { action: "drop" }, undefined, undefined, ctx);
		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain('unknown action "drop"');
		// The command is the only door: nothing reached through the tool touched the file.
		expect((await bus.status()).unaccounted).toHaveLength(1);
		await bus.stop();
	});
});

describe("the command's drop", () => {
	test("a bare drop lists the mail and drops nothing", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const { bus, ctx, notices, command } = await harness(dir);
		await land(dir, "s-gone");
		await command.handler("drop", ctx);
		const said = notices.at(-1)?.message ?? "";
		expect(said).toContain("Unaccounted (1): mail for a record the bus no longer holds");
		// Named whole, because the id is the word a person types back.
		expect(said).toContain(ORPHAN);
		expect(said).toContain("gavin · ask");
		expect((await bus.status()).unaccounted).toHaveLength(1);
		await bus.stop();
	});

	test("drops the id it was given", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const { bus, ctx, notices, command } = await harness(dir);
		await land(dir, "s-gone");
		await command.handler(`drop ${ORPHAN}`, ctx);
		expect(notices.at(-1)?.message).toBe(`Dropped ${ORPHAN} — a message no record held.`);
		expect(notices.at(-1)?.kind).toBe("info");
		expect((await bus.status()).unaccounted).toBeUndefined();
		await bus.stop();
	});

	test("warns, and keeps the mail, when the id belongs to a session on the bus", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const { bus, ctx, notices, command } = await harness(dir);
		await land(dir, "s-live");
		await command.handler(`drop ${ORPHAN}`, ctx);
		expect(notices.at(-1)?.kind).toBe("warning");
		expect(notices.at(-1)?.message).toContain("Not dropped:");
		expect(notices.at(-1)?.message).toContain("is held by frontend");
		expect(await bus.unread()).toBe(1);
		await bus.stop();
	});

	test("a first word that is not `drop` still opens what it opened before", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const { bus, ctx, notices, command } = await harness(dir);
		await land(dir, "s-gone");
		await command.handler("join backend", ctx);
		// Outside the TUI there is no board to mount, so a stray word prints the listing — and it
		// drops nothing, which is the compatibility this command owes its one old act.
		expect(notices.at(-1)?.message).toContain("Sessions (1)");
		expect((await bus.status()).unaccounted).toHaveLength(1);
		await bus.stop();
	});
});
