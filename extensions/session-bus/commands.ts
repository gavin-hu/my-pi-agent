/**
 * The `/sessions` command: the board, and the three words that are not the board.
 *
 * In the TUI it opens the live board: `Tab` cycles Sessions, Inbox, and Claims,
 * and `w`/`x` act on this session's own watch and claims. Every other mode prints
 * the compact listing, because there is no dock to mount the screen in. Reading is
 * not joining, so the board is empty until this session joins — and a command
 * context cannot name a session, so the join is `session({action:"join"})`,
 * `/team join [<label>]`, or the board's `w`.
 *
 * `clean`, `drop` and `forget` are the exceptions, and they are commands because of what they
 * destroy: mail this session never read, mail no record holds, and a name that is a signature — so
 * a person clears them and no session's tool call can. They are one table over four surfaces (the
 * description, the typo line, the completer and the parser), and each asks before it destroys when
 * there is a UI to ask in. A bare `drop` prints the mail a drop could name — the board draws no row
 * for it — while a bare `forget` names its syntax, because a gone row is already visible. A bare
 * `clean` clears what the message TTL would have taken anyway.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { messageOf } from "../../lib/errors.ts";
import { formatAge, parseAge, sanitizeLine } from "../../lib/format.ts";
import { formatClean, formatDrop, formatForget, formatJoin, formatStatus, formatUnaccounted } from "./format.ts";
import { COMMAND_NAME, FORGET_WORD, MESSAGE_TTL_MS, forgetCommand } from "./protocol.ts";
import type { SessionBus } from "./runtime.ts";

/** How often the open board re-reads the bus. */
const BOARD_POLL_MS = 1_000;

/**
 * One board read at a time, shared by the open screen's poll and its watch verb.
 *
 * A read that is still running is skipped rather than queued, and a failed read
 * leaves the last board on screen; the bus's own heartbeat keeps this session's
 * record fresh, so a poll never has to write. Both reads are read-only: the
 * snapshot neither prunes nor refreshes, and the peek neither consumes nor marks.
 */
function createBoardReader(bus: SessionBus): (screen: SessionsScreen) => Promise<void> {
	let busy = false;
	return async (screen) => {
		if (busy) return;
		busy = true;
		try {
			const [status, peeked] = await Promise.all([bus.snapshot(), bus.peek()]);
			screen.setBoard({ status, messages: peeked.mail });
		} catch {
			// Best-effort: the next tick tries again, and the board keeps its last read.
		} finally {
			busy = false;
		}
	};
}

/** The mounted board's type, without loading the screen at registration. */
type SessionsScreen = InstanceType<typeof import("./view/session-list.ts")["SessionListComponent"]>;

/** Open the TUI board, and resolve when it closes. */
async function openSessionsScreen(pi: ExtensionAPI, ctx: ExtensionCommandContext, bus: SessionBus): Promise<void> {
	// The board is the TUI's: the text paths below and registration load neither it
	// nor the dock screen's poll loop.
	const { withPolledScreen } = await import("../../lib/screen-session.ts");
	const { SessionListComponent } = await import("./view/session-list.ts");
	await bus.start(ctx);
	const [status, peeked] = await Promise.all([bus.snapshot(), bus.peek()]);
	const first = { status, messages: peeked.mail };
	let read: ((screen: SessionsScreen) => Promise<void>) | undefined;
	await withPolledScreen(
		pi,
		ctx,
		(screen) => {
			const reader = createBoardReader(bus);
			read = reader;
			// The verbs repaint the board they belong to; their callbacks only run after
			// construction, so a holder keeps the wiring one-directional.
			const holder: { screen?: SessionsScreen } = {};
			const component = new SessionListComponent({
				board: first,
				theme: screen.theme,
				callbacks: {
					toggleWatch: async (armed) => {
						// The board's toggle is the same act as a join, so it says the same thing.
						const joined = await bus.join({ listen: !armed });
						if (holder.screen) await reader(holder.screen);
						return formatJoin(joined.label, joined.watching);
					},
					releaseClaim: async (path) => {
						const released = await bus.releaseStored(path);
						if (holder.screen) await reader(holder.screen);
						const name = sanitizeLine(path);
						return released ? `Released ${name}.` : `${name} is no longer yours.`;
					},
				},
				onClose: screen.close,
				requestRender: screen.requestRender,
				viewportRowsSource: screen.viewportRows,
			});
			holder.screen = component;
			return component;
		},
		{ pollMs: BOARD_POLL_MS, poll: (component) => void read?.(component) },
	);
}

/** What one door answers: the sentence a person reads, and the tone it reads in. */
type DoorAnswer = { text: string; kind: "info" | "warning" };

/**
 * One door's shape: start the bus, run the word, say what it did.
 *
 * Every word of this command shares it, the board included — the failure sentence and its warning
 * tone are written once, and each word's own answer is its run. A run that says nothing itself has
 * already spoken through `ui.notify`, which is what the mounted board does.
 */
async function doorRun(
	ctx: ExtensionCommandContext,
	bus: SessionBus,
	run: () => Promise<DoorAnswer | undefined>,
): Promise<void> {
	try {
		await bus.start(ctx);
		const answer = await run();
		if (answer !== undefined) ctx.ui.notify(answer.text, answer.kind);
	} catch (error) {
		ctx.ui.notify(`Session bus: ${messageOf(error)}`, "warning");
	}
}

/** The tone a word's answer reads in: a list that kept part of what was asked is a warning. */
function toneOf(kept: number): DoorAnswer["kind"] {
	return kept > 0 ? "warning" : "info";
}

/** The board and the listing: what every word that is not a word of the table falls through to. */
async function open(ctx: ExtensionCommandContext, pi: ExtensionAPI, bus: SessionBus): Promise<void> {
	await doorRun(ctx, bus, async () => {
		if (ctx.mode === "tui") {
			await openSessionsScreen(pi, ctx, bus);
			return;
		}
		return { text: formatStatus(await bus.status(), Date.now()), kind: "info" };
	});
}

/**
 * `/sessions clean [<age>]`: this session's own mail older than the age, or past the message TTL.
 *
 * The cutoff is the person's, so the sentence names it and the default is the age the bus itself
 * ends mail at: a bare `clean` can only remove what the TTL would have removed anyway, and a
 * stricter one says so. It sweeps this session's inbox and never a peer's, and it never joins.
 */
async function cleanOwn(ctx: ExtensionCommandContext, bus: SessionBus, args: readonly string[]): Promise<void> {
	await doorRun(ctx, bus, async () => {
		const spec = args[0];
		const ms = spec === undefined ? MESSAGE_TTL_MS : parseAge(spec);
		if (ms === undefined) {
			return {
				text: `"${sanitizeLine(spec ?? "")}" is not an age — write one like 30d, 12h, or 90m. Nothing was cleaned.`,
				kind: "warning",
			};
		}
		const olderThan = spec === undefined ? formatAge(Date.now(), Date.now() - ms) : sanitizeLine(spec);
		// No UI is no question to ask: the brief's rule is that the word goes ahead where nothing can
		// answer, which is what a scripted or headless session is.
		const ok =
			!ctx.hasUI ||
			(await ctx.ui.confirm(
				`Clean this session's inbox of mail older than ${olderThan}?`,
				"Mail that reached you goes without being read, and nothing brings it back.",
			));
		if (!ok) return { text: "Nothing was cleaned.", kind: "info" };
		return { text: formatClean(await bus.cleanInbox(ms), olderThan), kind: "info" };
	});
}

/**
 * `/sessions drop [<id>…]`: the mail no record holds, or the ids a person means to clear.
 *
 * No ids is the safe reading of a bare verb — it drops nothing and prints what could be dropped —
 * and it is how this mail is seen at all, because the board has no row for it. The store decides
 * what a drop may touch, refusing any id a record's inbox still holds, so the answer names both
 * what went and what stayed.
 */
async function dropUnaccounted(ctx: ExtensionCommandContext, bus: SessionBus, ids: readonly string[]): Promise<void> {
	await doorRun(ctx, bus, async () => {
		if (ids.length === 0) {
			const status = await bus.status();
			return { text: formatUnaccounted(status.unaccounted, Date.now()), kind: "info" };
		}
		const named = ids.map((id) => `- ${sanitizeLine(id)}`).join("\n");
		const ok =
			!ctx.hasUI ||
			(await ctx.ui.confirm(
				`Drop ${ids.length === 1 ? "this message" : `these ${ids.length} messages`} no session holds?`,
				`Nothing can read it again.\n${named}`,
			));
		if (!ok) return { text: "Nothing was dropped.", kind: "info" };
		const result = await bus.dropUnaccounted(ids);
		return { text: formatDrop(result), kind: toneOf(result.kept.length) };
	});
}

/**
 * `/sessions forget [<label|id>…]`: free a stopped session's name.
 *
 * A bare verb frees nothing and names the syntax: a gone row is already on the board, so there is
 * nothing to reveal the way a bare `drop` reveals mail with no row at all.
 */
async function forgetStopped(ctx: ExtensionCommandContext, bus: SessionBus, names: readonly string[]): Promise<void> {
	await doorRun(ctx, bus, async () => {
		if (names.length === 0) {
			return {
				text: `Name a session: \`${forgetCommand("<label|id>")}…\` frees a stopped session's name.`,
				kind: "info",
			};
		}
		const named = names.map((name) => `- ${sanitizeLine(name)}`).join("\n");
		const ok =
			!ctx.hasUI ||
			(await ctx.ui.confirm(
				`Forget ${names.length === 1 ? "this stopped session" : `these ${names.length} stopped sessions`}?`,
				`The name goes free for a new session to take, and its claim on every path goes back.\n${named}`,
			));
		if (!ok) return { text: "Nothing was forgotten.", kind: "info" };
		const result = await bus.forget(names);
		return { text: formatForget(result), kind: toneOf(result.kept.length) };
	});
}

/** One word of the door: how it is spelled, what follows it, and the run behind it. */
interface DoorWord {
	word: string;
	argument: string;
	what: string;
	run: (ctx: ExtensionCommandContext, bus: SessionBus, args: readonly string[]) => Promise<void>;
}

/**
 * The door's words, one table over four surfaces — the description, the typo line, the completer
 * and the parser — the way `BOARD_WORDS` spans `board`'s, so a word is added once and cannot be
 * known by one surface and refused by another.
 */
const SESSIONS_WORDS: readonly DoorWord[] = [
	{ word: "clean", argument: "[<age>]", what: "clears this session's own outdated mail", run: cleanOwn },
	{ word: "drop", argument: "<id>…", what: "clears mail no record holds", run: dropUnaccounted },
	{ word: FORGET_WORD, argument: "<label|id>…", what: "frees a stopped session's name", run: forgetStopped },
];

/** The words as one line, for the description and for the line a typo reads. */
function usageLine(): string {
	return SESSIONS_WORDS.map((entry) => `${entry.word} ${entry.argument}`).join(", ");
}

/** The ages a `clean` may name, offered rather than left to be remembered. */
const CLEAN_AGES: readonly string[] = ["1h", "6h", "12h", "1d", "7d"];

/** One completion: the whole argument text a `Tab` would land on, and what it reads as. */
type Completion = { value: string; label: string };

/**
 * The arguments a word takes, as far as the bus can say without joining it.
 *
 * A `drop` and a `forget` name facts only the bus holds — the ids no record accounts for, the
 * labels a stopped session left behind — so they are read from the snapshot rather than typed
 * back from memory.
 */
async function argumentsFor(bus: SessionBus, word: string): Promise<string[]> {
	if (word === "clean") return [...CLEAN_AGES];
	const status = await bus.snapshot();
	if (word === "drop") return (status.unaccounted?.messages ?? []).map((entry) => entry.message.id);
	if (word === FORGET_WORD)
		return status.sessions.filter((entry) => entry.state === "gone").map((entry) => entry.label);
	return [];
}

/**
 * `Tab`'s answer: the words, then each word's argument.
 *
 * A completer that rejects costs every later `Tab` in the process its completion, so the one thing
 * this may never do is throw: everything unanswered — and a bus that has not started — reads as
 * "nothing to offer", which leaves the typed text alone.
 */
async function completions(bus: SessionBus, prefix: string): Promise<Completion[] | null> {
	try {
		const text = prefix.trimStart();
		const [head = "", ...rest] = text.split(/\s+/);
		const word = head.toLowerCase();
		if (!text.includes(" ")) {
			const words = SESSIONS_WORDS.filter((entry) => entry.word.startsWith(word)).map((entry) => entry.word);
			return words.length > 0 ? words.map((value) => ({ value, label: value })) : null;
		}
		// One argument, so a satisfied word offers nothing: a second id is typed, not completed.
		if (rest.length !== 1) return null;
		const typed = rest[0] ?? "";
		const offered = (await argumentsFor(bus, word)).filter((argument) => argument.startsWith(typed));
		return offered.length > 0 ? offered.map((argument) => ({ value: `${word} ${argument}`, label: argument })) : null;
	} catch {
		return null;
	}
}

export function registerCommands(pi: ExtensionAPI, bus: SessionBus): void {
	pi.registerCommand(COMMAND_NAME, {
		description: `Open the bus board: sessions, unread mail, and path claims; ${SESSIONS_WORDS.map((entry) => `${entry.word} ${entry.argument} ${entry.what}`).join("; ")}`,
		getArgumentCompletions: (prefix: string) => completions(bus, prefix),
		handler: async (args, ctx) => {
			const [first = "", ...rest] = args.trim().split(/\s+/).filter(Boolean);
			const word = first.toLowerCase();
			const entry = SESSIONS_WORDS.find((candidate) => candidate.word === word);
			if (entry !== undefined) {
				await entry.run(ctx, bus, rest);
				return;
			}
			// A stray word asked for the board before it asked for anything else, so it is told which
			// words exist and then given what it opened: refusing would take away the door it stood at.
			if (word !== "") {
				ctx.ui.notify(`sessions: no word "${sanitizeLine(word)}" — try ${usageLine()}; opening the board`, "warning");
			}
			await open(ctx, pi, bus);
		},
	});
}
