import { describe, expect, test } from "bun:test";
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import {
	type InteractionAnswer,
	type InteractionChannel,
	type InteractionRequest,
	isRemoteTurn,
} from "../../lib/interaction.ts";
import { createPeerUIContext, installRemoteUI } from "./remote-ui.ts";

function fakeUI() {
	const calls = { select: 0, confirm: 0, input: 0, editor: 0, custom: 0 };
	const original = {
		select: async () => {
			calls.select += 1;
			return "local-select";
		},
		confirm: async () => {
			calls.confirm += 1;
			return true;
		},
		input: async () => {
			calls.input += 1;
			return "local-input";
		},
		editor: async () => {
			calls.editor += 1;
			return "local-editor";
		},
		custom: async () => {
			calls.custom += 1;
			return "local-custom";
		},
	};
	const ui = { ...original } as unknown as ExtensionUIContext;
	return { ui, calls, original };
}

function fakeChannel(answer: InteractionAnswer = { kind: "value", value: "remote" }) {
	const requests: InteractionRequest[] = [];
	let active = true;
	let next = answer;
	const channel: InteractionChannel = {
		isActive: () => active,
		request: async (request) => {
			requests.push(request);
			return next;
		},
		post: async () => {},
		postFile: async () => true,
	};
	return {
		channel,
		requests,
		setActive: (value: boolean) => {
			active = value;
		},
		setAnswer: (value: InteractionAnswer) => {
			next = value;
		},
	};
}

describe("remote routing", () => {
	test("routes select to the channel while active", async () => {
		const { ui, calls } = fakeUI();
		const { channel, requests } = fakeChannel();
		installRemoteUI(ui, channel);
		expect(await ui.select("Pick", ["A", "B"])).toBe("remote");
		expect(requests).toEqual([{ kind: "select", title: "Pick", options: ["A", "B"] }]);
		expect(calls.select).toBe(0);
	});

	test("maps confirm answers to booleans", async () => {
		const { ui } = fakeUI();
		const { channel, setAnswer } = fakeChannel();
		installRemoteUI(ui, channel);
		setAnswer({ kind: "confirmed", confirmed: true });
		expect(await ui.confirm("Sure?", "body")).toBe(true);
		setAnswer({ kind: "confirmed", confirmed: false });
		expect(await ui.confirm("Sure?", "body")).toBe(false);
		setAnswer({ kind: "cancelled" });
		expect(await ui.confirm("Sure?", "body")).toBe(false);
	});

	test("maps input, editor, and a cancelled answer", async () => {
		const { ui } = fakeUI();
		const { channel, setAnswer } = fakeChannel();
		installRemoteUI(ui, channel);
		setAnswer({ kind: "value", value: "typed" });
		expect(await ui.input("Name", "hint")).toBe("typed");
		expect(await ui.editor("Edit", "prefill")).toBe("typed");
		setAnswer({ kind: "cancelled" });
		expect(await ui.select("Pick", ["A"])).toBeUndefined();
	});

	test("returns undefined for custom while active", async () => {
		const { ui, calls } = fakeUI();
		const { channel } = fakeChannel();
		installRemoteUI(ui, channel);
		const custom = ui.custom as (factory: unknown) => Promise<unknown>;
		expect(await custom(async () => ({}))).toBeUndefined();
		expect(calls.custom).toBe(0);
	});
});

describe("local fallback", () => {
	test("delegates every dialog to the originals while inactive", async () => {
		const { ui, calls } = fakeUI();
		const { channel } = fakeChannel();
		channel.isActive = () => false;
		installRemoteUI(ui, channel);
		expect(await ui.select("Pick", ["A"])).toBe("local-select");
		expect(await ui.confirm("Sure?", "body")).toBe(true);
		expect(await ui.input("Name")).toBe("local-input");
		expect(await ui.editor("Edit")).toBe("local-editor");
		const custom = ui.custom as (factory: unknown) => Promise<unknown>;
		expect(await custom(async () => ({}))).toBe("local-custom");
		expect(calls).toEqual({ select: 1, confirm: 1, input: 1, editor: 1, custom: 1 });
	});
});

describe("marker", () => {
	test("reports remote ownership through isRemoteTurn", () => {
		const { ui } = fakeUI();
		const { channel, setActive } = fakeChannel();
		installRemoteUI(ui, channel);
		expect(isRemoteTurn({ ui })).toBe(true);
		setActive(false);
		expect(isRemoteTurn({ ui })).toBe(false);
	});
});

describe("install and uninstall", () => {
	test("re-installing reuses the original methods", async () => {
		const { ui, calls, original } = fakeUI();
		const { channel } = fakeChannel();
		const uninstall = installRemoteUI(ui, channel);
		installRemoteUI(ui, channel);
		uninstall();
		expect(ui.select).toBe(original.select as never);
		expect(isRemoteTurn({ ui })).toBe(false);
		expect(await ui.select("Pick", ["A"])).toBe("local-select");
		expect(calls.select).toBe(1);
	});
});

/**
 * A peer session has no terminal, so its extensions get a UI bound to that
 * peer's channel instead: dialogs go to the phone and nothing draws locally.
 */
describe("peer UI context", () => {
	test("routes each dialog to the peer", async () => {
		const { channel, requests } = fakeChannel();
		const ui = createPeerUIContext(channel);
		expect(await ui.select("Pick", ["A", "B"])).toBe("remote");
		expect(await ui.input("Name", "hint")).toBe("remote");
		expect(await ui.editor("Edit", "draft")).toBe("remote");
		expect(requests.map((request) => request.kind)).toEqual(["select", "input", "editor"]);
	});

	test("maps a confirm answer to a boolean", async () => {
		const { channel } = fakeChannel();
		const ui = createPeerUIContext(channel);
		expect(await ui.confirm("Sure?", "body")).toBe(false);
	});

	test("posts a notification to the peer and reports it locally", () => {
		const { channel } = fakeChannel();
		const posted: string[] = [];
		channel.post = async (text) => {
			posted.push(text);
		};
		const notices: string[] = [];
		const ui = createPeerUIContext(channel, (message) => notices.push(message));
		ui.notify("heads up", "warning");
		return (async () => {
			// `post` is fire-and-forget from notify's point of view.
			await Promise.resolve();
			expect(posted).toEqual(["heads up"]);
			expect(notices).toEqual(["heads up"]);
		})();
	});

	test("has no terminal: custom is unavailable and drawing is a no-op", async () => {
		const { channel } = fakeChannel();
		const ui = createPeerUIContext(channel);
		const custom = ui.custom as (factory: unknown) => Promise<unknown>;
		expect(await custom(async () => ({}))).toBeUndefined();
		// These must exist and be harmless, because extensions call them blindly.
		ui.setStatus("k", "v");
		ui.setWidget("k", ["line"]);
		ui.setTitle("t");
		ui.setWorkingMessage("m");
		ui.pasteToEditor("x");
		expect(ui.getEditorText()).toBe("");
		expect(ui.getTheme("x")).toBeUndefined();
		// A theme object exists so a renderer that never runs cannot crash on load.
		expect(ui.theme).toBeDefined();
	});
});
