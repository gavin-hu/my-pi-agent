/**
 * The transport capability: request routing and its guards, the loopback server and its live
 * stream, and the status snapshot/channel. The `/browse` command's surface is `../command.test.ts`.
 *
 * Routers are driven directly for request shapes; the loopback cases open a real socket.
 * The live channel uses an injected ticker, so no test waits on a wall clock.
 */

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, realpathSync } from "node:fs";
import { createConnection } from "node:net";
import { join } from "node:path";
import { type RepeatTimer } from "../../../lib/timer.ts";
import { DEFAULT_CONFIG, LIVE_MAX_CLIENTS, type ServeConfig } from "../config/config.ts";
import { createGitDiff, type DiffList, type GitDiffProvider } from "../git/git.ts";
import { changeIndexOf, createLiveChannel, createLiveStatus, frameOf, type LiveClient } from "../live/live.ts";
import { handleRequest, type ServeContext } from "./router.ts";
import { FILES_BASE, type FileServer } from "./server.ts";
import type { ServeResponse } from "../../../lib/http/index.ts";
import { createFakePi } from "../../../test/helpers/fakes.ts";
import { makeClock } from "../../../test/helpers/clock.ts";
import { useEnv } from "../../../test/helpers/env.ts";
import { makeFixture, servePage, type Fixture } from "../../../test/helpers/fixtures/file-browse.ts";
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
	// Route names are relative to the prefix the mount chose, so routing cases read them
	// at the origin's root; the loopback cases below prove the shipped `/files` prefix.
	return { root: realpathSync(fixture.root), base: "", config: { ...DEFAULT_CONFIG, ...overrides } };
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
		...overrides,
	};
}

describe("request routing", () => {
	test("serves the root listing with sort keys", async () => {
		const response = await handleRequest(context(), "GET", "/", {});
		expect(response.status).toBe(200);
		expect(response.headers["Content-Type"]).toContain("text/html");
		const html = text(response);
		expect(html).not.toContain('<div class="bf-app__rule">');
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
		expect(text(shown)).toContain('class="bf-tag browse-git"');

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
		expect(text(failing)).not.toContain('class="bf-tag browse-git');
	});

	test("serves /app.js, /theme.js, the tree API, and no favicon", async () => {
		const app = await handleRequest(context(), "GET", "/app.js", {});
		expect(app.status).toBe(200);
		expect(app.headers["Content-Type"]).toContain("text/javascript");

		const theme = await handleRequest(context(), "GET", "/theme.js", {});
		expect(theme.status).toBe(200);
		expect(theme.headers["Content-Type"]).toContain("text/javascript");

		const icon = await handleRequest(context(), "GET", "/favicon.ico", {});
		expect(icon.status).toBe(404);

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
		expect(page).toContain('id="reload-hint"');

		const off = text(await handleRequest({ ...context({ live: false }), live: idleStatus() }, "GET", "/", {}));
		expect(off).not.toContain("reload-hint");
	});
});

describe("live folder revision", () => {
	test("carries the listing's revision and the reload control on a folder page", async () => {
		fixture = makeFixture();
		const page = text(await handleRequest({ ...context(), live: idleStatus() }, "GET", "/browse/sub", {}));
		expect(page).toContain('data-dir="sub"');
		expect(page).toMatch(/data-rev="[0-9a-f]{12}"/);
		expect(page).toContain('id="reload-hint"');
		expect(page).toContain('hidden><span aria-hidden="true">⟳</span>reload');
	});

	test("offers the reload control wherever live status is on", async () => {
		fixture = makeFixture();
		const file = text(await handleRequest({ ...context(), live: idleStatus() }, "GET", "/view/a.txt", {}));
		expect(file).toContain('id="live-state"');
		// Not the folder's business only: a lost stream is the other reason, and it starts hidden.
		expect(file).toContain('hidden><span aria-hidden="true">⟳</span>reload</button>');

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

describe("the diff address", () => {
	test("is gone: the review page is its own entry, so nothing links or redirects into it", async () => {
		for (const url of ["/diff", "/diff/", "/diff/sub/a.txt", "/diff?mode=staged", "/diff/a.txt?mode=bogus"]) {
			expect((await handleRequest({ ...context(), diff: diffProvider() }, "GET", url, {})).status).toBe(404);
		}
		expect((await handleRequest(context({ gitDiff: false }), "GET", "/diff", {})).status).toBe(404);
	});

	test("marks a changed file in the listing and the tree", async () => {
		const response = await handleRequest({ ...context(), diff: diffProvider() }, "GET", "/", {});
		expect(text(response)).toContain('class="browse-change"');
	});

	test("takes its numbers from the comparison the tree actually holds a change in", async () => {
		interface Reply {
			stdout?: string;
			code?: number;
		}
		/** A fake git answering by argv prefix, and the argv it was asked for, in order. */
		const gitAsking = (replies: Array<[string, Reply]>) => {
			const asked: string[] = [];
			const exec = async (_command: string, args: string[]) => {
				const key = args.join(" ");
				asked.push(key);
				for (const [prefix, reply] of replies) {
					if (key.startsWith(prefix)) return { stdout: reply.stdout ?? "", stderr: "", code: reply.code ?? 0 };
				}
				return { stdout: "", stderr: "unexpected", code: 1 };
			};
			return { exec, asked };
		};
		const ROOT: [string, Reply] = ["rev-parse --show-toplevel", { stdout: "/repo\n" }];
		const STAT: [string, Reply] = [
			"diff --no-color --stat",
			{ stdout: " a.txt | 1 +\n 1 file changed, 1 insertion(+)\n" },
		];

		/** The page a tree's provider draws, and the comparison its numbers came from. */
		const pageFor = async (status: string, commit: boolean) => {
			const git = gitAsking([
				ROOT,
				...(commit ? ([["rev-parse --verify --quiet HEAD", { stdout: "abc1234\n" }]] as Array<[string, Reply]>) : []),
				["status --porcelain=v1", { stdout: status }],
				STAT,
			]);
			const diff = createGitDiff(createFakePi({ exec: git.exec }).pi, "/repo");
			const listing = await handleRequest({ ...context(), diff }, "GET", "/", {});
			return {
				mode: (await diff.list("head"))?.mode,
				chip: /<span class="bf-tag browse-changes"[^>]*>[\s\S]*?<\/span><\/span>/.exec(text(listing))?.[0],
				diffs: git.asked.filter((line) => line.startsWith("diff ")),
				mentionsHead: git.asked.filter((line) => line.includes("HEAD")),
			};
		};

		// The ladder's three rungs, each with the comparison git was asked for beside the chip the
		// page drew — a count now, so the tell is that it is a chip and not a link out of this page.
		// No commit, nothing staged: the working tree is the first comparison holding the change.
		const written = await pageFor("?? a.txt\0", false);
		expect(written.mode).toBe("worktree");
		expect(written.chip).toContain("1 change");
		expect(written.chip).not.toContain("href");
		expect(written.diffs.every((line) => !line.includes("--cached") && !line.includes("HEAD"))).toBe(true);

		// No commit, one file added: the index.
		const staged = await pageFor("A  a.txt\0", false);
		expect(staged.mode).toBe("staged");
		expect(staged.diffs.every((line) => line.includes("--cached"))).toBe(true);

		// A commit exists: the comparison asked for.
		const committed = await pageFor(" M a.txt\0", true);
		expect(committed.mode).toBe("head");
		expect(committed.chip).toContain("1 change");
		expect(committed.diffs.some((line) => line.includes("HEAD"))).toBe(true);

		// An unborn branch never compares against the commit: the one question about `HEAD` is the
		// probe that found it missing.
		for (const unborn of [written, staged]) {
			expect(unborn.mentionsHead).toEqual(["rev-parse --verify --quiet HEAD"]);
		}
	});

	test("shows the changes chip with the change totals", async () => {
		const response = await handleRequest(
			{ ...context(), git: async () => ({ branch: "main" }), diff: diffProvider() },
			"GET",
			"/",
			{},
		);
		expect(text(response)).toContain('class="bf-tag browse-changes"');
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
	return { list: async () => list };
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
			diff: { list: async () => undefined },
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
	test("holds the /files namespace, which is what every URL it emits is built from", async () => {
		fixture = makeFixture();
		// The page owns a prefix, not the origin: `base` reaches the links, the scripts, and
		// the Markdown destinations, so the mount and the document agree. This case is that
		// claim, and it is meant to fail when the prefix moves.
		server = await servePage(fixture.root, DEFAULT_CONFIG);
		expect(new URL(server.url).pathname).toBe("/files/");
		expect(await (await fetch(server.url)).text()).toContain('<script src="/files/app.js"');
	});

	test("leaves the origin's root to the other pages, and redirects a bare prefix", async () => {
		fixture = makeFixture();
		server = await servePage(fixture.root, DEFAULT_CONFIG);
		const origin = new URL(server.url).origin;
		// The origin's root is unclaimed by decision: `board` and a plan review leave it free.
		const root = await fetch(`${origin}/`);
		expect(root.status).toBe(404);
		// `/files` without its slash is redirected, so the page's relative URLs resolve under
		// the prefix rather than beside it.
		const bare = await fetch(`${origin}/files`, { redirect: "manual" });
		expect(bare.status).toBe(301);
		expect(bare.headers.get("Location")).toBe("/files/");
	});

	test("serves listings, files, and the tree API over HTTP", async () => {
		fixture = makeFixture();
		server = await servePage(fixture.root, DEFAULT_CONFIG);
		expect(server.port).toBeGreaterThan(0);
		expect(server.url.startsWith("http://127.0.0.1:")).toBe(true);

		const home = await fetch(server.url);
		expect(home.status).toBe(200);
		expect(await home.text()).toContain('id="live-state"');

		const file = await fetch(`${server.url}view/a.txt`);
		expect(file.status).toBe(200);
		expect(await file.text()).toContain("hello");

		const tree = await fetch(`${server.url}api/tree?path=sub`);
		expect(tree.status).toBe(200);
		expect((await tree.json()) as { path: string }).toMatchObject({ path: "sub" });
	});

	test("responds to HEAD without a body, a stream's head included", async () => {
		fixture = makeFixture();
		server = await servePage(fixture.root, DEFAULT_CONFIG);
		const response = await fetch(server.url, { method: "HEAD" });
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("");
		// The status stream owes a HEAD its head alone: no sink, and no 500 for the missing one.
		const events = await fetch(`${server.url}events`, { method: "HEAD" });
		expect(events.status).toBe(200);
		expect(events.headers.get("content-type")).toContain("text/event-stream");
	});

	test("streams a status frame as a page connects, and ends it on close", async () => {
		fixture = makeFixture();
		const started = await servePage(fixture.root, DEFAULT_CONFIG, {
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
		server = await servePage(fixture.root, { ...DEFAULT_CONFIG, live: false });
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
		server = await servePage(fixture.root, DEFAULT_CONFIG, { handler: async () => stream });
		// Held, not started: a reader nothing references is collected, tearing its connection down and
		// freeing the slot it counted — the `--parallel` race the forced collection below replays.
		const held: unknown[] = [];
		for (let page = 0; page < LIVE_MAX_CLIENTS; page++) {
			const reply = await fetch(`${server.url}events`);
			expect(reply.status).toBe(200);
			const reader = reply.body?.getReader();
			expect(reader).toBeDefined();
			if (!reader) return;
			held.push(reader);
			// A frame reaches only an attached page, so the sink is attached before the next request.
			await reader.read();
		}
		Bun.gc(true);
		const refused = await fetch(`${server.url}events`);
		expect(refused.status).toBe(204);
		expect(await refused.text()).toBe("");
	});

	test("closes idempotently and stops accepting connections", async () => {
		fixture = makeFixture();
		const started = await servePage(fixture.root, DEFAULT_CONFIG);
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
		started = await servePage(fixture.root, DEFAULT_CONFIG, {
			idleStopMs: 20,
			onIdle: () => {
				void started?.close().then(() => closed?.());
			},
		});
		server = started;

		// A raw socket, so closing it is the page leaving and nothing else.
		const { hostname, port } = new URL(started.url);
		const socket = createConnection({ host: hostname, port: Number(port) }, () => {
			socket.write(`GET ${FILES_BASE}/events HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n`);
		});
		socket.once("data", () => socket.destroy());

		await done;
		expect(await connectionRefused(started.url)).toBe(true);
	});
});
