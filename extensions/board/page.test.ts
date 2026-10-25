/**
 * The page's lifecycle over a real socket: start, serve, stop.
 *
 * The server is the shipped one on an OS-chosen port, so the cases cover what only a
 * socket can: the token in the opened URL, the document and the snapshot on the wire, a
 * write refused for every method a browser could make one with, and `close()` really
 * closing.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { boardHarness } from "../../test/helpers/board.ts";
import { tempDir } from "../../test/helpers/env.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { settle, waitFor } from "../../test/helpers/process.ts";
import { type PagePointer, type ProbeFetch, readPointer, PAGE_FILE } from "../../lib/board/page-pointer.ts";
import { createBoardPage, IDLE_STOP_MS, type PageStart } from "./page.ts";
import type { BoardConfig } from "./config.ts";
import type { BoardSession } from "../../lib/board/session.ts";

const temps = makeTempTracker();
const blockers: Server[] = [];
afterAll(() => {
	for (const blocker of blockers.splice(0)) blocker.close();
	temps.flush();
});

const NOW = 50_000;

/** A page over a temp store, with a recorded browser open and an OS-chosen port. */
function harness(
	options: {
		cwd?: string;
		agentDir?: string;
		probe?: ProbeFetch;
		sessionName?: string;
		config?: (cwd: string) => BoardConfig;
	} = {},
) {
	const { config = () => ({ port: 0 }), ...boardOptions } = options;
	const board = boardHarness({ now: NOW, track: temps.track, ...boardOptions });
	const opened: string[] = [];
	const page = createBoardPage(board.runtime, {
		pickPort: () => 0,
		open: (url) => opened.push(url),
		idleMs: 40,
		// The default section, stated rather than read: an ambient global document must
		// not decide which port a case serves on.
		config,
		...(options.probe === undefined ? {} : { probe: options.probe }),
	});
	return { page, ctx: board.ctx, opened, notifications: board.notifications, cwd: board.cwd, runtime: board.runtime };
}

/**
 * A port an `http` server has held. `keep` leaves it listening and tears it down with
 * the suite; the default closes it, so the port is free for the page to bind.
 */
async function portOfServer(keep: boolean): Promise<number> {
	const blocker = createServer(() => {});
	if (keep) blockers.push(blocker);
	const port = await new Promise<number>((resolve) => {
		blocker.listen(0, "127.0.0.1", () => {
			const address = blocker.address();
			resolve(typeof address === "object" && address ? address.port : 0);
		});
	});
	if (!keep) await new Promise<void>((resolve) => blocker.close(() => resolve()));
	return port;
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
	const body = (await (await fetch(`http://127.0.0.1:${port}/api/board?token=${token}`)).json()) as {
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
		const { page, ctx, cwd, runtime } = harness();
		await seedBus(runtime, cwd, [
			{ id: "s-core", label: "billing-core", mode: "tui", lastSeen: NOW - 1_000 },
			{ id: "s-lead", label: "billing-lead", mode: "tui", lastSeen: NOW },
		]);
		const status = served(await page.start(ctx));
		const snapshot = JSON.parse(
			await (await fetch((status.url ?? "").replace("/?token=", "/api/board?token="))).text(),
		);
		expect(snapshot.teammates).toEqual([
			{ label: "billing-core", state: "live", seen: NOW - 1_000, mail: 0, you: false },
			{ label: "billing-lead", state: "live", seen: NOW, mail: 0, you: true },
		]);
		await page.stop(ctx);
	});

	test("says nothing about the roster when no session has ever joined here", async () => {
		const { page, ctx } = harness();
		const status = served(await page.start(ctx));
		const snapshot = JSON.parse(
			await (await fetch((status.url ?? "").replace("/?token=", "/api/board?token="))).text(),
		);
		expect(snapshot.teammates).toBeUndefined();
		await page.stop(ctx);
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
		expect(await document.text()).toContain('data-view="board"');

		const snapshot = JSON.parse(await (await fetch(base.replace("/?token=", "/api/board?token="))).text());
		// The page writes as its seat, and marks the reader's own row from the session.
		expect(snapshot.me).toEqual({ id: "board:team-lead", label: "team-lead" });
		expect(snapshot.session.label).toBe("billing-lead");
		expect(snapshot.counts.total).toBe(0);

		const token = new URL(base).searchParams.get("token") ?? "";
		// The token opens the page and nothing else: a write is refused by the method list,
		// before the store is touched, so no route can land one by accident.
		const refused = await fetch(`http://127.0.0.1:${status.port}/api/cards?token=${token}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ title: "Billing webhook accepts orders", paths: ["src/billing"] }),
		});
		expect(refused.status).toBe(405);
		expect(refused.headers.get("allow")).toBe("GET, HEAD");
		expect(await readCards(status.port, token)).toEqual([]);

		await page.stop(ctx);
	});

	test("opens the Team tab when asked for it", async () => {
		const { page, ctx, opened } = harness();
		await page.start(ctx, "team");
		expect(opened[0]).toContain("view=team");
		const document = await fetch(opened[0] ?? "");
		expect(await document.text()).toContain('data-view="team"');
		await page.stop(ctx);
	});

	test("publishes the chip, and clears it on stop", async () => {
		const { page, ctx } = harness();
		const status = served(await page.start(ctx));
		expect(ctx.statuses.get("board")).toContain(String(status.port));
		await page.stop(ctx);
		expect(ctx.statuses.has("board")).toBe(false);
	});

	test("a second start reuses the running page", async () => {
		const { page, ctx, opened } = harness();
		const first = served(await page.start(ctx));
		const second = served(await page.start(ctx));
		expect(second.port).toBe(first.port);
		expect(opened).toHaveLength(1);
		await page.stop(ctx);
	});

	test("stops idempotently, and reports whether it was running", async () => {
		const { page, ctx } = harness();
		expect(await page.stop(ctx)).toBe(false);
		await page.start(ctx);
		expect(await page.stop(ctx)).toBe(true);
		expect(await page.stop(ctx)).toBe(false);
		expect(page.status().running).toBe(false);
	});
});

describe("a pinned port", () => {
	test("serves on the port the board section pins", async () => {
		const port = await portOfServer(false);
		const { page, ctx, opened } = harness({ config: () => ({ port }) });
		const status = served(await page.start(ctx));
		expect(status.port).toBe(port);
		// The bookmark is the point: the URL the browser was opened at is the pinned port.
		expect(opened[0]).toContain(`127.0.0.1:${port}/`);
		await page.stop(ctx);
	});

	test("a pinned port that is taken fails the start, naming the setting", async () => {
		const port = await portOfServer(true);
		const { page, ctx, notifications, cwd, runtime } = harness({ config: () => ({ port }) });
		expect((await page.start(ctx)).kind).toBe("failed");
		const said = notifications.join("\n");
		expect(said).toContain(`port ${port} is in use`);
		expect(said).toContain("bytefly.json board section");
		// No fallback and no note: a page that never bound must not leave one to probe.
		expect(await noteOf(runtime, cwd)).toBeUndefined();
		expect(page.status()).toEqual({ running: false });
	});
});

describe("the page this repository already serves", () => {
	test("a second session attaches to it instead of serving a second one", async () => {
		const agentDir = temps.track(tempDir("pi-agent-"));
		const cwd = temps.track(tempDir("pi-repo-"));
		const lead = harness({ cwd, agentDir });
		const servedFirst = served(await lead.page.start(lead.ctx));
		const note = await noteOf(lead.runtime, cwd);
		expect(note?.port).toBe(servedFirst.port);
		// One token: the note carries the page's own, and holding it cannot change a card.
		expect(note?.token).toBe(new URL(servedFirst.url).searchParams.get("token") ?? undefined);

		const peer = harness({ cwd, agentDir });
		const joined = attached(await peer.page.start(peer.ctx));
		expect(joined).toMatchObject({ seat: "team-lead", port: servedFirst.port });
		expect(peer.opened[0]).toBe(`http://127.0.0.1:${servedFirst.port}/?token=${note?.token}`);
		// An attached session serves nothing: nothing to stop, and status says whose page it is.
		expect(await peer.page.stop(peer.ctx)).toBe(false);
		expect(peer.page.status()).toMatchObject({ running: false, attached: true, seat: "team-lead" });
		await lead.page.stop(lead.ctx);
	});

	test("a note nobody answers is replaced by this session's page", async () => {
		const agentDir = temps.track(tempDir("pi-agent-"));
		const cwd = temps.track(tempDir("pi-repo-"));
		const dead = harness({ cwd, agentDir, probe: async () => ({ ok: false }) });
		const status = served(await dead.page.start(dead.ctx));
		expect((await noteOf(dead.runtime, cwd))?.port).toBe(status.port);
		await dead.page.stop(dead.ctx);
	});

	test("losing the race for the note attaches this session to the winner", async () => {
		const agentDir = temps.track(tempDir("pi-agent-"));
		const cwd = temps.track(tempDir("pi-repo-"));
		const lead = harness({ cwd, agentDir });
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
		await lead.page.stop(lead.ctx);
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
		expect(said).toContain("http://127.0.0.1:4781/?token=stale-view-token");
		expect(said).toContain("does not answer");
		expect(said).not.toContain("did not start");
		// And the note is this session's now, so the repository keeps a page.
		expect((await noteOf(dead.runtime, cwd))?.token).not.toBe(stale.token);
		expect(dead.page.status()).toMatchObject({ running: true, port: status.port });
		await dead.page.stop(dead.ctx);
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
		await lead.page.stop(lead.ctx);
		await peer.page.stop(peer.ctx);
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
		expect(blocked.page.status().running).toBe(false);
	});

	test("the note leaves with the page, and only for its own page", async () => {
		const { page, ctx, cwd, runtime } = harness();
		await page.start(ctx);
		expect(await noteOf(runtime, cwd)).toBeDefined();
		await page.stop(ctx);
		expect(await noteOf(runtime, cwd)).toBeUndefined();
		expect(PAGE_FILE).toBe("page.json");
	});

	test("status reports the seat and the tabs watching it", async () => {
		const { page, ctx } = harness();
		const status = served(await page.start(ctx));
		expect(page.status()).toMatchObject({ running: true, seat: "team-lead", port: status.port, watchers: 0 });
		await page.stop(ctx);
	});
});

describe("the idle grace", () => {
	test("closes the page once the last tab has been gone for the grace", async () => {
		const { page, ctx, notifications } = harness();
		// The shipped grace, shortened: the same path a real timer takes.
		const status = served(await page.start(ctx));
		expect(IDLE_STOP_MS).toBe(60_000);
		const token = new URL(status.url ?? "").searchParams.get("token") ?? "";
		const stream = await fetch(`http://127.0.0.1:${status.port}/events?token=${token}`);
		expect(stream.status).toBe(200);
		// The page has a reader; the grace must not be armed yet.
		await settle(150);
		expect(page.status().running).toBe(true);
		await stream.body?.cancel();
		// The stop and the notice are two steps of one idle callback, so the notice is
		// what proves both: `stop` clears the state before it reports.
		await waitFor(() => notifications.length > 0);
		expect(page.status().running).toBe(false);
		expect(notifications).toContain("board: stopped — the last page was closed");
	});
});

describe("closeAll", () => {
	test("closes the page without a context, as a shutdown does", async () => {
		const { page, ctx } = harness();
		const status = served(await page.start(ctx));
		await page.closeAll();
		expect(page.status().running).toBe(false);
		await expect(fetch(status.url ?? "")).rejects.toBeDefined();
	});
});
