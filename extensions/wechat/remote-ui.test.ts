import { describe, expect, test } from "bun:test";
import {
	askHuman,
	type InteractionAnswer,
	type InteractionChannel,
	type InteractionRequest,
	isRemoteTurn,
	remoteChannel,
} from "../../lib/interaction.ts";
import { createPeerUIContext } from "./remote-ui.ts";

function fakeChannel(answer: InteractionAnswer = { kind: "value", value: "remote" }) {
	const requests: InteractionRequest[] = [];
	const posted: string[] = [];
	const files: Array<{ path: string; name: string }> = [];
	/** Every delivery in call order, so the preface-before-dialogs contract is pinned. */
	const events: string[] = [];
	let next = answer;
	let fileResult = true;
	const channel: InteractionChannel = {
		isActive: () => true,
		request: async (request) => {
			requests.push(request);
			events.push(`request:${request.kind}`);
			return next;
		},
		post: async (text) => {
			posted.push(text);
			events.push(`post:${text}`);
		},
		postFile: async (path, name) => {
			files.push({ path, name });
			events.push(`file:${name}`);
			return fileResult;
		},
	};
	return {
		channel,
		requests,
		posted,
		files,
		events,
		setAnswer: (value: InteractionAnswer) => {
			next = value;
		},
		setFileResult: (value: boolean) => {
			fileResult = value;
		},
	};
}

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
		const { channel, setAnswer } = fakeChannel();
		const ui = createPeerUIContext(channel);
		setAnswer({ kind: "confirmed", confirmed: true });
		expect(await ui.confirm("Sure?", "body")).toBe(true);
		setAnswer({ kind: "confirmed", confirmed: false });
		expect(await ui.confirm("Sure?", "body")).toBe(false);
		setAnswer({ kind: "cancelled" });
		expect(await ui.confirm("Sure?", "body")).toBe(false);
	});

	test("posts a notification to the peer and reports it locally", () => {
		const { channel, posted } = fakeChannel();
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

/**
 * The peer context carries the channel marker `askHuman` reads. The terminal's
 * own UI is never marked, so a local turn keeps its full-screen dialogs even
 * while a peer turn runs.
 */
describe("peer turn marker", () => {
	test("reports the channel through remoteChannel and isRemoteTurn", () => {
		const { channel } = fakeChannel();
		const ui = createPeerUIContext(channel);
		expect(remoteChannel({ ui })).toBe(channel);
		expect(isRemoteTurn({ ui })).toBe(true);
	});

	test("askHuman sends the file preface to the peer before the dialogs", async () => {
		const { channel, events } = fakeChannel();
		const ui = createPeerUIContext(channel);
		const answer = await askHuman(
			{ ui, mode: "rpc" },
			{
				custom: async () => "custom",
				dialogs: async () => ui.select("Plan mode — what next?", ["Approve and execute"]),
				file: { path: "/tmp/plan.md", name: "plan.md" },
				body: "the plan",
			},
		);
		// One ordered log: the file goes out first, then the dialog.
		expect(events).toEqual(["file:plan.md", "request:select"]);
		expect(answer).toBe("remote");
	});

	test("falls back to the body when the file could not be sent", async () => {
		const { channel, events, setFileResult } = fakeChannel();
		setFileResult(false);
		const ui = createPeerUIContext(channel);
		await askHuman(
			{ ui, mode: "rpc" },
			{
				custom: async () => "custom",
				dialogs: async () => ui.select("Plan mode — what next?", ["Keep planning"]),
				file: { path: "/tmp/plan.md", name: "plan.md" },
				body: "the plan",
			},
		);
		expect(events).toEqual(["file:plan.md", "post:the plan", "request:select"]);
	});
});

/**
 * The `remotePrompts` setting turns forwarding off: a dialog is answered as
 * cancelled instead of being sent to the phone, and the marker is absent so
 * `askHuman` does not try to deliver a preface either.
 */
describe("peer UI context with prompts disabled", () => {
	test("answers every dialog as cancelled without asking the peer", async () => {
		const { channel, requests } = fakeChannel();
		const ui = createPeerUIContext(channel, undefined, { prompts: false });
		expect(await ui.select("Pick", ["A"])).toBeUndefined();
		expect(await ui.input("Name")).toBeUndefined();
		expect(await ui.editor("Edit")).toBeUndefined();
		expect(await ui.confirm("Sure?", "body")).toBe(false);
		expect(requests).toEqual([]);
	});

	test("does not mark the context as remote", () => {
		const { channel } = fakeChannel();
		const ui = createPeerUIContext(channel, undefined, { prompts: false });
		expect(remoteChannel({ ui })).toBeUndefined();
		expect(isRemoteTurn({ ui })).toBe(false);
	});

	test("still posts notifications to the peer", async () => {
		const { channel, posted } = fakeChannel();
		const ui = createPeerUIContext(channel, undefined, { prompts: false });
		ui.notify("heads up");
		await Promise.resolve();
		expect(posted).toEqual(["heads up"]);
	});
});
