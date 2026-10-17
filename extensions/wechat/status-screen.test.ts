import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { coloringTheme, fakeTheme } from "../../test/helpers/fakes.ts";
import type { BridgeStatus } from "./bridge.ts";
import {
	connectionOf,
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
		peerCount: 0,
		queued: 0,
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

function component(current: StatusView) {
	const actions: string[] = [];
	let renders = 0;
	const screen = new StatusScreenComponent({
		theme: fakeTheme,
		view: () => current,
		onClose: (action) => actions.push(action),
		requestRender: () => {
			renders += 1;
		},
	});
	return { screen, actions, renders: () => renders };
}

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

	test("ignores other keys now that there is no start/stop control", () => {
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
});
