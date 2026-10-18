import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { coloringTheme, fakeTheme } from "../../test/helpers/fakes.ts";
import type { BridgeStatus } from "./bridge.ts";
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
import type { BotCredentials } from "./types.ts";

const account: BotCredentials = {
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

describe("connectionOf", () => {
	test("treats a missing or unopened bridge as closed", () => {
		expect(connectionOf(undefined)).toBe("closed");
		expect(connectionOf(bridgeStatus())).toBe("closed");
	});

	test("reports open and the persistent expired state", () => {
		expect(connectionOf(bridgeStatus({ open: true }))).toBe("open");
		expect(connectionOf(bridgeStatus({ expired: true }))).toBe("expired");
		expect(connectionOf(bridgeStatus({ paused: true }))).toBe("paused");
	});
});

describe("statusView", () => {
	test("reads the account, owner, and counters from the live status", () => {
		const built = statusView(
			account,
			bridgeStatus({ open: true, owner: "owner@im.wechat", peerCount: 2, queued: 1, promptPending: true }),
		);
		expect(built).toMatchObject({
			bridge: true,
			account: "owner",
			connection: "open",
			owner: "owner",
			peers: 2,
			queued: 1,
			promptPending: true,
		});
	});

	test("reports no bridge when there is no status", () => {
		expect(statusView(undefined, undefined)).toMatchObject({ bridge: false, connection: "closed" });
	});
});

describe("statusLine", () => {
	test("summarizes a closed, not-logged-in bridge", () => {
		expect(statusLine(view())).toBe("wechat: not logged in · closed");
	});

	test("includes the counters and owner when a bridge exists", () => {
		const line = statusLine(
			view({ bridge: true, account: "owner", owner: "owner", connection: "open", peers: 2, queued: 1 }),
		);
		expect(line).toContain("account owner");
		expect(line).toContain("2 peer(s)");
		expect(line).toContain("1 queued");
		expect(line).toContain("owner owner");
	});

	test("points at the login recovery when expired", () => {
		expect(statusLine(view({ bridge: true, account: "owner", connection: "expired" }))).toContain(
			"run /wechat login to reconnect",
		);
	});
});

describe("per-peer rows", () => {
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

	test("the one-line summary names the running peer", () => {
		expect(statusLine(view({ bridge: true, account: "owner", connection: "open", peerRows: rows }))).toContain(
			"running alice",
		);
	});
});

describe("statusBody", () => {
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

	test("shows the expiry recovery line", () => {
		const body = statusBody(view({ bridge: true, account: "owner", connection: "expired" }), fakeTheme, 60).join("\n");
		expect(body).toContain("press l to log in again");
	});

	test("points a closed, not-logged-in view at login", () => {
		expect(statusBody(view(), fakeTheme, 60).join("\n")).toContain("Run /wechat login");
	});

	test("points a closed, logged-in view at login", () => {
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
		const { screen } = component(view({ bridge: true, connection: "open" }), {
			stop: () => "",
			reset: () => "",
			cancelPrompt: () => "",
			togglePause: async () => {
				await Bun.sleep(1);
				return "Resumed polling.";
			},
		});
		screen.handleInput("p");
		expect(screen.render(60).join("\n")).toContain("Pausing…");
		await Bun.sleep(5);
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

	test("asks to log in on l", () => {
		const { screen, actions } = component(view());
		screen.handleInput("l");
		expect(actions).toEqual(["login"]);
	});

	test("asks for a new session on n", () => {
		const { screen, actions } = component(view({ bridge: true, connection: "open" }));
		screen.handleInput("n");
		expect(actions).toEqual(["new"]);
	});

	test("asks to log out on o", () => {
		const { screen, actions } = component(view({ bridge: true, connection: "open" }));
		screen.handleInput("o");
		expect(actions).toEqual(["logout"]);
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
