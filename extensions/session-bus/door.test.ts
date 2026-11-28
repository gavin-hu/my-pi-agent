/**
 * The `/sessions` door: three words, one table, and a question before each destroys.
 *
 * Every word here is a person's, not a model's — mail this session never read, mail no record
 * holds, a name that is a signature — so the cases are about the four surfaces one table drives:
 * the words it completes, the line a typo reads, the confirmation each destructive word asks for,
 * and the run behind it. `clean` is the new word and the only one that touches this session's own
 * inbox, so it holds the cutoffs, the default, and the fact that it never joins.
 *
 * A suite of its own because the door had none: `unaccounted.test.ts` and `forget.test.ts` each
 * owned one word of it, and both keep the mail and the policy they name. `extension.test.ts` is
 * named in `LONG_SUITES` at a height that may only fall, so the door needed a declared suite.
 */

import { afterAll, describe, expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { busMessage, landMessage, sessionRecord } from "../../test/helpers/bus.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { scratchDir } from "../../test/helpers/env.ts";
import { createFakePi } from "../../test/helpers/fakes.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import sessionBus from "./index.ts";
import { createSessionBus, type SessionBus } from "./runtime.ts";
import { createBusStore } from "./store.ts";
import type { SessionRecord } from "./types.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

const NOW = 1_000_000;
const HOUR = 3_600_000;
/** A process that is not running: the harness's `alive` says so, whatever its heartbeat claims. */
const DEAD = 40_001;
/** A process that is running. */
const ALIVE = 40_002;
/** The one message no record holds, written the way a send writes one: through the store. */
const ORPHAN = "1794547913406-450281a3";

/** The registered command, as the two fronts a person's `Tab` and typing reach. */
type SessionsCommand = {
	handler(args: string, ctx: ExtensionContext): Promise<void>;
	getArgumentCompletions?: (prefix: string) => Promise<Array<{ value: string; label: string }> | null>;
};

/** A bus on its own directory, this session joined as `frontend` unless the case says otherwise. */
async function harness(
	dir: string,
	options: { mode?: string; confirm?: boolean; join?: boolean } = {},
): Promise<{
	bus: SessionBus;
	ctx: ExtensionContext;
	notices: Array<{ message: string; kind?: string }>;
	confirms: Array<{ title: string; message: string }>;
	command: SessionsCommand;
}> {
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
	const { ctx, notices, confirms } = fakeCtx({
		cwd: "/repo",
		sessionId: "s-live",
		sessionName: "frontend",
		mode: options.mode ?? "json",
		confirm: options.confirm,
	});
	const command = fake.commands.get("sessions") as SessionsCommand | undefined;
	if (!command) throw new Error("sessions command not registered");
	await bus.start(ctx as ExtensionContext);
	if (options.join !== false) await bus.join({ label: "frontend", listen: false });
	return { bus, ctx: ctx as ExtensionContext, notices, confirms, command };
}

/** One record on the store, with `DEAD`'s pid and a heartbeat fresh enough to keep its row. */
async function seed(dir: string, fields: Partial<SessionRecord> = {}): Promise<void> {
	await createBusStore({ dir }).writeSession({
		...sessionRecord("s-dead", NOW),
		label: "crashed",
		pid: DEAD,
		...fields,
	});
}

/** A message in `to`'s inbox, stamped with the moment it arrived rather than the wall clock. */
async function land(dir: string, to: string, at: number, id = ORPHAN): Promise<void> {
	await landMessage(dir, busMessage(id, to, at), at);
}

describe("the words the door knows", () => {
	test("completes clean, drop and forget, and offers nothing for a word it does not know", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const { bus, command } = await harness(dir);
		const complete = async (prefix: string) =>
			((await command.getArgumentCompletions?.(prefix)) ?? []).map((item) => item.value);

		expect(await complete("")).toEqual(["clean", "drop", "forget"]);
		expect(await complete("cl")).toEqual(["clean"]);
		expect(await complete("drpo")).toEqual([]);
		await bus.stop();
	});

	test("completes each word's argument from the bus it is already on", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const { bus, command } = await harness(dir);
		await seed(dir);
		await land(dir, "s-gone", NOW);
		const complete = async (prefix: string) =>
			((await command.getArgumentCompletions?.(prefix)) ?? []).map((item) => item.value);

		// The ids and labels a person cannot type from memory, read from the snapshot they are drawn on.
		expect(await complete("drop ")).toEqual([`drop ${ORPHAN}`]);
		expect(await complete("drop 1794")).toEqual([`drop ${ORPHAN}`]);
		expect(await complete("forget ")).toEqual(["forget crashed"]);
		expect(await complete("forget cr")).toEqual(["forget crashed"]);
		// An age is a shape rather than a fact, so the door offers the ones people reach for.
		expect(await complete("clean ")).toEqual(["clean 1h", "clean 6h", "clean 12h", "clean 1d", "clean 7d"]);
		// One argument, so a satisfied word offers nothing: a second id is typed, not completed.
		expect(await command.getArgumentCompletions?.(`drop ${ORPHAN} `)).toBeNull();
		await bus.stop();
	});

	test("offers no argument before a bus has started, and the words regardless", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const { command } = await harness(dir, { join: false });
		await seed(dir);
		// Nothing has started the bus, so the snapshot has no answer: the one thing a completer may
		// never do is throw, because that costs every later `Tab` in the process its completion.
		expect(await command.getArgumentCompletions?.("")).toEqual([
			{ value: "clean", label: "clean" },
			{ value: "drop", label: "drop" },
			{ value: "forget", label: "forget" },
		]);
		expect(await command.getArgumentCompletions?.("drop ")).toBeNull();
	});

	test("a stray word names the words and still opens what it opened before", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const { bus, ctx, notices, command } = await harness(dir);
		await land(dir, "s-gone", NOW);

		await command.handler("drpo", ctx);

		const warning = notices.find((entry) => entry.kind === "warning");
		expect(warning?.message).toContain('sessions: no word "drpo"');
		expect(warning?.message).toContain("clean [<age>], drop <id>…, forget <label|id>…");
		// Outside the TUI there is no board to mount, so the stray word prints the listing — and it
		// destroys nothing, which is the compatibility this command owes its one old act.
		expect(notices.at(-1)?.message).toContain("Sessions (1)");
		expect((await bus.status()).unaccounted?.count).toBe(1);
		await bus.stop();
	});
});

describe("the command's drop", () => {
	test("a bare drop lists the mail and drops nothing", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const { bus, ctx, notices, confirms, command } = await harness(dir);
		await land(dir, "s-gone", NOW);

		await command.handler("drop", ctx);

		const said = notices.at(-1)?.message ?? "";
		expect(said).toContain("Unaccounted (1): mail for a record the bus no longer holds");
		// Named whole, because the id is the word a person types back.
		expect(said).toContain(ORPHAN);
		// Nothing is named, so there is nothing to ask about.
		expect(confirms).toEqual([]);
		expect((await bus.status()).unaccounted?.count).toBe(1);
		await bus.stop();
	});

	test("asks first where there is a UI, and says what it will clear", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const { bus, ctx, notices, confirms, command } = await harness(dir, { mode: "tui", confirm: true });
		await land(dir, "s-gone", NOW);

		await command.handler(`drop ${ORPHAN}`, ctx);

		expect(confirms).toHaveLength(1);
		expect(confirms[0]?.title).toBe("Drop this message no session holds?");
		expect(confirms[0]?.message).toContain("Nothing can read it again.");
		expect(confirms[0]?.message).toContain(ORPHAN);
		expect(notices.at(-1)?.message).toBe(`Dropped ${ORPHAN} — a message no record held.`);
		await bus.stop();
	});

	test("keeps the mail when the question is declined", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const { bus, ctx, notices, command } = await harness(dir, { mode: "tui", confirm: false });
		await land(dir, "s-gone", NOW);

		await command.handler(`drop ${ORPHAN}`, ctx);

		expect(notices.at(-1)?.message).toBe("Nothing was dropped.");
		expect((await bus.status()).unaccounted?.count).toBe(1);
		await bus.stop();
	});

	test("drops the id it was given, with no UI to ask in", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const { bus, ctx, notices, confirms, command } = await harness(dir);
		await land(dir, "s-gone", NOW);

		await command.handler(`drop ${ORPHAN}`, ctx);

		expect(confirms).toEqual([]);
		expect(notices.at(-1)?.message).toBe(`Dropped ${ORPHAN} — a message no record held.`);
		expect(notices.at(-1)?.kind).toBe("info");
		expect((await bus.status()).unaccounted).toBeUndefined();
		await bus.stop();
	});

	test("warns, and keeps the mail, when the id belongs to a session on the bus", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const { bus, ctx, notices, command } = await harness(dir);
		await land(dir, "s-live", NOW);

		await command.handler(`drop ${ORPHAN}`, ctx);

		expect(notices.at(-1)?.kind).toBe("warning");
		expect(notices.at(-1)?.message).toContain("Not dropped:");
		expect(notices.at(-1)?.message).toContain("is held by frontend");
		expect((await bus.peek()).unread.size).toBe(1);
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

	test("asks first where there is a UI, and frees nothing when the question is declined", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const { bus, ctx, notices, confirms, command } = await harness(dir, { mode: "tui", confirm: false });
		await seed(dir);

		await command.handler("forget crashed", ctx);

		expect(confirms[0]?.title).toBe("Forget this stopped session?");
		expect(confirms[0]?.message).toContain("The name goes free for a new session to take");
		expect(notices.at(-1)?.message).toBe("Nothing was forgotten.");
		expect(await createBusStore({ dir }).session("s-dead")).toBeDefined();
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

describe("the command's clean", () => {
	test("clears this session's own mail older than the age it was given", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const { bus, ctx, notices, confirms, command } = await harness(dir, { mode: "tui", confirm: true });
		await land(dir, "s-live", NOW - 3 * HOUR, "1-old");
		await land(dir, "s-live", NOW - HOUR, "2-new");

		await command.handler("clean 2h", ctx);

		expect(confirms[0]?.title).toBe("Clean this session's inbox of mail older than 2h?");
		expect(confirms[0]?.message).toContain("nothing brings it back");
		expect(notices.at(-1)?.message).toBe("Cleaned 1 message older than 2h. 1 message left.");
		expect((await bus.peek()).unread).toEqual(new Set(["2-new"]));
		await bus.stop();
	});

	test("a bare clean clears what the TTL would take anyway, and says the age it named", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const { bus, ctx, notices, command } = await harness(dir);
		await land(dir, "s-live", NOW - 25 * HOUR, "1-stale");
		await land(dir, "s-live", NOW - HOUR, "2-fresh");

		await command.handler("clean", ctx);

		// The default is the message TTL's own age, spelled the way the bus's rows say it.
		expect(notices.at(-1)?.message).toBe("Cleaned 1 message older than 1d. 1 message left.");
		expect((await bus.peek()).unread).toEqual(new Set(["2-fresh"]));
		await bus.stop();
	});

	test("refuses an age it cannot read, and clears nothing", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const { bus, ctx, notices, command } = await harness(dir);
		await land(dir, "s-live", NOW - 3 * HOUR, "1-old");

		await command.handler("clean 2w", ctx);

		expect(notices.at(-1)?.kind).toBe("warning");
		expect(notices.at(-1)?.message).toContain('"2w" is not an age');
		expect(notices.at(-1)?.message).toContain("Nothing was cleaned.");
		expect((await bus.peek()).unread).toEqual(new Set(["1-old"]));
		await bus.stop();
	});

	test("keeps the mail when the question is declined", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const { bus, ctx, notices, command } = await harness(dir, { mode: "tui", confirm: false });
		await land(dir, "s-live", NOW - 3 * HOUR, "1-old");

		await command.handler("clean 2h", ctx);

		expect(notices.at(-1)?.message).toBe("Nothing was cleaned.");
		expect((await bus.peek()).unread).toEqual(new Set(["1-old"]));
		await bus.stop();
	});

	test("sweeps an inbox without putting the session on the bus", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const { bus, ctx, notices, command } = await harness(dir, { join: false });
		await land(dir, "s-live", NOW - 3 * HOUR, "1-old");

		await command.handler("clean 2h", ctx);

		// The one word that must not join: a person clearing their own mail is not announcing itself
		// to the team, and a session that has left can still do it.
		expect((await bus.status()).onBus).toBe(false);
		expect(notices.at(-1)?.message).toBe("Cleaned 1 message older than 2h. The inbox is empty.");
		await bus.stop();
	});
});
