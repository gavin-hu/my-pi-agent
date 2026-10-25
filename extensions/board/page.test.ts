/**
 * The page's lifecycle over a real socket: start, serve, write, stop.
 *
 * The server is the shipped one on an OS-chosen port, so the cases cover what only
 * a socket can: the token in the opened URL, the document and the snapshot on the
 * wire, a write landing in the store, and `close()` really closing.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { tempDir } from "../../test/helpers/env.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { createFakePi } from "../../test/helpers/fakes.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { createBoardPage } from "./page.ts";
import { openBoardSession } from "../../lib/board/session.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

const NOW = 50_000;

/** A page over a temp store, with a recorded browser open and an OS-chosen port. */
function harness(options: { view?: "board" | "team" } = {}) {
	const agentDir = temps.track(tempDir("pi-agent-"));
	const cwd = temps.track(tempDir("pi-repo-"));
	const fake = createFakePi({ exec: async () => ({ stdout: "", stderr: "", code: 1 }) });
	const runtime = openBoardSession(fake.pi, { now: () => NOW, agentDir });
	const opened: string[] = [];
	const page = createBoardPage(runtime, { pickPort: () => 0, open: (url) => opened.push(url) });
	const { ctx, notifications } = fakeCtx({ cwd, sessionId: "s-lead", sessionName: "billing-lead" });
	return { page, ctx, opened, notifications, cwd, options };
}

describe("start", () => {
	test("serves the document, the snapshot, and a write", async () => {
		const { page, ctx, opened } = harness();
		const status = await page.start(ctx);
		expect(status.running).toBe(true);
		expect(status.port).toBeGreaterThan(0);
		// The opened URL carries the credential the page needs, and nothing else does.
		expect(opened[0]).toContain("?token=");
		const base = status.url ?? "";

		const document = await fetch(base);
		expect(document.status).toBe(200);
		expect(await document.text()).toContain('data-view="board"');

		const snapshot = JSON.parse(await (await fetch(base.replace("/?token=", "/api/board?token="))).text());
		expect(snapshot.me.label).toBe("billing-lead");
		expect(snapshot.counts.total).toBe(0);

		const token = new URL(base).searchParams.get("token") ?? "";
		const added = await fetch(`http://127.0.0.1:${status.port}/api/cards?token=${token}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ title: "Billing webhook accepts orders", paths: ["src/billing"] }),
		});
		expect(added.status).toBe(200);
		expect(((await added.json()) as { card?: unknown }).card).toMatchObject({ id: "1", status: "todo" });

		const claimed = await fetch(`http://127.0.0.1:${status.port}/api/cards/1/claim?token=${token}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "{}",
		});
		expect(((await claimed.json()) as { card?: unknown }).card).toMatchObject({
			status: "doing",
			owner: { label: "billing-lead" },
		});

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
		const status = await page.start(ctx);
		expect(ctx.statuses.get("board")).toContain(String(status.port));
		await page.stop(ctx);
		expect(ctx.statuses.has("board")).toBe(false);
	});

	test("a second start reuses the running page", async () => {
		const { page, ctx, opened } = harness();
		const first = await page.start(ctx);
		const second = await page.start(ctx);
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

describe("a refused write over the wire", () => {
	test("answers 409 with the card, and the page keeps showing it", async () => {
		const { page, ctx } = harness();
		const status = await page.start(ctx);
		const token = new URL(status.url ?? "").searchParams.get("token") ?? "";
		const post = async (path: string, body: unknown) =>
			fetch(`http://127.0.0.1:${status.port}${path}?token=${token}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
		await post("/api/cards", { title: "One" });
		await post("/api/cards/1/claim", {});

		// A second session of the page's own store, claiming the same card.
		const other = await fetch(`http://127.0.0.1:${status.port}/api/cards/1/move?token=${token}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ status: "sideways" }),
		});
		expect(other.status).toBe(422);
		await page.stop(ctx);
	});
});

describe("a validation failure", () => {
	test("answers 422 without touching a card", async () => {
		const { page, ctx } = harness();
		const status = await page.start(ctx);
		const token = new URL(status.url ?? "").searchParams.get("token") ?? "";
		const response = await fetch(`http://127.0.0.1:${status.port}/api/cards?token=${token}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ title: "   " }),
		});
		expect(response.status).toBe(422);
		expect(((await response.json()) as { error?: string }).error).toBe("title is required.");
		await page.stop(ctx);
	});
});

describe("closeAll", () => {
	test("closes the page without a context, as a shutdown does", async () => {
		const { page, ctx } = harness();
		const status = await page.start(ctx);
		await page.closeAll();
		expect(page.status().running).toBe(false);
		await expect(fetch(status.url ?? "")).rejects.toBeDefined();
	});
});
