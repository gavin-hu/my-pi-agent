/**
 * The page's lifecycle over a real socket: start, serve, stop.
 *
 * The server is the shipped one on an OS-chosen port, so the cases cover what only a
 * socket can: the token in the opened URL, the document and the snapshot on the wire, a
 * write refused for every method a browser could make one with, and `close()` really
 * closing.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { join } from "node:path";
import { boardHarness } from "../../test/helpers/board.ts";
import type { FakePiOptions } from "../../test/helpers/fakes.ts";
import { testMountSource } from "../../test/helpers/serve.ts";
import type { MountSource, MountSpec } from "../../lib/http/index.ts";
import { tempDir } from "../../test/helpers/env.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { settle, waitFor } from "../../test/helpers/process.ts";
import { type PagePointer, type ProbeFetch, readPointer, PAGE_FILE } from "../../lib/board/page-pointer.ts";
import { createBoardPage, IDLE_FIRST_MS, IDLE_STOP_MS, type PageStart } from "./page.ts";
import { CARDS_DIR_NAME } from "../../lib/board/store.ts";
import type { RepeatTimer } from "../../lib/timer.ts";
import type { BoardSession } from "../../lib/board/session.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

const NOW = 50_000;

/** A page over a temp store, with a recorded browser open and an OS-chosen port. */
function harness(
	options: {
		cwd?: string;
		agentDir?: string;
		probe?: ProbeFetch;
		sessionName?: string;
		firstIdleMs?: number;
		/** The git answers, for a directory that is a checkout of a repository. */
		exec?: FakePiOptions["exec"];
		/** The mount source, so a case can count the sockets the page asks for. */
		mount?: MountSource;
		/** The ticker seam, so a case drives the push instead of waiting on a second. */
		interval?: RepeatTimer;
		lead?: string; // the board's `board.lead`: the name the page serves as
	} = {},
) {
	const board = boardHarness({ now: NOW, track: temps.track, ...options });
	const opened: string[] = [];
	const page = createBoardPage(board.runtime, {
		// A real server with no session behind it: the socket `serve` would have handed over.
		mount: options.mount ?? testMountSource(),
		session: () => "s1",
		open: (url) => opened.push(url),
		idleMs: 40,
		...(options.interval === undefined ? {} : { interval: options.interval }),
		...(options.firstIdleMs === undefined ? {} : { firstIdleMs: options.firstIdleMs }),
		...(options.probe === undefined ? {} : { probe: options.probe }),
	});
	return { page, ctx: board.ctx, opened, notifications: board.notifications, cwd: board.cwd, runtime: board.runtime };
}

/** The note a page leaves beside this board's cards. */
async function noteOf(runtime: BoardSession, cwd: string): Promise<PagePointer | undefined> {
	return readPointer((await runtime.store(cwd)).dir);
}

/** The page this session served, or a failure that says why there is none. */
function served(start: PageStart): { port: number; url: string; seat: string } {
	if (start.kind !== "served") throw new Error(`the page was not served here: ${start.kind}`);
	return start;
}

/** The page another session served, or a failure that says why there is none. */
function attached(start: PageStart): { port: number; url: string; seat: string } {
	if (start.kind !== "attached") throw new Error(`the page was not attached to: ${start.kind}`);
	return start;
}

/** The cards the page shows, read over the wire the way the snapshot route answers. */
async function readCards(port: number, token: string): Promise<Array<{ id: string; status: string }>> {
	const body = (await (await fetch(`http://127.0.0.1:${port}/board/api/board?token=${token}`)).json()) as {
		lanes: Array<{ cards: Array<{ id: string; status: string }> }>;
	};
	return body.lanes.flatMap((lane) => lane.cards);
}

describe("the roster", () => {
	/** The bus directory this page reads, laid out the way `session-bus` lays one out. */
	async function seedBus(runtime: BoardSession, cwd: string, records: object[]): Promise<void> {
		const dir = join(await runtime.busDir(cwd), "sessions");
		mkdirSync(dir, { recursive: true });
		for (const [index, record] of records.entries()) writeFileSync(join(dir, `s${index}.json`), JSON.stringify(record));
	}

	test("names the bus's sessions on the snapshot", async () => {
		const { page, ctx, cwd, runtime } = harness({ lead: "team-lead" });
		await seedBus(runtime, cwd, [
			{ id: "s-core", label: "team-agent-score", mode: "tui", lastSeen: NOW - 1_000 },
			{ id: "s-lead", label: "team-lead", mode: "tui", lastSeen: NOW },
		]);
		const status = served(await page.start(ctx));
		const snapshot = JSON.parse(
			await (await fetch((status.url ?? "").replace("/?token=", "/api/board?token="))).text(),
		);
		// The page is the seat, so the seat's row is the one marked `you`.
		expect(snapshot.teammates).toEqual([
			{ label: "team-agent-score", state: "live", seen: NOW - 1_000, mail: 0, you: false },
			{ label: "team-lead", state: "live", seen: NOW, mail: 0, you: true },
		]);
		await page.stop();
	});

	test("says nothing about the roster when no session has ever joined here", async () => {
		const { page, ctx } = harness();
		const status = served(await page.start(ctx));
		const snapshot = JSON.parse(
			await (await fetch((status.url ?? "").replace("/?token=", "/api/board?token="))).text(),
		);
		expect(snapshot.teammates).toBeUndefined();
		await page.stop();
	});
});

describe("start", () => {
	test("serves the document and the snapshot, and refuses to write", async () => {
		const { page, ctx, opened } = harness();
		const status = served(await page.start(ctx));
		expect(status.port).toBeGreaterThan(0);
		// The opened URL carries the credential the page needs, and nothing else does.
		expect(opened[0]).toContain("?token=");
		const base = status.url ?? "";

		const document = await fetch(base);
		expect(document.status).toBe(200);
		// The toolbar names the repository the page is a board of, so the document is readable
		// before the first frame; nothing in it names a seat.
		const html = await document.text();
		expect(html).toContain('data-view="board"');
		expect(html).toContain('id="board-repo"');

		const snapshot = JSON.parse(await (await fetch(base.replace("/?token=", "/api/board?token="))).text());
		// The page shows no identity of its own: the seat is the roster row it marks `you`.
		expect(snapshot).not.toHaveProperty("me");
		expect(snapshot).not.toHaveProperty("session");
		expect(snapshot.total).toBe(0);
		expect(snapshot.lanes.map((lane: { key: string }) => lane.key)).toEqual([
			"backlog",
			"plan",
			"execute",
			"blocked",
			"done",
		]);

		const token = new URL(base).searchParams.get("token") ?? "";
		// The token opens the page and nothing else: a write is refused by the method list,
		// before the store is touched, so no route can land one by accident.
		const refused = await fetch(`http://127.0.0.1:${status.port}/board/api/cards?token=${token}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ title: "Billing webhook accepts orders", paths: ["src/billing"] }),
		});
		expect(refused.status).toBe(405);
		expect(refused.headers.get("allow")).toBe("GET, HEAD");
		expect(await readCards(status.port, token)).toEqual([]);

		await page.stop();
	});

	test("opens the Team tab when asked for it", async () => {
		const { page, ctx, opened } = harness();
		await page.start(ctx, "team");
		expect(opened[0]).toContain("view=team");
		const document = await fetch(opened[0] ?? "");
		expect(await document.text()).toContain('data-view="team"');
		await page.stop();
	});

	test("publishes no chip of its own, because the port belongs to the session", async () => {
		const { page, ctx } = harness();
		served(await page.start(ctx));
		// `serve` draws the one port chip; a second chip for the same number is the
		// duplication this page stopped making.
		expect(ctx.statuses.has("board")).toBe(false);
		expect(ctx.statuses.size).toBe(0);
		await page.stop();
	});

	test("a second start reuses the running page and summons it again", async () => {
		const { page, ctx, opened } = harness();
		const first = served(await page.start(ctx));
		const second = served(await page.start(ctx));
		expect(second.port).toBe(first.port);
		// The page is one; the command is how it is shown, so a closed tab is one `/board`
		// away from being open again.
		expect(opened).toEqual([
			`http://127.0.0.1:${first.port}/board/?token=${new URL(first.url).searchParams.get("token")}`,
			opened[1],
		]);
		expect(opened).toHaveLength(2);
		await page.stop();
	});

	test("stops idempotently, and reports whether it was running", async () => {
		const { page, ctx } = harness();
		expect(await page.stop()).toBe(false);
		await page.start(ctx);
		expect(await page.stop()).toBe(true);
		expect(await page.stop()).toBe(false);
		expect((await page.status()).running).toBe(false);
	});
});

describe("the page this repository already serves", () => {
	test("a second session attaches to it instead of serving a second one", async () => {
		const agentDir = temps.track(tempDir("pi-agent-"));
		const cwd = temps.track(tempDir("pi-repo-"));
		const lead = harness({ cwd, agentDir, lead: "team-lead" });
		const servedFirst = served(await lead.page.start(lead.ctx));
		const note = await noteOf(lead.runtime, cwd);
		expect(note?.port).toBe(servedFirst.port);
		// One token: the note carries the page's own, and holding it cannot change a card.
		expect(note?.token).toBe(new URL(servedFirst.url).searchParams.get("token") ?? undefined);

		const peer = harness({ cwd, agentDir, lead: "team-lead" });
		const joined = attached(await peer.page.start(peer.ctx));
		expect(joined).toMatchObject({ seat: "team-lead", port: servedFirst.port });
		expect(peer.opened[0]).toBe(`http://127.0.0.1:${servedFirst.port}/board/?token=${note?.token}`);
		// An attached session serves nothing: nothing to stop, and status says whose page it is.
		expect(await peer.page.stop()).toBe(false);
		expect(await peer.page.status()).toMatchObject({ running: false, attached: true, seat: "team-lead" });
		await lead.page.stop();
	});

	test("a session in another worktree opens the one page, and asks for no socket", async () => {
		const agentDir = temps.track(tempDir("pi-agent-"));
		const main = temps.track(tempDir("pi-repo-"));
		const worktree = temps.track(tempDir("pi-wt-"));
		// One repository, two checkouts: both resolve the same common git directory, which is
		// what files them under one board and one note.
		const common = join(main, ".git");
		const exec: FakePiOptions["exec"] = async (_command, args, options) => {
			if (args.includes("--git-common-dir")) return { stdout: `${common}\n`, stderr: "", code: 0 };
			const cwd = options?.cwd ?? main;
			return { stdout: `${cwd}\n`, stderr: "", code: 0 };
		};
		/** A mount source that counts what the page asked for, then defers to a real server. */
		const counting = () => {
			const real = testMountSource();
			const asked: MountSpec[] = [];
			const mount: MountSource = (spec) => {
				asked.push(spec);
				return real(spec);
			};
			return { mount, asked };
		};

		const lead = harness({ cwd: main, agentDir, exec });
		const first = served(await lead.page.start(lead.ctx));
		// One board, filed under the shared key, with one note beside its cards.
		const leadStore = await lead.runtime.store(main);
		const peerRuntime = boardHarness({ cwd: worktree, agentDir, exec, now: NOW, track: temps.track });
		expect((await peerRuntime.runtime.store(worktree)).dir).toBe(leadStore.dir);

		const peerSocket = counting();
		const peer = harness({ cwd: worktree, agentDir, exec, mount: peerSocket.mount });
		const joined = attached(await peer.page.start(peer.ctx));
		expect(joined.port).toBe(first.port);
		// Attaching is not serving: the peer opened no prefix, so the session's one socket
		// stayed the lead's.
		expect(peerSocket.asked).toEqual([]);
		await lead.page.stop();
	});

	test("a note nobody answers is replaced by this session's page", async () => {
		const agentDir = temps.track(tempDir("pi-agent-"));
		const cwd = temps.track(tempDir("pi-repo-"));
		const dead = harness({ cwd, agentDir, probe: async () => ({ ok: false }) });
		const status = served(await dead.page.start(dead.ctx));
		expect((await noteOf(dead.runtime, cwd))?.port).toBe(status.port);
		await dead.page.stop();
	});

	test("losing the race for the note attaches this session to the winner", async () => {
		const agentDir = temps.track(tempDir("pi-agent-"));
		const cwd = temps.track(tempDir("pi-repo-"));
		const lead = harness({ cwd, agentDir, lead: "team-lead" });
		const first = served(await lead.page.start(lead.ctx));
		// Somebody else's note is there, but the page is not answering yet: this session
		// serves, loses the exclusive write, and then finds the winner answering.
		let answers = 0;
		const peer = harness({
			cwd,
			agentDir,
			probe: async () => {
				answers++;
				return { ok: answers > 1 };
			},
		});
		const joined = attached(await peer.page.start(peer.ctx));
		expect(joined.port).toBe(first.port);
		expect(peer.notifications.join("\n")).not.toContain("did not start");
		await lead.page.stop();
	});

	test("a note nobody answers is said, then taken over", async () => {
		const agentDir = temps.track(tempDir("pi-agent-"));
		const cwd = temps.track(tempDir("pi-repo-"));
		const dead = harness({ cwd, agentDir, probe: async () => ({ ok: false }) });
		const store = await dead.runtime.store(cwd);
		await store.ensure();
		// A page that wrote its note and then died: nothing answers on that port, and the
		// name it holds would keep every later `/board` from serving either.
		const stale: PagePointer = {
			port: 4781,
			token: "stale-view-token",
			seat: { label: "gone-lead" },
			startedAt: NOW - 1000,
		};
		writeFileSync(join(store.dir, PAGE_FILE), JSON.stringify(stale));
		const status = served(await dead.page.start(dead.ctx));
		const said = dead.notifications.join("\n");
		// A notice that names the URL, not an error: what a reader needs is where that page was.
		expect(said).toContain("http://127.0.0.1:4781/board/?token=stale-view-token");
		expect(said).toContain("does not answer");
		expect(said).not.toContain("did not start");
		// And the note is this session's now, so the repository keeps a page.
		expect((await noteOf(dead.runtime, cwd))?.token).not.toBe(stale.token);
		expect(await dead.page.status()).toMatchObject({ running: true, port: status.port });
		await dead.page.stop();
	});

	test("two sessions starting together on a dead note end up on one page", async () => {
		const agentDir = temps.track(tempDir("pi-agent-"));
		const cwd = temps.track(tempDir("pi-repo-"));
		// A page that died and left its note behind, and a probe that answers for any live
		// page but that port — which is what a real probe would have said.
		const probe = async (url: string) => ({ ok: !url.includes(":5068/") });
		const lead = harness({ cwd, agentDir, probe });
		const store = await lead.runtime.store(cwd);
		await store.ensure();
		writeFileSync(
			join(store.dir, PAGE_FILE),
			JSON.stringify({ port: 5068, token: "dead".repeat(8), seat: { label: "team-lead" }, startedAt: NOW - 1_000 }),
		);
		const peer = harness({ cwd, agentDir, probe });
		const [first, second] = await Promise.all([lead.page.start(lead.ctx), peer.page.start(peer.ctx)]);
		// One serves, one views the page that served: neither is told the page did not start.
		expect([first.kind, second.kind].sort()).toEqual(["attached", "served"]);
		const said = [...lead.notifications, ...peer.notifications].join("\n");
		expect(said).not.toContain("did not start");
		const servedPort = first.kind === "served" ? first.port : second.kind === "served" ? second.port : -1;
		const viewer = first.kind === "attached" ? first : second.kind === "attached" ? second : undefined;
		expect(viewer?.port).toBe(servedPort);
		await lead.page.stop();
		await peer.page.stop();
	});

	test("a note this build cannot read is named, not blamed on a session", async () => {
		const agentDir = temps.track(tempDir("pi-agent-"));
		const cwd = temps.track(tempDir("pi-repo-"));
		const blocked = harness({ cwd, agentDir, probe: async () => ({ ok: false }) });
		const store = await blocked.runtime.store(cwd);
		await store.ensure();
		// A file at the note's name that is not a pointer: nothing to attach to, and nothing
		// this build may take over.
		writeFileSync(join(store.dir, PAGE_FILE), "{ not a pointer");
		const start = await blocked.page.start(blocked.ctx);
		expect(start.kind).toBe("failed");
		const said = blocked.notifications.join("\n");
		// The reader is told which file to remove. "Another session is serving" would be a
		// guess about a session that never existed.
		expect(said).toContain(join(store.dir, PAGE_FILE));
		expect(said).toContain("remove it to serve this board");
		expect(said).not.toContain("another session is serving");
		expect((await blocked.page.status()).running).toBe(false);
	});

	test("the note leaves with the page, and only for its own page", async () => {
		const { page, ctx, cwd, runtime } = harness();
		await page.start(ctx);
		expect(await noteOf(runtime, cwd)).toBeDefined();
		await page.stop();
		expect(await noteOf(runtime, cwd)).toBeUndefined();
		expect(PAGE_FILE).toBe("page.json");
	});

	test("attaches on the cheap liveness answer, not on the snapshot being free", async () => {
		const agentDir = temps.track(tempDir("pi-agent-"));
		const cwd = temps.track(tempDir("pi-repo-"));
		const lead = harness({ cwd, agentDir, lead: "team-lead" });
		const first = served(await lead.page.start(lead.ctx));
		// A peer whose probe only ever gets the ping through — which is what a page busy
		// answering its own browser looks like when the question is the snapshot.
		const asked: string[] = [];
		const peer = harness({
			cwd,
			agentDir,
			probe: async (target) => {
				asked.push(new URL(target).pathname);
				return { ok: true };
			},
		});
		const joined = attached(await peer.page.start(peer.ctx));
		expect(joined.port).toBe(first.port);
		expect(asked).toContain("/board/api/ping");
		expect(asked).not.toContain("/board/api/board");
		await lead.page.stop();
	});

	test("names a watched note that answers nobody, and drops it when asked", async () => {
		const agentDir = temps.track(tempDir("pi-agent-"));
		const cwd = temps.track(tempDir("pi-repo-"));
		const lead = harness({ cwd, agentDir, lead: "team-lead" });
		const first = served(await lead.page.start(lead.ctx));
		let answering = true;
		const viewer = harness({ cwd, agentDir, probe: async () => ({ ok: answering }) });
		attached(await viewer.page.start(viewer.ctx));
		expect(await viewer.page.status()).toMatchObject({ attached: true, port: first.port });

		// The lead's session ends: the note stays, the page does not.
		answering = false;
		const stale = await viewer.page.status();
		expect(stale).toMatchObject({ running: false, attached: true, stale: true, seat: "team-lead", port: first.port });

		// Dropping it is a token-safe clear: the note in this repository is the dead one.
		expect(await viewer.page.dropStale(viewer.ctx)).toBe(true);
		expect(await noteOf(viewer.runtime, cwd)).toBeUndefined();
		expect(await viewer.page.status()).toEqual({ running: false });
		await lead.page.stop();
	});

	test("leaves a note that answers to its owner", async () => {
		const agentDir = temps.track(tempDir("pi-agent-"));
		const cwd = temps.track(tempDir("pi-repo-"));
		const lead = harness({ cwd, agentDir });
		const first = served(await lead.page.start(lead.ctx));
		const viewer = harness({ cwd, agentDir });
		attached(await viewer.page.start(viewer.ctx));

		// The lead is alive: stop is still the owner's decision, and no note is dropped.
		expect(await viewer.page.dropStale(viewer.ctx)).toBe(false);
		expect((await noteOf(viewer.runtime, cwd))?.port).toBe(first.port);
		await lead.page.stop();
	});

	test("status reports the seat and the tabs watching it", async () => {
		const { page, ctx } = harness({ lead: "team-lead" });
		const status = served(await page.start(ctx));
		expect(await page.status()).toMatchObject({ running: true, seat: "team-lead", port: status.port, watchers: 0 });
		await page.stop();
	});
});

describe("the idle grace", () => {
	test("closes the page once the last tab has been gone for the grace", async () => {
		const { page, ctx, notifications } = harness();
		// The shipped grace, shortened: the same path a real timer takes.
		const status = served(await page.start(ctx));
		expect(IDLE_STOP_MS).toBe(60_000);
		const token = new URL(status.url ?? "").searchParams.get("token") ?? "";
		const stream = await fetch(`http://127.0.0.1:${status.port}/board/events?token=${token}`);
		expect(stream.status).toBe(200);
		// The page has a reader; the grace must not be armed yet.
		await settle(150);
		expect((await page.status()).running).toBe(true);
		await stream.body?.cancel();
		// The stop and the notice are two steps of one idle callback, so the notice is
		// what proves both: `stop` clears the state before it reports.
		await waitFor(() => notifications.length > 0);
		expect((await page.status()).running).toBe(false);
		expect(notifications).toContain("board: stopped — the last page was closed");
	});
});

describe("a board the page cannot read", () => {
	test("drops the frame, says so once, and keeps serving", async () => {
		const ticks: Array<() => void> = [];
		const interval: RepeatTimer = (_ms, tick) => {
			ticks.push(tick);
			return () => {};
		};
		const { page, ctx, notifications, runtime, cwd } = harness({ interval });
		const store = await runtime.store(cwd);
		const status = served(await page.start(ctx));
		const token = new URL(status.url ?? "").searchParams.get("token") ?? "";
		const stream = await fetch(`http://127.0.0.1:${status.port}/board/events?token=${token}`);
		expect(stream.status).toBe(200);
		const reader = stream.body?.getReader();
		// The attach frame has arrived, so the tab is counted and a tick is a read.
		await reader?.read();
		// The pile becomes a file: every read of it fails, and not with the `ENOENT` a board
		// that is simply gone answers with — so this is the failure the ticker cannot absorb.
		const cards = join(store.dir, CARDS_DIR_NAME);
		rmSync(cards, { recursive: true, force: true });
		writeFileSync(cards, "");
		ticks.at(-1)?.();
		await waitFor(() => notifications.some((line) => line.includes("cannot read the board")));
		expect(notifications.join("\n")).toContain("board: the page cannot read the board");
		// A failed frame is a dropped frame, not a stopped page: the mount is still serving.
		expect((await page.status()).running).toBe(true);
		// One notice, not one per tick: a failure that persists must not fill the transcript.
		ticks.at(-1)?.();
		await settle(30);
		expect(notifications.filter((line) => line.includes("cannot read the board"))).toHaveLength(1);
		// The board comes back, and so does the page's reading of it: no `/board` needed.
		rmSync(cards, { force: true });
		mkdirSync(cards, { recursive: true });
		ticks.at(-1)?.();
		await settle(30);
		expect((await page.status()).running).toBe(true);
		await reader?.cancel();
		await page.stop();
	});
});

describe("a start that cannot write the board", () => {
	test("fails with a reason, and leaves no listener or note behind", async () => {
		const board = boardHarness({ now: NOW, track: temps.track });
		const store = await board.runtime.store(board.cwd);
		// A file where the board's directory has to be: `ensure` fails before a port is
		// bound, and the same `catch` covers a seat write that fails after it.
		mkdirSync(dirname(store.dir), { recursive: true });
		writeFileSync(store.dir, "");
		const page = createBoardPage(board.runtime, {
			mount: testMountSource(),
			session: () => "s1",
			open: () => {},
			idleMs: 40,
		});

		const start = await page.start(board.ctx);
		expect(start.kind).toBe("failed");
		expect(board.notifications.join("\n")).toContain("board: the page did not start");
		expect((await page.status()).running).toBe(false);
		expect(await readPointer(store.dir)).toBeUndefined();
	});
});

describe("a page no tab ever opened", () => {
	test("closes on its first grace, and says which grace it was", async () => {
		const { page, ctx, notifications, cwd, runtime } = harness({ firstIdleMs: 20 });
		const status = served(await page.start(ctx));
		// Two minutes in the product, twenty milliseconds here: the same path.
		expect(IDLE_FIRST_MS).toBe(120_000);
		// The browser never came up: no stream is opened against this page at all.
		await waitFor(() => notifications.length > 0);
		expect((await page.status()).running).toBe(false);
		expect(notifications).toContain("board: stopped — no tab ever opened; /board starts it again");
		// And nothing is left behind for the next session to probe.
		expect(await noteOf(runtime, cwd)).toBeUndefined();
		await expect(fetch(status.url ?? "")).rejects.toBeDefined();
	});
});

describe("closeAll", () => {
	test("closes the page without a context, as a shutdown does", async () => {
		const { page, ctx } = harness();
		const status = served(await page.start(ctx));
		await page.closeAll();
		expect((await page.status()).running).toBe(false);
		await expect(fetch(status.url ?? "")).rejects.toBeDefined();
	});
});
