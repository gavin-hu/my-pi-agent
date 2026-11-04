import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { coloringTheme, fakeTheme } from "../../../test/helpers/fakes.ts";
import { bridgeStatus } from "../../../test/helpers/fixtures/wechat.ts";
import { settle } from "../../../test/helpers/process.ts";
import { connectionOf, statusLine, statusView, type StatusView } from "../text/status.ts";
import { type StatusAction, type StatusActions, StatusScreenComponent, statusBody } from "./status-screen.ts";
import type { BotCredentials } from "../types.ts";

const screenAccount: BotCredentials = {
	botToken: "t",
	ilinkUserId: "owner@im.wechat",
	ilinkBotId: "b",
	baseUrl: "https://base",
	botAgent: "ag",
	createdAt: 0,
};

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
		prompts: [],
		...overrides,
	};
}

describe("connectionOf", () => {
	test("treats a missing or unopened bridge as closed", () => {
		expect(connectionOf(undefined)).toBe("closed");
		expect(connectionOf(bridgeStatus())).toBe("closed");
	});

	test("reports open and the persistent expired state", () => {
		expect(connectionOf(bridgeStatus({ state: "running" }))).toBe("open");
		expect(connectionOf(bridgeStatus({ state: "expired" }))).toBe("expired");
	});
});

describe("statusView", () => {
	test("reads the account, owner, counters, and prompt from the live status", () => {
		const built = statusView(
			screenAccount,
			bridgeStatus({
				state: "running",
				owner: "owner@im.wechat",
				peerCount: 2,
				queued: 1,
				promptPending: true,
				prompts: [{ peer: "alice@im.wechat", kind: "select", title: "Pick", startedAt: 10 }],
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
			prompts: [{ peer: "alice", title: "Pick", startedAt: 10 }],
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

	test("points at the login and the start when expired", () => {
		expect(statusLine(view({ bridge: true, account: "owner", connection: "expired" }))).toContain(
			"run /wechat login, then /wechat start",
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

	test("shows each waiting prompt's peer, title, and age", () => {
		const built = view({
			bridge: true,
			account: "owner",
			connection: "open",
			promptPending: true,
			prompts: [
				{ peer: "alice", title: "Pick one", startedAt: 1_000 },
				{ peer: "bob", title: "Continue?", startedAt: 41_000 },
			],
			now: 43_000,
		});
		const body = statusBody(built, fakeTheme, 60).join("\n");
		// Two peers run at once, so two questions can wait: one line each.
		expect(body).toContain("alice");
		expect(body).toContain("Pick one");
		expect(body).toContain("42.0s");
		expect(body).toContain("bob");
		expect(body).toContain("Continue?");
		expect(body).toContain("2.0s");
	});

	test("says how to start a bridge a stored account is not running", () => {
		const body = statusBody(view({ account: "owner", connection: "closed" }), fakeTheme, 60).join("\n");
		expect(body).toContain("press t to start the bridge");
	});

	test("shows the expiry and closed recovery lines", () => {
		const expired = statusBody(view({ bridge: true, account: "owner", connection: "expired" }), fakeTheme, 60).join(
			"\n",
		);
		expect(expired).toContain("press l to log in, then t to start");
		expect(statusBody(view(), fakeTheme, 60).join("\n")).toContain("Run /wechat login");
		expect(statusBody(view({ account: "owner" }), fakeTheme, 60).join("\n")).toContain("press t to start the bridge");
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
		toggleBridge: () => {
			toggles.push("toggle");
			return "Started the bridge.";
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
				prompts: [{ peer: "alice", title: "Pick one", startedAt: 1_000 }],
				// A prompt implies the peer's own turn is running, so it has a row.
				peerRows: [{ id: "alice@im.wechat", label: "alice", status: "running", queued: 0 }],
			}),
			{
				stop: () => "",
				reset: () => "",
				cancelPrompt: (peer) => {
					cancels.push(peer);
					return "Cancelled the waiting prompt.";
				},
				toggleBridge: () => "Started the bridge.",
			},
		);
		screen.handleInput("c");
		// The focused peer's own prompt is withdrawn, never the other peer's.
		expect(cancels).toEqual(["alice@im.wechat"]);
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
		expect(actions).toEqual([{ verb: "allow" }]);
	});

	test("starts or stops the bridge on t and flashes the result", () => {
		const { screen, toggles } = withActions();
		screen.handleInput("t");
		expect(toggles).toEqual(["toggle"]);
		expect(screen.render(60).join("\n")).toContain("Started the bridge.");
	});

	test("shows progress while an async start settles", async () => {
		let finish: ((line: string) => void) | undefined;
		const { screen } = component(view({ account: "owner", connection: "closed" }), {
			stop: () => "",
			reset: () => "",
			cancelPrompt: () => "",
			toggleBridge: () =>
				new Promise<string>((resolve) => {
					finish = resolve;
				}),
		});
		screen.handleInput("t");
		expect(screen.render(60).join("\n")).toContain("Starting…");
		finish?.("Started the bridge.");
		await settle();
		expect(screen.render(60).join("\n")).toContain("Started the bridge.");
	});

	test("opens the focused peer's history", () => {
		const { screen, actions } = withActions();
		screen.handleInput("h");
		expect(actions).toEqual([{ verb: "history", peer: "alice@im.wechat" }]);
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
		expect(login.actions).toEqual([{ verb: "login" }]);

		const session = component(view({ bridge: true, connection: "open" }));
		session.screen.handleInput("n");
		expect(session.actions).toEqual([{ verb: "new" }]);

		const logout = component(view({ bridge: true, connection: "open" }));
		logout.screen.handleInput("o");
		expect(logout.actions).toEqual([{ verb: "logout" }]);
	});

	test("accepts the uppercase form of each action key", () => {
		const login = component(view());
		login.screen.handleInput("L");
		expect(login.actions).toEqual([{ verb: "login" }]);
		const session = component(view());
		session.screen.handleInput("N");
		expect(session.actions).toEqual([{ verb: "new" }]);
		const logout = component(view());
		logout.screen.handleInput("O");
		expect(logout.actions).toEqual([{ verb: "logout" }]);
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
