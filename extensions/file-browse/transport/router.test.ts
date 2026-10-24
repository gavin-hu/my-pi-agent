/**
 * The routing and runtime capability: request handling and its guards, the
 * loopback server and its live stream, the status snapshot/channel, and the
 * `/browse` command lifecycle.
 *
 * Routers are driven directly for request shapes; only the two server cases open
 * a real loopback socket. The live channel uses an injected ticker, so no test
 * waits on a wall clock.
 */

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { join } from "node:path";
import { type RepeatTimer } from "../../../lib/timer.ts";
import { DEFAULT_CONFIG, LIVE_MAX_CLIENTS, type ServeConfig } from "../config/config.ts";
import type { DiffList, GitDiffProvider } from "../git/git.ts";
import fileBrowser from "../index.ts";
import { changeIndexOf, createLiveChannel, createLiveStatus, frameOf, type LiveClient } from "../live/live.ts";
import { handleRequest, type ServeContext } from "./router.ts";
import { createFileServer, type FileServer } from "./server.ts";
import { ENV_DISABLED_EXTENSIONS } from "../../../lib/env.ts";
import type { ServeResponse } from "../../../lib/http/index.ts";
import { GLYPHS, STATUS_KEYS } from "../../../lib/tui/glyphs.ts";
import { makeClock } from "../../../test/helpers/clock.ts";
import { useEnv, withEnv } from "../../../test/helpers/env.ts";
import { coloringTheme, createFakePi, emit } from "../../../test/helpers/fakes.ts";
import { fakeCtx, makeFixture, runCommand, type Fixture } from "../../../test/helpers/fixtures/file-browse.ts";
import { settle } from "../../../test/helpers/process.ts";

const env = useEnv({ PI_WORKTREE_ROOT: undefined });
afterAll(() => env.restore());

let fixture: Fixture | undefined;
let server: FileServer | undefined;

afterEach(async () => {
	await server?.close();
	server = undefined;
	fixture?.remove();
	fixture = undefined;
});

function text(response: ServeResponse): string {
	return typeof response.body === "string" ? response.body : (response.body ?? Buffer.alloc(0)).toString("utf-8");
}

function context(overrides: Partial<ServeConfig> = {}): ServeContext {
	if (!fixture) fixture = makeFixture();
	return { root: realpathSync(fixture.root), config: { ...DEFAULT_CONFIG, ...overrides } };
}

/** A live status source that answers one idle snapshot. */
function idleStatus() {
	return {
		snapshot: async () => ({ uptimeMs: 0, requests: 0, git: null, changes: null }),
	};
}

const changedFile = { rel: "a.txt", index: " ", worktree: "M", untracked: false };

/** A diff provider answering one changed text file. */
function diffProvider(overrides: Partial<GitDiffProvider> = {}): GitDiffProvider {
	return {
		list: async (mode) => ({
			mode,
			files: [changedFile],
			stat: " a.txt | 1 +\n 1 file changed, 1 insertion(+)",
			insertions: 1,
			deletions: 0,
		}),
		file: async (rel, mode) => ({
			mode,
			rel,
			lines: [
				{ kind: "hunk", text: "@@ -1 +1 @@" },
				{ kind: "del", text: "old", oldNo: 1 },
				{ kind: "add", text: "new", newNo: 1 },
			],
			binary: false,
			truncated: false,
		}),
		...overrides,
	};
}

describe("request routing", () => {
	test("serves the root listing with sort keys", async () => {
		const response = await handleRequest(context(), "GET", "/", {});
		expect(response.status).toBe(200);
		expect(response.headers["Content-Type"]).toContain("text/html");
		const html = text(response);
		expect(html).toContain("read-only");
		expect(html).toContain('data-path="a.txt"');
		expect(html).toContain('data-sort="name"');
		expect(html).toContain('data-dir="1"');
		expect(html).toContain("data-mtime=");
	});

	test("serves a nested directory and a file view", async () => {
		const dir = await handleRequest(context(), "GET", "/browse/sub", {});
		expect(dir.status).toBe(200);
		expect(text(dir)).toContain("b.md");
		expect(text(dir)).toContain("a.txt");

		const file = await handleRequest(context(), "GET", "/view/a.txt", {});
		expect(file.status).toBe(200);
		expect(text(file)).toContain("hello");
	});

	test("renders Markdown with a raw toggle and honors the disabled config", async () => {
		const rendered = await handleRequest(context(), "GET", "/view/sub/b.md", {});
		expect(rendered.status).toBe(200);
		expect(text(rendered)).toContain('<h2 id="hi">hi</h2>');
		expect(text(rendered)).toContain('href="/view/sub/b.md?raw=1"');

		const raw = await handleRequest(context(), "GET", "/view/sub/b.md?raw=1", {});
		expect(text(raw)).toContain('<pre class="bf-code bf-code--numbered" data-path="sub/b.md">');
		expect(text(raw)).not.toContain('<h2 id="hi">');

		const disabled = await handleRequest(context({ markdown: false }), "GET", "/view/sub/b.md", {});
		expect(text(disabled)).toContain('<pre class="bf-code bf-code--numbered" data-path="sub/b.md">');
		expect(text(disabled)).not.toContain('<h2 id="hi">');
	});

	test("shows the git chip and ignores a failing provider", async () => {
		const shown = await handleRequest({ ...context(), git: async () => ({ branch: "main" }) }, "GET", "/", {});
		expect(text(shown)).toContain('class="bf-chip browse-git"');

		const failing = await handleRequest(
			{
				...context(),
				git: async () => {
					throw new Error("nope");
				},
			},
			"GET",
			"/",
			{},
		);
		expect(failing.status).toBe(200);
		expect(text(failing)).not.toContain('class="bf-chip browse-git');
	});

	test("serves /app.js, /theme.js, a 204 favicon, and the tree API", async () => {
		const app = await handleRequest(context(), "GET", "/app.js", {});
		expect(app.status).toBe(200);
		expect(app.headers["Content-Type"]).toContain("text/javascript");

		const theme = await handleRequest(context(), "GET", "/theme.js", {});
		expect(theme.status).toBe(200);
		expect(theme.headers["Content-Type"]).toContain("text/javascript");

		const icon = await handleRequest(context(), "GET", "/favicon.ico", {});
		expect(icon.status).toBe(204);

		const api = await handleRequest(context(), "GET", "/api/tree?path=sub", {});
		expect(api.status).toBe(200);
		const payload = JSON.parse(text(api)) as {
			path: string;
			entries: Array<{ name: string; href: string; iconHref: string; broken: boolean }>;
		};
		expect(payload.path).toBe("sub");
		expect(payload.entries[0]).toMatchObject({ name: "b.md", href: "/view/sub/b.md", broken: false });
		expect(payload.entries[0]?.iconHref).toMatch(/^#i-/);
	});

	test("serves the quick-open search as ranked JSON", async () => {
		const response = await handleRequest(context(), "GET", "/api/files?q=b.md", {});
		expect(response.status).toBe(200);
		expect(response.headers["Content-Type"]).toContain("application/json");
		const payload = JSON.parse(text(response)) as {
			total: number;
			truncated: boolean;
			results: Array<{ path: string; positions: number[] }>;
		};
		expect(payload.total).toBeGreaterThan(0);
		expect(payload.truncated).toBe(false);
		expect(payload.results[0]?.path).toBe("sub/b.md");
		expect(payload.results[0]?.positions).toHaveLength(4);
	});

	test("returns no results for an empty query but reports the index size", async () => {
		const payload = JSON.parse(text(await handleRequest(context(), "GET", "/api/files?q=", {}))) as {
			results: unknown[];
			total: number;
		};
		expect(payload.results).toEqual([]);
		expect(payload.total).toBeGreaterThan(0);
	});

	test("returns JSON for an API error instead of rendering a page", async () => {
		const response = await handleRequest(context(), "GET", "/api/tree?path=missing", {});
		expect(response.status).toBe(404);
		expect(response.headers["Content-Type"]).toContain("application/json");
		expect(JSON.parse(text(response))).toEqual({ error: "That folder could not be read." });
	});

	test("streams raw files with disposition and the hardened CSP", async () => {
		const textFile = await handleRequest(context(), "GET", "/raw/a.txt", {});
		expect(textFile.filePath).toBeDefined();
		expect(textFile.headers["Content-Disposition"]).toContain("attachment");
		expect(textFile.headers["Content-Security-Policy"]).toContain("script-src 'none'");
		expect(textFile.headers["X-Content-Type-Options"]).toBe("nosniff");
		expect(textFile.headers["Referrer-Policy"]).toBe("no-referrer");

		const image = await handleRequest(context(), "GET", "/raw/image.png", {});
		expect(image.headers["Content-Type"]).toBe("image/png");
		expect(image.headers["Content-Disposition"]).toContain("inline");
	});

	test("answers a malformed request target with 400", async () => {
		const response = await handleRequest(context(), "GET", "http://[", {});
		expect(response.status).toBe(400);
		expect(text(response)).toContain("Malformed request URL.");
	});
});

describe("request guards", () => {
	test("rejects a foreign Host header and allows loopback names", async () => {
		expect((await handleRequest(context(), "GET", "/", { host: "evil.example" })).status).toBe(403);
		expect((await handleRequest(context(), "GET", "/", { host: "127.0.0.1:8080" })).status).toBe(200);
		expect((await handleRequest(context(), "GET", "/", { host: "localhost" })).status).toBe(200);
	});

	test("serves pages, scripts, and APIs under the shared page policy", async () => {
		const page = await handleRequest(context(), "GET", "/", {});
		expect(page.headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
		expect(page.headers["X-Frame-Options"]).toBe("DENY");

		for (const route of ["/app.js", "/theme.js"]) {
			const script = await handleRequest(context(), "GET", route, {});
			expect(script.headers["Content-Security-Policy"], route).toContain("frame-ancestors 'none'");
			expect(script.headers["X-Frame-Options"], route).toBe("DENY");
		}

		const api = await handleRequest(context(), "GET", "/api/files?q=", {});
		expect(api.headers["X-Content-Type-Options"]).toBe("nosniff");
	});

	test("rejects non-GET/HEAD methods with an Allow header", async () => {
		const response = await handleRequest(context(), "POST", "/", {});
		expect(response.status).toBe(405);
		expect(response.headers.Allow).toBe("GET, HEAD");
	});

	test("blocks encoded traversal and a symlink escape", async () => {
		const normalized = await handleRequest(context(), "GET", "/view/%2e%2e/outside/secret.txt", {});
		expect(normalized.status).toBe(404);

		const ctx = context();
		if (fixture?.hasSymlinks) {
			const escape = await handleRequest(ctx, "GET", "/view/escape.txt", {});
			expect(escape.status).toBe(403);
		}
	});

	test("returns 404 for unknown routes", async () => {
		expect((await handleRequest(context(), "GET", "/nope", {})).status).toBe(404);
	});
});

describe("live status stream route", () => {
	test("marks the stream so the server holds it open", async () => {
		const response = await handleRequest({ ...context(), live: idleStatus() }, "GET", "/events", {});
		expect(response.status).toBe(200);
		expect(response.stream).toBe(true);
		expect(response.headers["Content-Type"]).toContain("text/event-stream");
		expect(response.headers["Cache-Control"]).toBe("no-store");
	});

	test("refuses the stream when live status is off or unconfigured", async () => {
		expect(
			(await handleRequest({ ...context({ live: false }), live: idleStatus() }, "GET", "/events", {})).status,
		).toBe(404);
		expect((await handleRequest(context(), "GET", "/events", {})).status).toBe(404);
	});

	test("renders the live chrome only when the channel is available", async () => {
		const page = text(await handleRequest({ ...context(), live: idleStatus() }, "GET", "/", {}));
		expect(page).toContain('id="live-state"');
		expect(page).toContain(`data-interval="${DEFAULT_CONFIG.liveIntervalMs}"`);
		expect(page).toContain('id="live-status"');

		const off = text(await handleRequest({ ...context({ live: false }), live: idleStatus() }, "GET", "/", {}));
		expect(off).not.toContain('id="live-status"');
	});
});

describe("live folder revision", () => {
	test("carries the listing's revision and the reload control on a folder page", async () => {
		fixture = makeFixture();
		const page = text(await handleRequest({ ...context(), live: idleStatus() }, "GET", "/browse/sub", {}));
		expect(page).toContain('data-dir="sub"');
		expect(page).toMatch(/data-rev="[0-9a-f]{12}"/);
		expect(page).toContain('id="reload-hint"');
		expect(page).toContain("hidden>⟳ reload");
	});

	test("leaves the control off a page with nothing to compare", async () => {
		fixture = makeFixture();
		const file = text(await handleRequest({ ...context(), live: idleStatus() }, "GET", "/view/a.txt", {}));
		expect(file).toContain('id="live-state"');
		expect(file).not.toContain("reload-hint");

		const off = text(
			await handleRequest({ ...context({ live: false }), live: idleStatus() }, "GET", "/browse/sub", {}),
		);
		expect(off).not.toContain("reload-hint");
		expect(off).not.toContain("data-rev=");
	});

	test("omits a revision it could not trust from a truncated listing", async () => {
		fixture = makeFixture();
		const page = text(
			await handleRequest({ ...context({ maxDirEntries: 1 }), live: idleStatus() }, "GET", "/browse/", {}),
		);
		expect(page).toContain('id="live-state"');
		expect(page).not.toContain("data-rev=");
		expect(page).not.toContain("reload-hint");
	});

	test("answers the revision the page drew", async () => {
		fixture = makeFixture();
		const page = text(await handleRequest({ ...context(), live: idleStatus() }, "GET", "/browse/sub", {}));
		const drawn = /data-rev="([0-9a-f]{12})"/.exec(page)?.[1];
		const answer = await handleRequest({ ...context(), live: idleStatus() }, "GET", "/api/dir-rev?path=sub", {});
		expect(answer.status).toBe(200);
		expect(JSON.parse(text(answer))).toEqual({ path: "sub", rev: drawn });
	});

	test("says it cannot tell for a truncated folder, and 404s one that is gone", async () => {
		fixture = makeFixture();
		const truncated = await handleRequest(
			{ ...context({ maxDirEntries: 1 }), live: idleStatus() },
			"GET",
			"/api/dir-rev?path=",
			{},
		);
		expect(JSON.parse(text(truncated))).toEqual({ path: "", rev: null });

		const missing = await handleRequest({ ...context(), live: idleStatus() }, "GET", "/api/dir-rev?path=nope", {});
		expect(missing.status).toBe(404);
	});

	// A double quote is not a legal Windows filename character, so the folder this
	// pins cannot exist there; the escaping is proved from a POSIX host.
	test.skipIf(process.platform === "win32")("escapes the folder name it puts in the attribute", async () => {
		fixture = makeFixture();
		mkdirSync(join(fixture.root, 'we"ird'));
		const page = text(await handleRequest({ ...context(), live: idleStatus() }, "GET", "/browse/we%22ird", {}));
		expect(page).toContain('data-dir="we&quot;ird"');
	});
});

describe("diff routes", () => {
	test("lists changes, links each file, and shows the header chip", async () => {
		const response = await handleRequest(
			{ ...context(), git: async () => ({ branch: "main" }), diff: diffProvider() },
			"GET",
			"/diff",
			{},
		);
		expect(response.status).toBe(200);
		const html = text(response);
		expect(html).toContain("Changes");
		expect(html).toContain('href="/diff/a.txt"');
		expect(html).toContain('class="bf-chip browse-diff"');
		expect(html).toContain("+1");
		expect(html).toContain("1 file changed");
	});

	test("marks a changed file in the listing and the tree", async () => {
		const response = await handleRequest({ ...context(), diff: diffProvider() }, "GET", "/", {});
		expect(text(response)).toContain('class="browse-change"');
	});

	test("switches mode and rejects an unknown one", async () => {
		const staged = await handleRequest({ ...context(), diff: diffProvider() }, "GET", "/diff?mode=staged", {});
		expect(staged.status).toBe(200);
		expect(text(staged)).toContain('aria-current="page">staged</a>');

		expect((await handleRequest({ ...context(), diff: diffProvider() }, "GET", "/diff?mode=bogus", {})).status).toBe(
			400,
		);
	});

	test("renders a per-file diff and keeps the mode in its links", async () => {
		const response = await handleRequest(
			{ ...context(), diff: diffProvider() },
			"GET",
			"/diff/a.txt?mode=worktree",
			{},
		);
		expect(response.status).toBe(200);
		const html = text(response);
		expect(html).toContain("bf-diff-line--add");
		expect(html).toContain('href="/diff/a.txt?mode=worktree" aria-current="page">worktree</a>');
	});

	test("rejects a directory as a diff target", async () => {
		expect((await handleRequest({ ...context(), diff: diffProvider() }, "GET", "/diff/sub", {})).status).toBe(400);
	});

	test("shows an empty state outside a repository", async () => {
		const response = await handleRequest(
			{ ...context(), diff: diffProvider({ list: async () => undefined }) },
			"GET",
			"/diff",
			{},
		);
		expect(response.status).toBe(200);
		expect(text(response)).toContain("No changes");
	});

	test("hides the diff view when disabled or unconfigured", async () => {
		expect(
			(await handleRequest({ ...context({ gitDiff: false }), diff: diffProvider() }, "GET", "/diff", {})).status,
		).toBe(404);
		expect((await handleRequest(context(), "GET", "/diff", {})).status).toBe(404);
	});

	test("marks a changed file page with a changes action", async () => {
		const response = await handleRequest({ ...context(), diff: diffProvider() }, "GET", "/view/a.txt", {});
		expect(text(response)).toContain('href="/diff/a.txt"');
	});

	test("degrades to a page without markers when the change list fails", async () => {
		const failing = diffProvider({
			list: async () => {
				throw new Error("git is unhappy");
			},
		});

		const rootPage = await handleRequest({ ...context(), diff: failing }, "GET", "/", {});
		expect(rootPage.status).toBe(200);
		expect(text(rootPage)).not.toContain('class="browse-change"');

		const overview = await handleRequest({ ...context(), diff: failing }, "GET", "/diff", {});
		expect(overview.status).toBe(200);
		expect(text(overview)).toContain("No changes");
	});

	test("reports a file whose diff cannot be read as missing, not as a failure", async () => {
		const failing = diffProvider({
			file: async () => {
				throw new Error("git is unhappy");
			},
		});
		const response = await handleRequest({ ...context(), diff: failing }, "GET", "/diff/a.txt", {});
		expect(response.status).toBe(404);
		expect(text(response)).toContain("No diff is available for that file.");
	});
});

const LIST: DiffList = {
	mode: "head",
	files: [
		{ rel: "a.txt", index: " ", worktree: "M", untracked: false },
		{ rel: "sub/b.md", index: " ", worktree: "D", untracked: false },
	],
	stat: " a.txt | 2 +-\n 2 files changed, 1 insertion(+), 1 deletion(-)",
	insertions: 1,
	deletions: 1,
};

function provider(list: DiffList | undefined = LIST): GitDiffProvider {
	return { list: async () => list, file: async () => undefined };
}

describe("live snapshot", () => {
	test("indexes changed files and the folders above them", () => {
		const index = changeIndexOf(LIST);
		expect(index.count).toBe(2);
		expect([...index.files].sort()).toEqual(["a.txt", "sub/b.md"]);
		expect([...index.dirs]).toEqual(["sub"]);
	});

	test("carries the branch, changes, uptime, and request count", async () => {
		const clock = makeClock(10_000);
		const status = createLiveStatus({
			git: async () => ({ branch: "main" }),
			diff: provider(),
			startedAt: 4_000,
			requests: () => 7,
			now: clock.now,
		});
		const snapshot = await status.snapshot();
		expect(snapshot.uptimeMs).toBe(6_000);
		expect(snapshot.requests).toBe(7);
		expect(snapshot.git).toEqual({ branch: "main" });
		expect(snapshot.changes).toMatchObject({
			count: 2,
			insertions: 1,
			deletions: 1,
			files: ["a.txt", "sub/b.md"],
			dirs: ["sub"],
		});
		expect(snapshot.changes?.rev).toMatch(/^[0-9a-f]{12}$/);
	});

	test("keeps a revision still while the change set is unchanged", async () => {
		const status = createLiveStatus({ diff: provider(), startedAt: 0, requests: () => 0 });
		const first = await status.snapshot();
		const second = await status.snapshot();
		expect(second.changes?.rev).toBe(first.changes?.rev);
	});

	test("moves the revision when a path or a total changes", async () => {
		const base = createLiveStatus({ diff: provider(), startedAt: 0, requests: () => 0 });
		const added = createLiveStatus({
			diff: provider({
				...LIST,
				files: [...LIST.files, { rel: "new.ts", index: "?", worktree: "?", untracked: true }],
			}),
			startedAt: 0,
			requests: () => 0,
		});
		// The same paths, one more added line: a content edit still moves the chip's totals.
		const totals = createLiveStatus({
			diff: provider({ ...LIST, insertions: 4 }),
			startedAt: 0,
			requests: () => 0,
		});
		const rev = (await base.snapshot()).changes?.rev;
		expect(rev).toBeTruthy();
		expect((await added.snapshot()).changes?.rev).not.toBe(rev);
		expect((await totals.snapshot()).changes?.rev).not.toBe(rev);
	});

	test("sends a detached head through as it is", async () => {
		const status = createLiveStatus({ git: async () => ({ head: "abc1234" }), startedAt: 0, requests: () => 0 });
		expect((await status.snapshot()).git).toEqual({ head: "abc1234" });
	});

	test("reports null for a non-repository and for a missing provider", async () => {
		const none = createLiveStatus({
			git: async () => undefined,
			diff: { list: async () => undefined, file: async () => undefined },
			startedAt: 0,
			requests: () => 0,
		});
		const snapshot = await none.snapshot();
		expect(snapshot.git).toBeNull();
		expect(snapshot.changes).toBeNull();

		const bare = await createLiveStatus({ startedAt: 0, requests: () => 0 }).snapshot();
		expect(bare.git).toBeNull();
		expect(bare.changes).toBeNull();
	});

	test("degrades a throwing provider instead of rejecting", async () => {
		const status = createLiveStatus({
			git: async () => {
				throw new Error("git is missing");
			},
			diff: {
				list: async () => {
					throw new Error("no repository");
				},
				file: async () => undefined,
			},
			startedAt: 0,
			requests: () => 0,
		});
		const snapshot = await status.snapshot();
		expect(snapshot.git).toBeNull();
		expect(snapshot.changes).toBeNull();
	});

	test("never reports a negative uptime", async () => {
		const status = createLiveStatus({ startedAt: 5_000, requests: () => 0, now: () => 1_000 });
		expect((await status.snapshot()).uptimeMs).toBe(0);
	});

	test("frameOf is one named event carrying the snapshot as JSON", () => {
		const snapshot = { uptimeMs: 5, requests: 1, git: { branch: "main" }, changes: null };
		const frame = frameOf(snapshot);
		expect(frame.startsWith("event: status\ndata: {")).toBe(true);
		expect(frame.endsWith("}\n\n")).toBe(true);
		expect(JSON.parse(frame.slice(frame.indexOf("{"), frame.lastIndexOf("}") + 1))).toEqual(snapshot);
	});
});

/** A connected page that records what it was sent. */
function liveClient(): LiveClient & { frames: string[]; ends: number } {
	const record = {
		frames: [] as string[],
		ends: 0,
		write: (frame: string) => {
			record.frames.push(frame);
		},
		end: () => {
			record.ends += 1;
		},
	};
	return record;
}

/** A ticker that only fires when the test says so. */
function fakeTimer(): { timer: RepeatTimer; fire(): Promise<void>; stops: number } {
	let pending: (() => void) | undefined;
	const state = {
		stops: 0,
		timer: ((_ms: number, tick: () => void) => {
			pending = tick;
			return () => {
				pending = undefined;
				state.stops += 1;
			};
		}) as RepeatTimer,
		fire: async () => {
			pending?.();
			await settle();
		},
	};
	return state;
}

const idle = { snapshot: async () => ({ uptimeMs: 0, requests: 0, git: null, changes: null }) };

describe("live channel", () => {
	test("refuses a page beyond its capacity and takes one back after a detach", async () => {
		const channel = createLiveChannel({
			status: idle,
			intervalMs: 3000,
			timer: fakeTimer().timer,
			maxClients: 2,
		});
		expect(channel.atCapacity()).toBe(false);
		const first = channel.attach(liveClient());
		channel.attach(liveClient());
		expect(channel.atCapacity()).toBe(true);
		first();
		expect(channel.atCapacity()).toBe(false);
		channel.close();
	});

	test("sends the current status to a page as it attaches", async () => {
		const status = createLiveStatus({ git: async () => ({ branch: "main" }), startedAt: 0, requests: () => 1 });
		const channel = createLiveChannel({ status, intervalMs: 3000, timer: fakeTimer().timer });
		const page = liveClient();
		const detach = channel.attach(page);
		await settle();
		expect(page.frames).toHaveLength(1);
		expect(page.frames[0]).toContain('"branch":"main"');
		detach();
		channel.close();
	});

	test("publishes one snapshot per tick to every attached page", async () => {
		let reads = 0;
		const status = {
			snapshot: async () => {
				reads += 1;
				return { at: reads, uptimeMs: 0, requests: reads, git: null, changes: null };
			},
		};
		const state = fakeTimer();
		const channel = createLiveChannel({ status, intervalMs: 3000, timer: state.timer });
		const first = liveClient();
		const second = liveClient();
		channel.attach(first);
		channel.attach(second);
		await settle();
		await state.fire();
		expect(reads).toBe(2);
		expect(first.frames.length).toBeGreaterThanOrEqual(2);
		expect(second.frames.length).toBe(first.frames.length);
		channel.close();
	});

	test("stops the ticker with the last page and on close", async () => {
		const state = fakeTimer();
		const channel = createLiveChannel({ status: idle, intervalMs: 3000, timer: state.timer });
		const first = liveClient();
		const second = liveClient();
		const detachFirst = channel.attach(first);
		const detachSecond = channel.attach(second);
		detachFirst();
		expect(state.stops).toBe(0);
		detachSecond();
		expect(state.stops).toBe(1);
		detachSecond();

		const third = liveClient();
		channel.attach(third);
		channel.close();
		expect(state.stops).toBe(2);
		expect(third.ends).toBe(1);
	});
});

/** Whether a TCP connection to `url`'s host:port is refused, independent of any HTTP proxy. */
function connectionRefused(url: string): Promise<boolean> {
	const { hostname, port } = new URL(url);
	return new Promise((resolve) => {
		const socket = createConnection({ host: hostname, port: Number(port) });
		const finish = (refused: boolean) => {
			socket.destroy();
			resolve(refused);
		};
		socket.once("connect", () => finish(false));
		socket.once("error", () => finish(true));
	});
}

describe("loopback server", () => {
	test("serves listings, files, and the tree API over HTTP", async () => {
		fixture = makeFixture();
		server = await createFileServer({ root: fixture.root, config: { ...DEFAULT_CONFIG, autoOpen: false } });
		expect(server.port).toBeGreaterThan(0);
		expect(server.url.startsWith("http://127.0.0.1:")).toBe(true);

		const home = await fetch(server.url);
		expect(home.status).toBe(200);
		expect(await home.text()).toContain("read-only");

		const file = await fetch(`${server.url}view/a.txt`);
		expect(file.status).toBe(200);
		expect(await file.text()).toContain("hello");

		const tree = await fetch(`${server.url}api/tree?path=sub`);
		expect(tree.status).toBe(200);
		expect((await tree.json()) as { path: string }).toMatchObject({ path: "sub" });
	});

	test("responds to HEAD without a body", async () => {
		fixture = makeFixture();
		server = await createFileServer({ root: fixture.root, config: DEFAULT_CONFIG });
		const response = await fetch(server.url, { method: "HEAD" });
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("");
	});

	test("streams a status frame as a page connects, and ends it on close", async () => {
		fixture = makeFixture();
		const started = await createFileServer({
			root: fixture.root,
			config: { ...DEFAULT_CONFIG, autoOpen: false },
			git: async () => ({ branch: "main" }),
		});
		server = started;
		const reply = await fetch(`${started.url}events`);
		expect(reply.status).toBe(200);
		expect(reply.headers.get("content-type")).toContain("text/event-stream");
		const reader = reply.body?.getReader();
		expect(reader).toBeDefined();
		const first = await reader?.read();
		const frame = new TextDecoder().decode(first?.value);
		expect(frame).toContain("retry: 2000");
		expect(frame).toContain("event: status");
		const payload = JSON.parse(frame.slice(frame.indexOf("{"), frame.lastIndexOf("}") + 1)) as {
			requests: number;
			git: { branch?: string } | null;
			uptimeMs: number;
		};
		expect(payload.git).toEqual({ branch: "main" });
		expect(payload.requests).toBeGreaterThan(0);
		expect(payload.uptimeMs).toBeGreaterThanOrEqual(0);

		await started.close();
		const done = await reader?.read();
		expect(done?.done).toBe(true);
	});

	test("answers /events with 404 when live status is off", async () => {
		fixture = makeFixture();
		server = await createFileServer({ root: fixture.root, config: { ...DEFAULT_CONFIG, live: false } });
		const reply = await fetch(`${server.url}events`);
		expect(reply.status).toBe(404);
		expect(await reply.text()).toContain("Live status is not available");
	});

	test("refuses a page beyond the stream cap with a status that stops the reconnect", async () => {
		fixture = makeFixture();
		const stream = {
			status: 200,
			headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" },
			stream: true,
		};
		server = await createFileServer({
			root: fixture.root,
			config: { ...DEFAULT_CONFIG, autoOpen: false },
			handler: async () => stream,
		});
		const firstFrames: Promise<unknown>[] = [];
		for (let page = 0; page < LIVE_MAX_CLIENTS; page++) {
			const reply = await fetch(`${server.url}events`);
			expect(reply.status).toBe(200);
			const reader = reply.body?.getReader();
			expect(reader).toBeDefined();
			if (reader) firstFrames.push(reader.read());
		}
		// A frame reaches only an attached page: a response nobody reads can be torn
		// down by the client before the next request, which frees the slot it counted.
		await Promise.all(firstFrames);
		const refused = await fetch(`${server.url}events`);
		expect(refused.status).toBe(204);
		expect(await refused.text()).toBe("");
	});

	test("closes idempotently and stops accepting connections", async () => {
		fixture = makeFixture();
		const started = await createFileServer({ root: fixture.root, config: DEFAULT_CONFIG });
		const url = started.url;
		await started.close();
		await started.close();
		expect(await connectionRefused(url)).toBe(true);
	});

	test("stops listening once the last page has gone for the grace period", async () => {
		fixture = makeFixture();
		let closed: (() => void) | undefined;
		const done = new Promise<void>((resolve) => {
			closed = resolve;
		});
		let started: FileServer | undefined;
		started = await createFileServer({
			root: fixture.root,
			config: { ...DEFAULT_CONFIG, autoOpen: false },
			idleStopMs: 20,
			onIdle: () => {
				void started?.close().then(() => closed?.());
			},
		});
		server = started;

		// A raw socket, so closing it is the page leaving and nothing else.
		const { hostname, port } = new URL(started.url);
		const socket = createConnection({ host: hostname, port: Number(port) }, () => {
			socket.write("GET /events HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n");
		});
		socket.once("data", () => socket.destroy());

		await done;
		expect(await connectionRefused(started.url)).toBe(true);
	});
});

function fakeServer(root: string): FileServer {
	return { url: "http://127.0.0.1:4321/", port: 4321, root, close: async () => {} };
}

const noOpen = () => {};

describe("browse command", () => {
	test("registers nothing when disabled", async () => {
		await withEnv({ [ENV_DISABLED_EXTENSIONS]: "file-browse" }, () => {
			const { pi, commands, handlers } = createFakePi();
			fileBrowser(pi);
			expect(commands.size).toBe(0);
			expect(handlers.size).toBe(0);
		});
	});

	test("registers /browse and completes its subcommands", () => {
		const { pi, commands } = createFakePi();
		fileBrowser(pi);
		expect(commands.has("browse")).toBe(true);
		const complete = (prefix: string): string[] =>
			(commands.get("browse").getArgumentCompletions(prefix) ?? []).map((item: { label: string }) => item.label);
		expect(complete("")).toEqual(["status", "stop"]);
		expect(complete("stat")).toEqual(["status"]);
		expect(complete("status ")).toEqual([]);
	});

	test("reports not running before a start", async () => {
		const { pi } = createFakePi();
		fileBrowser(pi);
		const { ctx, notifications } = fakeCtx("/tmp/repo");
		await runCommand(pi, "browse", "status", ctx);
		expect(notifications.at(-1)?.message).toContain("not running");
	});

	test("starts, opens the browser, reports status, and stops", async () => {
		fixture = makeFixture();
		const { pi } = createFakePi();
		const opened: string[] = [];
		let closes = 0;
		fileBrowser(pi, {
			createServer: async () => ({
				...fakeServer(fixture!.root),
				close: async () => {
					closes++;
				},
			}),
			open: (url) => {
				opened.push(url);
			},
		});
		const { ctx, notifications } = fakeCtx(fixture.root);

		await runCommand(pi, "browse", "", ctx);
		expect(opened).toEqual(["http://127.0.0.1:4321/"]);
		expect(notifications.at(-1)?.message).toContain("4321");

		await runCommand(pi, "browse", "status", ctx);
		expect(notifications.at(-1)?.message).toContain("4321");

		await runCommand(pi, "browse", "stop", ctx);
		expect(closes).toBe(1);
		expect(notifications.at(-1)?.message).toContain("stopped");
	});

	test("closes the server when its only page leaves, and says why", async () => {
		fixture = makeFixture();
		const { pi } = createFakePi();
		let idle: (() => void) | undefined;
		let closes = 0;
		fileBrowser(pi, {
			open: noOpen,
			pickPort: () => 4321,
			createServer: async (options) => {
				idle = options.onIdle;
				return {
					...fakeServer(fixture!.root),
					close: async () => {
						closes++;
					},
				};
			},
		});
		const { ctx, notifications, statuses } = fakeCtx(fixture.root);

		await runCommand(pi, "browse", "", ctx);
		expect(statuses.has(STATUS_KEYS.browse)).toBe(true);
		expect(idle).toBeDefined();

		idle?.();
		await settle();
		expect(closes).toBe(1);
		expect(statuses.has(STATUS_KEYS.browse)).toBe(false);
		expect(notifications.at(-1)?.message).toContain("last page was closed");

		// The page is gone for good: a second idle report cannot close twice.
		idle?.();
		await settle();
		expect(closes).toBe(1);
	});

	test("reprints without restarting when the root and port are unchanged", async () => {
		fixture = makeFixture();
		const { pi } = createFakePi();
		let creates = 0;
		const opened: string[] = [];
		fileBrowser(pi, {
			open: (url) => {
				opened.push(url);
			},
			pickPort: () => 4321,
			createServer: async () => {
				creates++;
				return fakeServer(fixture!.root);
			},
		});
		const { ctx, notifications } = fakeCtx(fixture.root);

		await runCommand(pi, "browse", "", ctx);
		await runCommand(pi, "browse", "", ctx);

		expect(creates).toBe(1);
		expect(opened).toEqual(["http://127.0.0.1:4321/"]);
		expect(notifications.at(-1)?.message).toContain("already running");
	});

	test("publishes a two-tone browse chip and clears it on stop and shutdown", async () => {
		fixture = makeFixture();
		const { pi } = createFakePi();
		fileBrowser(pi, { createServer: async () => fakeServer(fixture!.root), open: noOpen });
		const { ctx, statuses } = fakeCtx(fixture.root);

		await runCommand(pi, "browse", "", ctx);
		expect(statuses.get(STATUS_KEYS.browse)).toBe(`${GLYPHS.browse} 4321`);

		await runCommand(pi, "browse", "stop", ctx);
		expect(statuses.has(STATUS_KEYS.browse)).toBe(false);

		await runCommand(pi, "browse", "", ctx);
		const colored = fakeCtx(fixture.root, "print", { theme: coloringTheme });
		await runCommand(pi, "browse", "stop", colored.ctx);
		await runCommand(pi, "browse", "", colored.ctx);
		expect(colored.statuses.get(STATUS_KEYS.browse)).toBe(`[success]${GLYPHS.browse} [accent]4321`);

		await emit(pi, "session_shutdown", {}, ctx);
		expect(statuses.has(STATUS_KEYS.browse)).toBe(false);
	});

	test("fixes one random port for the session across roots and restarts", async () => {
		fixture = makeFixture();
		const { pi } = createFakePi();
		const ports: number[] = [];
		fileBrowser(pi, {
			open: noOpen,
			pickPort: () => 4321,
			createServer: async (options) => {
				ports.push(options.config.port);
				return fakeServer(fixture!.root);
			},
		});
		const { ctx } = fakeCtx(fixture.root);

		await runCommand(pi, "browse", "", ctx);
		await runCommand(pi, "browse", "sub", ctx);
		await runCommand(pi, "browse", "stop", ctx);
		await runCommand(pi, "browse", "", ctx);

		expect(ports).toEqual([4321, 4321, 4321]);
	});

	test("rolls another random port after a conflict, then reuses it", async () => {
		fixture = makeFixture();
		const { pi } = createFakePi();
		const ports: number[] = [];
		const picks = [1111, 2222];
		let call = 0;
		fileBrowser(pi, {
			open: noOpen,
			pickPort: () => picks[call++] ?? 9999,
			createServer: async (options) => {
				ports.push(options.config.port);
				if (options.config.port === 1111) {
					const error = new Error("in use") as NodeJS.ErrnoException;
					error.code = "EADDRINUSE";
					throw error;
				}
				return fakeServer(fixture!.root);
			},
		});
		const { ctx, notifications } = fakeCtx(fixture.root);

		await runCommand(pi, "browse", "", ctx);
		expect(notifications.at(-1)?.level).toBe("error");
		await runCommand(pi, "browse", "", ctx);
		expect(notifications.at(-1)?.level).toBe("info");
		await runCommand(pi, "browse", "", ctx);
		expect(ports).toEqual([1111, 2222, 2222]);
	});

	test("uses a pinned config port instead of the session port", async () => {
		fixture = makeFixture();
		mkdirSync(join(fixture.root, ".pi"), { recursive: true });
		writeFileSync(join(fixture.root, ".pi", "bytefly.json"), JSON.stringify({ "file-browse": { port: 8080 } }));
		const { pi } = createFakePi();
		const ports: number[] = [];
		fileBrowser(pi, {
			open: noOpen,
			pickPort: () => 4321,
			createServer: async (options) => {
				ports.push(options.config.port);
				return fakeServer(fixture!.root);
			},
		});
		await runCommand(pi, "browse", "", fakeCtx(fixture.root).ctx);
		expect(ports).toEqual([8080]);
	});

	test("closes the server on session shutdown", async () => {
		fixture = makeFixture();
		const { pi } = createFakePi();
		let closes = 0;
		fileBrowser(pi, {
			open: noOpen,
			createServer: async () => ({
				...fakeServer(fixture!.root),
				close: async () => {
					closes++;
				},
			}),
		});
		const { ctx } = fakeCtx(fixture.root);
		await runCommand(pi, "browse", "", ctx);
		await emit(pi, "session_shutdown", {}, ctx);
		expect(closes).toBe(1);
	});

	test("reports a port conflict with a hint", async () => {
		fixture = makeFixture();
		const { pi } = createFakePi();
		fileBrowser(pi, {
			open: noOpen,
			createServer: async () => {
				const error = new Error("in use") as NodeJS.ErrnoException;
				error.code = "EADDRINUSE";
				throw error;
			},
		});
		const { ctx, notifications } = fakeCtx(fixture.root);
		await runCommand(pi, "browse", "", ctx);
		expect(notifications.at(-1)?.level).toBe("error");
		expect(notifications.at(-1)?.message).toContain("in use");
	});

	test("refuses a subpath that is not a folder", async () => {
		fixture = makeFixture();
		const { pi } = createFakePi();
		fileBrowser(pi, { createServer: async () => fakeServer(fixture!.root), open: noOpen });
		const { ctx, notifications } = fakeCtx(fixture.root);
		await runCommand(pi, "browse", "a.txt", ctx);
		expect(notifications.at(-1)?.level).toBe("error");
	});
});
