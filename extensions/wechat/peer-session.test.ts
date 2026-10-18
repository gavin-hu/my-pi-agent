import { describe, expect, test } from "bun:test";
import type { AgentSession, CreateAgentSessionOptions, LoadExtensionsResult } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { tempDir } from "../../test/helpers/env.ts";
import {
	isWechatExtensionPath,
	buildPeerLoader,
	openPeerSession,
	peerSessionDir,
	withoutWechatExtensions,
} from "./peer-session.ts";
import { WECHAT_CHANNEL_PROMPT } from "./channel.ts";

const peer = "o9cq805LvMzHEsv0mfq0XwZPJruI@im.wechat";

interface Bound {
	mode?: string;
	uiContext?: { custom: unknown };
	onError?: (error: { extensionPath: string; event: string; error: string }) => void;
}

function fakeSession(tools = [{ name: "read", exposure: "direct" }]): {
	session: AgentSession;
	bound: () => Bound | undefined;
	disposed: () => number;
	active: () => string[];
} {
	let bound: Bound | undefined;
	let disposals = 0;
	let active = tools.filter((tool) => tool.exposure === "direct").map((tool) => tool.name);
	const session = {
		bindExtensions: async (bindings: Bound) => {
			bound = bindings;
		},
		getActiveToolNames: () => [...active],
		getAllTools: () => tools,
		setActiveToolsByName: (names: string[]) => {
			active = [...names];
		},
		dispose: () => {
			disposals += 1;
		},
	};
	return {
		session: session as unknown as AgentSession,
		bound: () => bound,
		disposed: () => disposals,
		active: () => [...active],
	};
}

function extensions(paths: string[]): LoadExtensionsResult {
	return {
		extensions: paths.map((path) => ({ path, resolvedPath: path })),
		errors: [],
		runtime: {},
	} as unknown as LoadExtensionsResult;
}

describe("isWechatExtensionPath", () => {
	test("recognizes this bridge and nothing else", () => {
		const root = "/repo/extensions";
		expect(isWechatExtensionPath(`${root}/wechat/index.ts`)).toBe(true);
		expect(isWechatExtensionPath(`${root}/wechat/index.js`)).toBe(true);
		expect(isWechatExtensionPath("C:\\repo\\extensions\\wechat\\index.ts".replace(/\\/g, "/"))).toBe(true);
		expect(isWechatExtensionPath(`${root}/plan/index.ts`)).toBe(false);
		expect(isWechatExtensionPath(`${root}/wechat/commands.ts`)).toBe(false);
		expect(isWechatExtensionPath(`${root}/notwechat/index.ts`)).toBe(false);
	});
});

describe("withoutWechatExtensions", () => {
	test("drops only this bridge", () => {
		const base = extensions([
			"/repo/extensions/wechat/index.ts",
			"/repo/extensions/plan/index.ts",
			"/repo/extensions/todo/index.ts",
		]);
		const kept = withoutWechatExtensions(base);
		expect(kept.extensions.map((extension) => extension.resolvedPath)).toEqual([
			"/repo/extensions/plan/index.ts",
			"/repo/extensions/todo/index.ts",
		]);
		expect(kept.runtime).toBe(base.runtime);
	});

	test("keeps the loaded set untouched when the bridge is absent", () => {
		const base = extensions(["/repo/extensions/plan/index.ts"]);
		expect(withoutWechatExtensions(base)).toBe(base);
	});
});

describe("peerSessionDir", () => {
	test("gives each peer its own directory under the state dir", () => {
		const root = tempDir("wechat-sessions-");
		expect(peerSessionDir(root, peer)).toBe(join(root, "o9cq805lvmzhesv0mfq0xwzpjrui"));
		expect(peerSessionDir(root, "alice")).toBe(join(root, "alice"));
	});
});

describe("buildPeerLoader", () => {
	test("appends the channel contract and keeps it across reload", async () => {
		const root = tempDir("wechat-loader-");
		const loader = buildPeerLoader(root, root);
		// `reload()` is what openPeerSession calls before creating the session; the
		// append must survive it, or the model never sees the channel contract.
		await loader.reload();
		expect(loader.getAppendSystemPrompt()).toEqual([WECHAT_CHANNEL_PROMPT]);
	});
});

describe("openPeerSession", () => {
	test("creates the session from the workspace and binds the peer's dialogs", async () => {
		const root = tempDir("wechat-peer-");
		const fake = fakeSession();
		const created: CreateAgentSessionOptions[] = [];
		const loaders: Array<[string, string]> = [];
		const uiContext = { custom: () => undefined } as never;
		let reloads = 0;
		const loaded = { reload: async () => void (reloads += 1) } as never;

		const opened = await openPeerSession(peer, {
			cwd: root,
			agentDir: root,
			sessionsDir: join(root, "sessions"),
			uiContext,
			seams: {
				create: async (options) => {
					created.push(options as CreateAgentSessionOptions);
					return { session: fake.session } as never;
				},
				loader: ((cwd: string, agentDir: string) => {
					loaders.push([cwd, agentDir]);
					return loaded;
				}) as never,
			},
		});

		expect(loaders).toEqual([[root, root]]);
		// A fresh loader has discovered nothing yet, so it must be reloaded first.
		expect(reloads).toBe(1);
		expect(created[0]?.cwd).toBe(root);
		expect(created[0]?.resourceLoader).toBe(loaded);
		// One conversation per peer, resumed from that peer's directory.
		expect(peerSessionDir(join(root, "sessions"), peer)).toBe(join(root, "sessions", "o9cq805lvmzhesv0mfq0xwzpjrui"));

		// The peer answers their own dialogs: the UI context is theirs, in RPC mode
		// (dialogs are forwarded, custom components are not).
		expect(fake.bound()?.mode).toBe("rpc");
		expect(fake.bound()?.uiContext).toBe(uiContext);

		opened.dispose();
		expect(fake.disposed()).toBe(1);
	});

	test("activates the tools the extensions registered", async () => {
		const root = tempDir("wechat-peer-");
		const fake = fakeSession([
			{ name: "read", exposure: "direct" },
			{ name: "todo", exposure: "direct" },
			{ name: "open_path", exposure: "codemode" },
		]);
		await openPeerSession(peer, {
			cwd: root,
			agentDir: root,
			sessionsDir: join(root, "sessions"),
			uiContext: {} as never,
			seams: {
				create: async () => ({ session: fake.session }) as never,
				loader: (() => ({ reload: async () => {} })) as never,
			},
		});
		// The peer gets the package's tools; a codemode tool stays as it was.
		expect(fake.active().sort()).toEqual(["read", "todo"]);
	});

	test("keeps only the allowlisted tools", async () => {
		const root = tempDir("wechat-peer-");
		const fake = fakeSession([
			{ name: "read", exposure: "direct" },
			{ name: "todo", exposure: "direct" },
			{ name: "open_path", exposure: "codemode" },
		]);
		const warnings: string[] = [];
		await openPeerSession(peer, {
			cwd: root,
			agentDir: root,
			sessionsDir: join(root, "sessions"),
			uiContext: {} as never,
			toolAllowlist: ["todo", "open_path"],
			onWarning: (message) => warnings.push(message),
			seams: {
				create: async () => ({ session: fake.session }) as never,
				loader: (() => ({ reload: async () => {} })) as never,
			},
		});
		// `open_path` is codemode, so it was not active to begin with; the allowlist
		// keeps the intersection rather than activating it.
		expect(fake.active()).toEqual(["todo"]);
		expect(warnings).toEqual([]);
	});

	test("an allowlist of unknown names leaves no tools and warns", async () => {
		const root = tempDir("wechat-peer-");
		const fake = fakeSession([{ name: "read", exposure: "direct" }]);
		const warnings: string[] = [];
		await openPeerSession(peer, {
			cwd: root,
			agentDir: root,
			sessionsDir: join(root, "sessions"),
			uiContext: {} as never,
			toolAllowlist: ["nope"],
			onWarning: (message) => warnings.push(message),
			seams: {
				create: async () => ({ session: fake.session }) as never,
				loader: (() => ({ reload: async () => {} })) as never,
			},
		});
		expect(fake.active()).toEqual([]);
		expect(warnings[0]).toContain("unknown tools: nope");
	});

	test("reports an extension error with where it happened", async () => {
		const root = tempDir("wechat-peer-");
		const messages: string[] = [];
		const fake = fakeSession();
		await openPeerSession(peer, {
			cwd: root,
			agentDir: root,
			sessionsDir: join(root, "sessions"),
			uiContext: {} as never,
			onError: (message) => messages.push(message),
			seams: {
				create: async () => ({ session: fake.session }) as never,
				loader: (() => ({ reload: async () => {} })) as never,
			},
		});

		fake.bound()?.onError?.({
			extensionPath: "/repo/extensions/web-access/index.ts",
			event: "session_start",
			error: "boom",
		});
		expect(messages).toEqual(["web-access/index.ts (session_start): boom"]);
	});
});
