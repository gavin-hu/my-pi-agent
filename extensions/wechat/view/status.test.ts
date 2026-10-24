import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { coloringTheme, fakeTheme } from "../../../test/helpers/fakes.ts";
import { settle } from "../../../test/helpers/process.ts";
import type { BridgeStatus } from "../bridge.ts";
import { DEFAULT_CONFIG } from "../config.ts";
import { doctorReport } from "../commands/doctor.ts";
import {
	chunkText,
	parseInbound,
	peerKey,
	peerLabel,
	peerLanguage,
	sanitizeInbound,
	toWechatText,
} from "../text/format.ts";
import {
	connectionOf,
	type StatusAction,
	type StatusActions,
	StatusScreenComponent,
	statusBody,
	statusLine,
	statusView,
	type StatusView,
} from "./status-screen.ts";
import type { BotCredentials } from "../types.ts";

const screenAccount: BotCredentials = {
	botToken: "t",
	ilinkUserId: "owner@im.wechat",
	ilinkBotId: "b",
	baseUrl: "https://base",
	botAgent: "ag",
	createdAt: 0,
};

function bridgeStatus(overrides: Partial<BridgeStatus> = {}): BridgeStatus {
	return {
		open: false,
		expired: false,
		paused: false,
		running: false,
		peerCount: 0,
		queued: 0,
		peerStates: [],
		refused: 0,
		refusedPeers: [],
		mediaDropped: 0,
		promptPending: false,
		...overrides,
	};
}

function view(overrides: Partial<StatusView> = {}): StatusView {
	return {
		bridge: false,
		connection: "closed",
		peers: 0,
		queued: 0,
		peerRows: [],
		refused: 0,
		refusedPeers: [],
		mediaDropped: 0,
		promptPending: false,
		...overrides,
	};
}

describe("inbound text", () => {
	test("sanitizes control characters, line endings, and surrounding space", () => {
		expect(sanitizeInbound("hi\u0007\r\nthere")).toBe("hi\nthere");
		expect(sanitizeInbound("  hello  ")).toBe("hello");
	});

	test("labels a peer without the im.wechat suffix", () => {
		expect(peerLabel("wxid_1@im.wechat")).toBe("wxid_1");
		expect(peerLabel("wxid_1")).toBe("wxid_1");
	});

	test("keys either id form by normalized case and suffix", () => {
		expect(peerKey(" Alice@IM.WeChat ")).toBe("alice");
		expect(peerKey("alice")).toBe("alice");
	});

	test("chunks at a line break or by force, and keeps a short text whole", () => {
		expect(chunkText("short", 100)).toEqual(["short"]);
		expect(chunkText("aaaa\nbbbb", 6)).toEqual(["aaaa", "bbbb"]);
		expect(chunkText("abcdefgh", 3)).toEqual(["abc", "def", "gh"]);
		expect(chunkText("abcdefgh", 0)).toEqual(["abcdefgh"]);
	});

	test("answers in Chinese for CJK text and English otherwise", () => {
		expect(peerLanguage("你好，帮我看看")).toBe("zh");
		expect(peerLanguage("please take a look")).toBe("en");
		expect(peerLanguage("1")).toBe("en");
	});
});

describe("flattening Markdown for a chat window", () => {
	test("drops fences and keeps the code block body verbatim", () => {
		const text = toWechatText(["Look:", "```ts", "const a = `x`;", "```"].join("\n"));
		expect(text).toBe("Look:\nconst a = `x`;");
	});

	test("does not rewrite Markdown-looking lines inside a fence", () => {
		const text = toWechatText(
			["```bash", "# not a heading", "echo `date` **bold** ~~gone~~", "```", "## Heading"].join("\n"),
		);
		expect(text).toBe("# not a heading\necho `date` **bold** ~~gone~~\nHeading");
	});

	test("keeps blank runs inside a fence but collapses them outside", () => {
		const text = toWechatText(["```", "a", "", "", "b", "```", "", "", "c"].join("\n"));
		expect(text).toBe("a\n\n\nb\n\nc");
	});

	test("strips heading, emphasis, and inline-code markers", () => {
		expect(toWechatText("## Plan\n**bold** and __also__ and `code` and ~~gone~~")).toBe(
			"Plan\nbold and also and code and gone",
		);
	});

	test("removes control characters, collapses blank runs, and leaves plain text alone", () => {
		expect(toWechatText("a\u0007\n\n\n\nb")).toBe("a\n\nb");
		expect(toWechatText("it is a cat")).toBe("it is a cat");
	});
});

describe("parsing an inbound message", () => {
	test("concatenates text items and sanitizes them", () => {
		const result = parseInbound([
			{ type: 1, text_item: { text: "hi" } },
			{ type: 1, text_item: { text: "there\u0007" } },
		]);
		expect(result.text).toBe("hi\nthere");
		expect(result.media).toEqual([]);
	});

	test("uses a voice transcript as text", () => {
		const result = parseInbound([{ type: 3, voice_item: { text: "spoken words" } }]);
		expect(result.text).toBe("spoken words");
	});

	test("collects an image with its hex key", () => {
		const result = parseInbound([{ type: 2, image_item: { media: { encrypt_query_param: "p" }, aeskey: "ab" } }]);
		expect(result.media).toEqual([{ kind: "image", media: { encrypt_query_param: "p" }, aeskey: "ab" }]);
	});

	test("collects a file with its sanitized name", () => {
		const result = parseInbound([
			{ type: 4, file_item: { media: { full_url: "https://cdn/f" }, file_name: "a/b.txt" } },
		]);
		expect(result.media).toEqual([{ kind: "file", media: { full_url: "https://cdn/f" }, fileName: "a_b.txt" }]);
	});

	test("counts video and unknown-but-unreadable items as unsupported", () => {
		const result = parseInbound([{ type: 5, video_item: { media: { full_url: "https://cdn/v" } } }, { type: 99 }]);
		expect(result.text).toBe("");
		expect(result.media).toEqual([]);
		// Video is something a peer meant to send; type 99 is not.
		expect(result.unsupported).toBe(1);
	});

	test("counts a voice note without a transcript as unsupported", () => {
		const result = parseInbound([{ type: 3, voice_item: { media: { full_url: "https://cdn/v" } } }]);
		expect(result.text).toBe("");
		expect(result.unsupported).toBe(1);
	});

	test("keeps a media-only message with empty text and skips an unusable reference", () => {
		const image = parseInbound([{ type: 2, image_item: { media: { full_url: "https://cdn/i" } } }]);
		expect(image.text).toBe("");
		expect(image.media).toHaveLength(1);
		expect(parseInbound([{ type: 2, image_item: { media: {} } }]).media).toEqual([]);
	});
});

describe("connectionOf", () => {
	test("treats a missing or unopened bridge as closed", () => {
		expect(connectionOf(undefined)).toBe("closed");
		expect(connectionOf(bridgeStatus())).toBe("closed");
	});

	test("reports open, paused, and the persistent expired state", () => {
		expect(connectionOf(bridgeStatus({ open: true }))).toBe("open");
		expect(connectionOf(bridgeStatus({ expired: true }))).toBe("expired");
		expect(connectionOf(bridgeStatus({ paused: true }))).toBe("paused");
	});
});

describe("statusView", () => {
	test("reads the account, owner, counters, and prompt from the live status", () => {
		const built = statusView(
			screenAccount,
			bridgeStatus({
				open: true,
				owner: "owner@im.wechat",
				peerCount: 2,
				queued: 1,
				promptPending: true,
				prompt: { peer: "alice@im.wechat", kind: "select", title: "Pick", startedAt: 10 },
			}),
			1000,
		);
		expect(built).toMatchObject({
			bridge: true,
			account: "owner",
			connection: "open",
			owner: "owner",
			peers: 2,
			queued: 1,
			promptPending: true,
			prompt: { peer: "alice", title: "Pick", startedAt: 10 },
			now: 1000,
		});
	});

	test("reports no bridge when there is no status", () => {
		expect(statusView(undefined, undefined, 0)).toMatchObject({ bridge: false, connection: "closed" });
	});
});

describe("statusLine", () => {
	test("summarizes a closed, not-logged-in bridge", () => {
		const line = statusLine(view());
		expect(line).toContain("not logged in");
		expect(line).toContain("closed");
	});

	test("includes the account, counters, owner, and running peer", () => {
		const line = statusLine(
			view({
				bridge: true,
				account: "owner",
				owner: "owner",
				connection: "open",
				peers: 2,
				queued: 1,
				peerRows: [{ label: "alice", status: "running", queued: 0, runningMs: 1000 }],
			}),
		);
		expect(line).toContain("account owner");
		expect(line).toContain("2 peer(s)");
		expect(line).toContain("1 queued");
		expect(line).toContain("owner owner");
		expect(line).toContain("running alice");
	});

	test("points at the login recovery when expired", () => {
		expect(statusLine(view({ bridge: true, account: "owner", connection: "expired" }))).toContain(
			"run /wechat login to reconnect",
		);
	});
});

describe("statusBody", () => {
	const rows = [
		{ label: "alice", status: "running" as const, queued: 1, runningMs: 42_400 },
		{ label: "bob", status: "queued" as const, queued: 2 },
		{ label: "carol", status: "idle" as const, queued: 0 },
	];

	test("lists what each conversation is doing, with the elapsed time", () => {
		const body = statusBody(view({ bridge: true, connection: "open", peerRows: rows }), fakeTheme, 60).join("\n");
		expect(body).toContain("Conversations");
		expect(body).toContain("running 42s, 1 queued");
		expect(body).toContain("queued 2");
		expect(body).toContain("idle");
	});

	test("caps the list and counts the rest", () => {
		const many = Array.from({ length: 8 }, (_unused, index) => ({
			label: `peer${index}`,
			status: "idle" as const,
			queued: 0,
		}));
		const body = statusBody(view({ bridge: true, connection: "open", peerRows: many }), fakeTheme, 60).join("\n");
		expect(body).toContain("+3 more");
	});

	test("fits the width even for a long peer label", () => {
		const long = [{ label: "a".repeat(40), status: "running" as const, queued: 0, runningMs: 1000 }];
		for (const line of statusBody(view({ bridge: true, connection: "open", peerRows: long }), fakeTheme, 20)) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(20);
		}
	});

	test("names the refused senders so one can be allowlisted", () => {
		const body = statusBody(
			view({ bridge: true, account: "owner", connection: "open", refused: 2, refusedPeers: ["alice", "bob"] }),
			fakeTheme,
			60,
		).join("\n");
		expect(body).toContain("alice, bob");
		expect(statusLine(view({ bridge: true, refused: 2, refusedPeers: ["alice"] }))).toContain("(alice)");
	});

	test("colors the connection and shows the account", () => {
		const body = statusBody(view({ account: "owner", connection: "open" }), coloringTheme, 40).join("\n");
		expect(body).toContain("Account");
		expect(body).toContain("[success]open");
	});

	test("hides the activity counters without a bridge", () => {
		const body = statusBody(view({ account: "owner" }), fakeTheme, 40).join("\n");
		expect(body).not.toContain("Peers");
		expect(body).not.toContain("Queued");
	});

	test("shows the counters and a pending prompt with a bridge", () => {
		const built = view({
			bridge: true,
			account: "owner",
			connection: "open",
			peers: 2,
			queued: 1,
			promptPending: true,
		});
		const body = statusBody(built, fakeTheme, 60).join("\n");
		expect(body).toContain("Peers");
		expect(body).toContain("Prompt");
		expect(body).toContain("waiting for a reply");
	});

	test("shows the waiting prompt's peer, title, and age", () => {
		const built = view({
			bridge: true,
			account: "owner",
			connection: "open",
			promptPending: true,
			prompt: { peer: "alice", title: "Pick one", startedAt: 1_000 },
			now: 43_000,
		});
		const body = statusBody(built, fakeTheme, 60).join("\n");
		expect(body).toContain("alice");
		expect(body).toContain("Pick one");
		expect(body).toContain("42.0s");
	});

	test("shows the paused state and how to resume", () => {
		const built = view({ bridge: true, account: "owner", connection: "paused", peers: 1 });
		const body = statusBody(built, fakeTheme, 60).join("\n");
		expect(body).toContain("paused");
		expect(body).toContain("press p to resume");
		expect(statusLine(built)).toContain("paused");
	});

	test("shows the expiry and closed recovery lines", () => {
		const expired = statusBody(view({ bridge: true, account: "owner", connection: "expired" }), fakeTheme, 60).join(
			"\n",
		);
		expect(expired).toContain("press l to log in again");
		expect(statusBody(view(), fakeTheme, 60).join("\n")).toContain("Run /wechat login");
		expect(statusBody(view({ account: "owner" }), fakeTheme, 60).join("\n")).toContain("press l to log in again");
	});

	test("fits every line to a narrow width", () => {
		const built = view({ bridge: true, account: "a-very-long-account-name", connection: "open", peers: 12, queued: 3 });
		for (const line of statusBody(built, fakeTheme, 8)) expect(visibleWidth(line)).toBeLessThanOrEqual(8);
	});
});

function component(current: StatusView, peerActions?: StatusActions) {
	const actions: StatusAction[] = [];
	let renders = 0;
	const screen = new StatusScreenComponent({
		theme: fakeTheme,
		view: () => current,
		onClose: (action) => actions.push(action),
		actions: peerActions,
		requestRender: () => {
			renders += 1;
		},
	});
	return { screen, actions, renders: () => renders };
}

const peers = [
	{ id: "alice@im.wechat", label: "alice", status: "running" as const, queued: 0, runningMs: 1000 },
	{ id: "bob@im.wechat", label: "bob", status: "idle" as const, queued: 0 },
];

function withActions() {
	const stops: string[] = [];
	const resets: string[] = [];
	const cancels: string[] = [];
	const toggles: string[] = [];
	const built = component(view({ bridge: true, connection: "open", peerRows: peers }), {
		stop: (peer) => {
			stops.push(peer);
			return `Stopping ${peer}.`;
		},
		reset: (peer) => {
			resets.push(peer);
			return `Reset ${peer}.`;
		},
		cancelPrompt: () => {
			cancels.push("cancel");
			return "Cancelled the waiting prompt.";
		},
		togglePause: () => {
			toggles.push("toggle");
			return "Paused polling.";
		},
	});
	return { ...built, stops, resets, cancels, toggles };
}

describe("peer actions", () => {
	test("stops the focused peer in place and flashes the result", () => {
		const { screen, actions, stops } = withActions();
		screen.handleInput("s");
		expect(stops).toEqual(["alice@im.wechat"]);
		expect(actions).toEqual([]);
		expect(screen.render(60).join("\n")).toContain("Stopping alice@im.wechat.");
	});

	test("moves the focus with j and acts on the new row", () => {
		const { screen, stops } = withActions();
		screen.handleInput("j");
		screen.handleInput("s");
		expect(stops).toEqual(["bob@im.wechat"]);
	});

	test("resets the focused peer", () => {
		const { screen, resets } = withActions();
		screen.handleInput("d");
		expect(resets).toEqual(["alice@im.wechat"]);
		expect(screen.render(60).join("\n")).toContain("Reset alice@im.wechat.");
	});

	test("cancels the waiting prompt on c and flashes the result", () => {
		const cancels: string[] = [];
		const { screen } = component(
			view({
				bridge: true,
				connection: "open",
				promptPending: true,
				prompt: { peer: "alice", title: "Pick one", startedAt: 1_000 },
			}),
			{
				stop: () => "",
				reset: () => "",
				cancelPrompt: () => {
					cancels.push("cancel");
					return "Cancelled the waiting prompt.";
				},
				togglePause: () => "Paused polling.",
			},
		);
		screen.handleInput("c");
		expect(cancels).toEqual(["cancel"]);
		expect(screen.render(60).join("\n")).toContain("Cancelled the waiting prompt.");
	});

	test("explains when there is no prompt to cancel", () => {
		const { screen, cancels } = withActions();
		screen.handleInput("c");
		expect(cancels).toEqual([]);
		expect(screen.render(60).join("\n")).toContain("No prompt waiting.");
	});

	test("asks to allow a refused sender on a", () => {
		const { screen, actions } = component(
			view({ bridge: true, connection: "open", refused: 1, refusedPeers: ["alice"] }),
		);
		screen.handleInput("a");
		expect(actions).toEqual([{ kind: "allow" }]);
	});

	test("toggles pausing on p and flashes the result", () => {
		const { screen, toggles } = withActions();
		screen.handleInput("p");
		expect(toggles).toEqual(["toggle"]);
		expect(screen.render(60).join("\n")).toContain("Paused polling.");
	});

	test("shows progress while an async pause settles", async () => {
		let finish: ((line: string) => void) | undefined;
		const { screen } = component(view({ bridge: true, connection: "open" }), {
			stop: () => "",
			reset: () => "",
			cancelPrompt: () => "",
			togglePause: () =>
				new Promise<string>((resolve) => {
					finish = resolve;
				}),
		});
		screen.handleInput("p");
		expect(screen.render(60).join("\n")).toContain("Pausing…");
		finish?.("Resumed polling.");
		await settle();
		expect(screen.render(60).join("\n")).toContain("Resumed polling.");
	});

	test("explains when there is no bridge to pause", () => {
		const { screen } = component(view());
		screen.handleInput("p");
		expect(screen.render(60).join("\n")).toContain("WeChat is not running.");
	});

	test("opens the focused peer's history", () => {
		const { screen, actions } = withActions();
		screen.handleInput("h");
		expect(actions).toEqual([{ kind: "history", peer: "alice@im.wechat" }]);
	});

	test("explains when there is no peer to act on", () => {
		const { screen, actions } = component(view({ bridge: true, connection: "open" }));
		screen.handleInput("s");
		expect(actions).toEqual([]);
		expect(screen.render(60).join("\n")).toContain("No peer conversation yet.");
	});

	test("marks the focused row", () => {
		const { screen } = withActions();
		screen.handleInput("j");
		expect(screen.render(60).join("\n")).toContain("❯");
	});
});

describe("StatusScreenComponent", () => {
	test("closes on escape", () => {
		const { screen, actions } = component(view());
		screen.handleInput("\u001b");
		expect(actions).toEqual(["close"]);
	});

	test("asks to log in, start a new session, or log out", () => {
		const login = component(view());
		login.screen.handleInput("l");
		expect(login.actions).toEqual(["login"]);

		const session = component(view({ bridge: true, connection: "open" }));
		session.screen.handleInput("n");
		expect(session.actions).toEqual(["new"]);

		const logout = component(view({ bridge: true, connection: "open" }));
		logout.screen.handleInput("o");
		expect(logout.actions).toEqual(["logout"]);
	});

	test("accepts the uppercase form of each action key", () => {
		const login = component(view());
		login.screen.handleInput("L");
		expect(login.actions).toEqual(["login"]);
		const session = component(view());
		session.screen.handleInput("N");
		expect(session.actions).toEqual(["new"]);
		const logout = component(view());
		logout.screen.handleInput("O");
		expect(logout.actions).toEqual(["logout"]);
		const refresh = component(view());
		refresh.screen.handleInput("R");
		expect(refresh.renders()).toBe(1);
	});

	test("does not close on a peer action key", () => {
		const { screen, actions } = component(view({ bridge: true, connection: "open" }));
		screen.handleInput("s");
		expect(actions).toEqual([]);
	});

	test("refreshes on r", () => {
		const { screen, renders } = component(view());
		screen.handleInput("r");
		expect(renders()).toBe(1);
	});

	test("renders lines that fit the width", () => {
		const { screen } = component(view({ bridge: true, account: "owner", connection: "open" }));
		for (const line of screen.render(20)) expect(visibleWidth(line)).toBeLessThanOrEqual(20);
	});

	test("exposes no member named focused for the host to overwrite", () => {
		const { screen } = component(view({ bridge: true, connection: "open", peerRows: peers }));
		// Pi's setFocus duck-types focusables with `"focused" in component` and then
		// assigns a boolean there, which would shadow a method of that name.
		expect("focused" in screen).toBe(false);
	});
});

const doctorNow = 10_000_000;
const doctorAccount: BotCredentials = {
	botToken: "t",
	ilinkUserId: "owner@im.wechat",
	ilinkBotId: "b",
	baseUrl: "https://base",
	botAgent: "ag",
	createdAt: doctorNow - 2 * 60 * 60 * 1000,
};

function doctorStatus(overrides: Partial<BridgeStatus> = {}): BridgeStatus {
	return {
		open: true,
		expired: false,
		paused: false,
		owner: "owner@im.wechat",
		peerCount: 1,
		queued: 2,
		running: true,
		peerStates: [
			{
				peer: "alice@im.wechat",
				state: { status: "running", queued: 2, runningMs: 42_000, sessionAgeMs: 60 * 60 * 1000 },
			},
		],
		refused: 1,
		refusedPeers: ["bob"],
		mediaDropped: 2,
		promptPending: false,
		startedAt: doctorNow - 1000,
		lastPollAt: doctorNow - 3200,
		pollHoldMs: 18_000,
		tokenCreatedAt: doctorAccount.createdAt,
		lock: { pid: 1234, at: doctorNow - 240_000 },
		...overrides,
	};
}

describe("doctorReport", () => {
	test("reports the connection, poll, lock, peers, media, and config", () => {
		const text = doctorReport({
			status: doctorStatus(),
			account: doctorAccount,
			config: DEFAULT_CONFIG,
			now: doctorNow,
		});
		expect(text).toContain("wechat");
		expect(text).toContain("health");
		expect(text).toContain("owner owner");
		expect(text).toContain("2h00m old");
		expect(text).toContain("last 3.2s");
		expect(text).toContain("hold 18.0s");
		expect(text).toContain("pid 1234");
		expect(text).toContain("4m00s ago");
		expect(text).toContain("1 running");
		expect(text).toContain("2 queued");
		expect(text).toContain("alice");
		expect(text).toContain("running 42.0s");
		expect(text).toContain("session 1h00m");
		expect(text).toContain("2 dropped");
		expect(text).toContain("1 refused (bob)");
		expect(text).toContain("no prompt");
		expect(text).toContain("typing on");
		expect(text).toContain("prompts on");
	});

	test("reports the last poll and send failures", () => {
		const text = doctorReport({
			status: doctorStatus({ lastPollError: "rejected ret -1", lastSendError: "context token invalid" }),
			account: doctorAccount,
			config: DEFAULT_CONFIG,
			now: doctorNow,
		});
		expect(text).toContain("send: context token invalid");
		expect(text).toContain("poll: rejected ret -1");
	});

	test("treats a paused bridge as resumable", () => {
		const text = doctorReport({
			status: doctorStatus({ open: false, paused: true, peerStates: [], queued: 0, lock: undefined }),
			account: doctorAccount,
			config: DEFAULT_CONFIG,
			now: doctorNow,
		});
		expect(text).toContain("paused");
		expect(text).toContain("/wechat resume");
	});

	test("treats an expired bridge as needing a login", () => {
		const text = doctorReport({
			status: doctorStatus({ open: false, expired: true, peerStates: [], queued: 0, lock: undefined }),
			account: doctorAccount,
			config: DEFAULT_CONFIG,
			now: doctorNow,
		});
		expect(text).toContain("expired");
		expect(text).toContain("/wechat login");
		expect(text).toContain("not running");
	});

	test("reports a never-started bridge without inventing facts", () => {
		const text = doctorReport({ status: undefined, account: undefined, config: DEFAULT_CONFIG, now: doctorNow });
		expect(text).toContain("closed");
		expect(text).toContain("not started");
		expect(text).toContain("not running");
		expect(text).toContain("none");
		expect(text).toContain("no recent failure");
	});

	test("reports a full queue and a waiting prompt", () => {
		const text = doctorReport({
			status: doctorStatus({ peerStates: [], queued: 8, promptPending: true }),
			account: doctorAccount,
			config: DEFAULT_CONFIG,
			now: doctorNow,
		});
		expect(text).toContain("prompt waiting");
	});

	test("counts the configured peer overrides and turn cap", () => {
		const text = doctorReport({
			status: doctorStatus(),
			account: doctorAccount,
			config: { ...DEFAULT_CONFIG, allowedPeers: ["bob"], peers: { bob: { tools: ["read"] } }, maxTurnsPerHour: 12 },
			now: doctorNow,
		});
		expect(text).toContain("1 allowed");
		expect(text).toContain("1 peer override(s)");
		expect(text).toContain("12 turns/h");
	});
});
