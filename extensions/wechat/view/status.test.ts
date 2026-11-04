import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { fakeTheme } from "../../../test/helpers/fakes.ts";
import { bridgeStatus } from "../../../test/helpers/fixtures/wechat.ts";
import { settle } from "../../../test/helpers/process.ts";
import { connectionOf, statusLine, statusView, type StatusView, turnValue } from "../text/status.ts";
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
		queued: 0,
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
	test("reads the account, owner, counters, turn, and prompt from the live status", () => {
		const built = statusView(
			screenAccount,
			bridgeStatus({
				state: "running",
				owner: "owner@im.wechat",
				queued: 1,
				turnsRunning: true,
				turn: { status: "running", queued: 1, runningMs: 2_000 },
				promptPending: true,
				prompts: [{ peer: "owner@im.wechat", kind: "select", title: "Pick", startedAt: 10 }],
			}),
			1000,
		);
		expect(built.account).toBe("owner");
		expect(built.owner).toBe("owner");
		expect(built.queued).toBe(1);
		expect(built.turn).toMatchObject({ status: "running", runningMs: 2_000 });
		expect(built.prompts).toEqual([{ title: "Pick", startedAt: 10 }]);
	});

	test("strips control characters a peer put in a prompt title", () => {
		const built = statusView(
			undefined,
			bridgeStatus({ prompts: [{ peer: "a", kind: "input", title: "x\u001b[31m", startedAt: 1 }] }),
		);
		expect(built.prompts[0]?.title).not.toContain("\u001b");
	});
});

describe("statusLine", () => {
	test("summarizes a running conversation", () => {
		const line = statusLine(
			statusView(
				screenAccount,
				bridgeStatus({
					state: "running",
					owner: "owner@im.wechat",
					queued: 2,
					turn: { status: "running", queued: 2, runningMs: 1000 },
				}),
			),
		);
		expect(line).toContain("1 conversation");
		expect(line).toContain("running 1s, 2 queued");
		expect(line).not.toContain("peer");
	});

	test("points at the login when the session expired", () => {
		expect(statusLine(statusView(screenAccount, bridgeStatus({ state: "expired" })))).toContain("/wechat login");
	});
});

describe("turnValue", () => {
	test("names what the conversation is doing", () => {
		expect(turnValue({ status: "running", queued: 0, runningMs: 4200 })).toBe("running 4s");
		expect(turnValue({ status: "queued", queued: 3 })).toBe("queued 3");
		expect(turnValue({ status: "idle", queued: 0 })).toBe("idle");
	});
});

describe("statusBody", () => {
	test("shows the account, connection, turn, and one prompt row", () => {
		const built = view({
			bridge: true,
			account: "owner",
			connection: "open",
			queued: 1,
			turn: { status: "running", queued: 1, runningMs: 2_000 },
			prompts: [{ title: "Pick one", startedAt: 0 }],
			now: 2_000,
		});
		const body = statusBody(built, fakeTheme, 80).join("\n");
		expect(body).toContain("Account");
		expect(body).toContain("owner");
		expect(body).toContain("running 2s, 1 queued");
		expect(body).toContain("Pick one");
		// One conversation: no per-peer list, no focus mark.
		expect(body).not.toContain("Conversations");
		expect(body).not.toContain("❯");
	});

	test("says how to start a bridge a stored account is not running", () => {
		const body = statusBody(view({ account: "owner", connection: "closed" }), fakeTheme, 60).join("\n");
		expect(body).toContain("press t to start the bridge");
	});

	test("shows the expiry and closed recovery lines", () => {
		const expired = statusBody(view({ bridge: true, account: "owner", connection: "expired" }), fakeTheme, 60).join(
			"\n",
		);
		expect(expired).toContain("press l to log in again");
		expect(statusBody(view(), fakeTheme, 60).join("\n")).toContain("Run /wechat login");
	});

	test("fits every line to a narrow width", () => {
		const built = view({
			bridge: true,
			account: "a-very-long-account-name",
			connection: "open",
			queued: 12,
			turn: { status: "running", queued: 12, runningMs: 1_000 },
			refused: 3,
			refusedPeers: ["stranger"],
		});
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

function withActions() {
	const stops: string[] = [];
	const cancels: string[] = [];
	const toggles: string[] = [];
	const built = component(view({ bridge: true, connection: "open" }), {
		stop: () => {
			stops.push("stop");
			return "Stopping the running turn.";
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
	return { ...built, stops, cancels, toggles };
}

describe("turn actions", () => {
	test("stops the running turn and flashes the result", () => {
		const { screen, actions, stops } = withActions();
		screen.handleInput("s");
		expect(stops).toEqual(["stop"]);
		expect(actions).toEqual([]);
		expect(screen.render(60).join("\n")).toContain("Stopping the running turn.");
	});

	test("cancels the waiting prompt on c and flashes the result", () => {
		const cancels: string[] = [];
		const { screen } = component(
			view({
				bridge: true,
				connection: "open",
				promptPending: true,
				prompts: [{ title: "Pick one", startedAt: 1_000 }],
			}),
			{
				stop: () => "",
				cancelPrompt: () => {
					cancels.push("cancel");
					return "Cancelled the waiting prompt.";
				},
				toggleBridge: () => "Started the bridge.",
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

	test("says the turn cannot be stopped when the screen has no actions", () => {
		const { screen } = component(view({ bridge: true, connection: "open" }));
		screen.handleInput("s");
		expect(screen.render(60).join("\n")).toContain("Stopping the turn is unavailable here.");
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

	test("closes with the verb a global key names", () => {
		const { screen, actions } = withActions();
		screen.handleInput("l");
		expect(actions).toEqual([{ verb: "login" }]);
	});

	test("closes on escape", () => {
		const { screen, actions } = withActions();
		screen.handleInput("\u001b");
		expect(actions).toEqual(["close"]);
	});
});

describe("StatusScreenComponent", () => {
	test("hints only the keys it still has", () => {
		const { screen } = withActions();
		const hints = screen.render(100).at(-2) ?? "";
		expect(hints).toContain("s stop");
		expect(hints).toContain("c cancel prompt");
		expect(hints).not.toContain("j/k");
		expect(hints).not.toContain("d reset");
	});

	test("renders lines that fit the width", () => {
		const { screen } = withActions();
		for (const width of [40, 80, 120]) {
			for (const line of screen.render(width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
	});

	test("exposes no member named focused for the host to overwrite", () => {
		expect("focused" in component(view())).toBe(false);
	});
});
