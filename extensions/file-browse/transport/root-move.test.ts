/**
 * The root moving under a served page: what the server says, and what the page does.
 *
 * A worktree switch changes the session's effective cwd, and a page still serving the
 * checkout the session left is worse than no page. `file-browse` re-roots its mount in
 * place — the prefix and port are the session's, not the root's — and tells every attached
 * stream that the root moved. The frame and the listener are one contract, so this suite
 * proves both ends of it: the frame the server writes, and the reply the client script
 * gives it.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../config/config.ts";
import { movedFrameOf } from "../live/live.ts";
import { CLIENT_JS } from "../view/client.ts";
import type { FileServer } from "./server.ts";
import { makeFixture, servePage, type Fixture } from "../../../test/helpers/fixtures/file-browse.ts";

let fixture: Fixture | undefined;
let server: FileServer | undefined;

afterEach(async () => {
	await server?.close();
	server = undefined;
	fixture?.remove();
	fixture = undefined;
});

describe("the served root moving", () => {
	test("names the root in a frame the page can act on", () => {
		// Not a status frame: the served root is what changed, and no page renders another
		// tree's listing into the document it already drew.
		expect(movedFrameOf("/repo/.pi/worktrees/feature")).toBe(
			'event: moved\ndata: {"root":"/repo/.pi/worktrees/feature"}\n\n',
		);
	});

	test("serves the new root from the same URL, and tells every open page", async () => {
		fixture = makeFixture();
		const started = await servePage(fixture.root, { ...DEFAULT_CONFIG, autoOpen: false });
		server = started;
		expect(await (await fetch(started.url)).text()).toContain("a.txt");

		const streams = [await fetch(`${started.url}events`), await fetch(`${started.url}events`)];
		const readers = streams.map((reply) => reply.body?.getReader());
		for (const reader of readers) await reader?.read();

		started.reroot(join(fixture.root, "sub"), { git: async () => ({ branch: "feature" }) });

		// One announcement reaches every attached page: the channel fans out, the page
		// reloads, and it is the only page that moves.
		for (const reader of readers) {
			const moved = new TextDecoder().decode((await reader?.read())?.value);
			expect(moved).toContain("event: moved");
			expect(moved).toContain(JSON.stringify({ root: join(fixture.root, "sub") }));
		}

		expect(started.root).toBe(join(fixture.root, "sub"));
		expect(new URL(started.url).port).toBe(String(started.port));
		const page = await (await fetch(started.url)).text();
		expect(page).toContain("b.md");
		expect(page).not.toContain("a.txt");
		expect((await fetch(`${started.url}view/b.md`)).status).toBe(200);
	});

	test("leaves the page on its root when the new one cannot be served", async () => {
		fixture = makeFixture();
		server = await servePage(fixture.root, { ...DEFAULT_CONFIG, autoOpen: false });

		// A root that is gone — a worktree removed under the page — is refused before
		// anything is swapped, so the page keeps answering rather than failing.
		expect(() => server?.reroot(join(fixture!.root, "gone"))).toThrow();
		expect(server.root).toBe(fixture.root);
		expect(await (await fetch(server.url)).text()).toContain("a.txt");
	});

	test("the page's own script reloads on that frame, and draws its chips from the status one", () => {
		expect(movedFrameOf("/x").startsWith("event: moved\n")).toBe(true);
		// The one stream client names both events a page wants, and the page reloads on the one
		// it cannot paint rather than drawing a document of the tree it has left.
		expect(CLIENT_JS).toContain('events: ["status", "moved"]');
		expect(CLIENT_JS).toContain('if (event.type === "moved") {');
		expect(CLIENT_JS).toContain("window.location.reload()");
	});
});
