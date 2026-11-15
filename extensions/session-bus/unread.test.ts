/**
 * The number a session's row shows, and the calls that move it.
 *
 * `N unread` is the mail a session has *not been told about*: the notice marks a burst told, a
 * read marks what it showed, the persisted cursor survives a restart, and `inbox` is the one call
 * that also deletes. These cases drive the tool, the record it writes, and the count a peer's row
 * reads — the count falling while the body stays on disk is the whole of the card.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { storedName } from "../../lib/session-files.ts";
import { readRoster } from "../../lib/session-roster.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { scratchDir } from "../../test/helpers/env.ts";
import { createFakePi, emit, emitFirst } from "../../test/helpers/fakes.ts";
import { joinBusSession as joins, busToolSession as session } from "../../test/helpers/fixtures/session-bus-tool.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import sessionBus from "./index.ts";
import { createSessionBus, type SessionBus } from "./runtime.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** The number this session's own row carries: what a peer and the page both draw. */
async function unreadOf(bus: SessionBus): Promise<number | undefined> {
	const status = await bus.status();
	return status.sessions.find((row) => row.id === status.me.id)?.unread;
}

/** The extension wired to a runtime, so a case can drive the notice the model reads. */
function wired(dir: string) {
	const fake = createFakePi();
	const bus = createSessionBus({} as ExtensionAPI, {
		dir,
		repo: { root: "/repo", key: "shared" },
		now: () => 1_000,
		heartbeatMs: 0,
		watchMs: 0,
	});
	sessionBus(fake.pi, { bus });
	const { ctx } = fakeCtx({ cwd: "/repo", sessionId: "s1", sessionName: "frontend" });
	return { pi: fake.pi, bus, ctx };
}

describe("the mail a session has not been told about", () => {
	test("a read shows the mail, keeps it, and stops the row counting it", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const frontend = session(dir, "/repo/frontend", "s1", "frontend");
		const backend = session(dir, "/repo/backend", "s2", "backend");
		await joins(frontend);
		await joins(backend);
		await frontend.bus.send({ to: "backend", text: "contract v2" });
		await frontend.bus.send({ to: "backend", text: "and the paths" });
		expect(await unreadOf(backend.bus)).toBe(2);

		const read = await backend.tool.execute("call", { action: "read" }, undefined, undefined, backend.ctx);
		expect(read.isError).toBeFalsy();
		expect(read.details.messages).toHaveLength(2);
		expect(read.content[0]?.text).toContain("contract v2");
		expect(read.content[0]?.text).toContain("Kept in the inbox");

		// Told, not consumed: the count is the peer's, and the bodies are still the inbox's to give.
		expect(await unreadOf(backend.bus)).toBe(0);
		expect((await backend.bus.inbox()).map((message) => message.text)).toEqual(["contract v2", "and the paths"]);
		await frontend.bus.stop();
		await backend.bus.stop();
	});

	test("a read past its limit leaves the rest counted for the next one", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const frontend = session(dir, "/repo/frontend", "s1", "frontend");
		const backend = session(dir, "/repo/backend", "s2", "backend");
		await joins(frontend);
		await joins(backend);
		await frontend.bus.send({ to: "backend", text: "one" });
		await frontend.bus.send({ to: "backend", text: "two" });
		await frontend.bus.send({ to: "backend", text: "three" });

		const read = await backend.tool.execute("call", { action: "read", limit: 1 }, undefined, undefined, backend.ctx);
		expect(read.details.messages.map((message: { text: string }) => message.text)).toEqual(["one"]);
		expect(read.content[0]?.text).toContain("2 more in the inbox");
		expect(await unreadOf(backend.bus)).toBe(2);
		await frontend.bus.stop();
		await backend.bus.stop();
	});

	test("the notice takes the row to zero, and the mail after it counts again", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const frontend = wired(dir);
		const peer = createSessionBus({} as ExtensionAPI, {
			dir,
			repo: { root: "/repo", key: "shared" },
			now: () => 1_000,
			heartbeatMs: 0,
			watchMs: 0,
		});
		const peerCtx = fakeCtx({ cwd: "/repo", sessionId: "s2", sessionName: "backend" }).ctx as ExtensionContext;
		await emit(frontend.pi, "session_start", { type: "session_start" }, frontend.ctx);
		await peer.start(peerCtx);
		await frontend.bus.join({});
		await peer.send({ to: "frontend", text: "contract v2" });
		await frontend.bus.poll();
		expect(await unreadOf(frontend.bus)).toBe(1);

		// The reporter's own path: a notice at the start of the turn, and the send that proves it.
		const notice = await emitFirst(frontend.pi, "before_agent_start", {}, frontend.ctx);
		expect(notice?.message.content).toContain("contract v2");
		expect(await unreadOf(frontend.bus)).toBe(0);
		expect(await frontend.bus.inbox()).toHaveLength(1);

		await peer.send({ to: "frontend", text: "one more" });
		await frontend.bus.poll();
		expect(await unreadOf(frontend.bus)).toBe(1);
		await peer.stop();
		await emit(frontend.pi, "session_shutdown", { type: "session_shutdown" }, frontend.ctx);
	});

	test("a session resumed on an id keeps the cursor that record left", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const frontend = session(dir, "/repo/frontend", "s1", "frontend");
		const backend = session(dir, "/repo/backend", "s2", "backend");
		await joins(frontend);
		await joins(backend);
		await frontend.bus.send({ to: "backend", text: "contract v2" });
		await backend.bus.read(10);
		expect(await unreadOf(backend.bus)).toBe(0);

		// The process stopped, its record did not: a session resumed on that id is the same session,
		// so its old mail is neither counted again nor announced a second time.
		const resumed = session(dir, "/repo/backend", "s2", "backend");
		await resumed.bus.start(resumed.ctx);
		expect(await unreadOf(resumed.bus)).toBe(0);
		expect((await resumed.bus.peek()).mail.map((message) => message.text)).toEqual(["contract v2"]);
		await frontend.bus.stop();
		await backend.bus.stop();
		await resumed.bus.stop();
	});

	test("the Team tab draws the same number as session status", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const frontend = session(dir, "/repo/frontend", "s1", "frontend");
		const backend = session(dir, "/repo/backend", "s2", "backend");
		await joins(frontend);
		await joins(backend);
		await frontend.bus.send({ to: "backend", text: "one" });
		await frontend.bus.send({ to: "backend", text: "two" });
		expect((await readRoster(dir))?.find((row) => row.id === "s2")?.mail).toBe(2);

		await backend.bus.read(1);
		// Two readers, one record: the page reads the file the session writes, so the counts fall
		// together rather than one of them still counting what the other was told.
		expect(await unreadOf(backend.bus)).toBe(1);
		expect((await readRoster(dir))?.find((row) => row.id === "s2")?.mail).toBe(1);
		await frontend.bus.stop();
		await backend.bus.stop();
	});

	test("names a file it cannot read beside the count that file sits inside", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const backend = session(dir, "/repo/backend", "s2", "backend");
		await joins(backend);
		const inbox = join(dir, "inbox", storedName("s2"));
		await mkdir(inbox, { recursive: true });
		await writeFile(join(inbox, "0001-odd.json"), "{", "utf-8");

		// The number counts names, so this file is inside it until its TTL — and the read that
		// could parse it is the one that says so.
		const status = await backend.tool.execute("call", { action: "status" }, undefined, undefined, backend.ctx);
		expect(status.content[0]?.text).toContain("1 unread");
		expect(status.content[0]?.text).toContain("Mail this build cannot read: 0001-odd.json");
		await backend.bus.stop();
	});
});
