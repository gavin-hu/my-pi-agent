/**
 * The peer session's UI context: what it answers, what it forwards, and what it
 * refuses to own.
 *
 * `ExtensionUIContext` grows as Pi grows and this context is written by hand, so the
 * first case here is the guard: every member of the host's interface must exist at
 * runtime, from a list whose completeness is checked at compile time. The context
 * used to be a `Record<string, unknown>` cast into place, which made the same mistake
 * invisible until something called the missing member.
 *
 * The rest is the contract a peer session depends on: dialogs go to the phone, no
 * terminal is drawn, only a forwarding context carries the `askHuman` marker, and
 * `remotePrompts: false` answers as dismissed without asking anyone.
 */

import { describe, expect, test } from "bun:test";
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import {
	askHuman,
	type InteractionAnswer,
	type InteractionChannel,
	type InteractionRequest,
	INTERACTION_TURN_KEY,
	isRemoteTurn,
	remoteChannel,
} from "../../../lib/interaction.ts";
import { createPeerUIContext } from "./remote-ui.ts";

/** A peer's channel over recording senders: a dialog answers `"remote"` and posts are kept. */
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

/** Every member of the host's interface; the type check below proves the list is whole. */
const MEMBERS = [
	"select",
	"confirm",
	"input",
	"editor",
	"notify",
	"onTerminalInput",
	"setStatus",
	"setWorkingMessage",
	"setWorkingVisible",
	"setWorkingIndicator",
	"setHiddenThinkingLabel",
	"setWidget",
	"setFooter",
	"setHeader",
	"setTitle",
	"custom",
	"pasteToEditor",
	"setEditorText",
	"getEditorText",
	"addAutocompleteProvider",
	"setEditorComponent",
	"getEditorComponent",
	"theme",
	"getAllThemes",
	"getTheme",
	"setTheme",
	"getToolsExpanded",
	"setToolsExpanded",
] as const satisfies readonly (keyof ExtensionUIContext)[];

/** A member the list forgot makes this `never`, and the assignment below stops compiling. */
type Unlisted = Exclude<keyof ExtensionUIContext, (typeof MEMBERS)[number]>;
const COMPLETE: [Unlisted] extends [never] ? true : never = true;

describe("the peer UI context", () => {
	test("answers every member of the host's interface", () => {
		expect(COMPLETE).toBe(true);
		const ui = createPeerUIContext(fakeChannel().channel);
		for (const member of MEMBERS) expect(member in ui, member).toBe(true);
	});

	test("styles text by returning it, with no escape sequence", () => {
		const ui = createPeerUIContext(fakeChannel().channel);
		const words = "bold words";
		const styled = [
			ui.theme.fg("accent", words),
			ui.theme.bg("selectedBg", words),
			ui.theme.bold(words),
			ui.theme.italic(words),
			ui.theme.underline(words),
			ui.theme.inverse(words),
			ui.theme.strikethrough(words),
			ui.theme.style(words, { bold: true }),
		];
		for (const text of styled) {
			expect(text).toBe(words);
			expect(text).not.toContain("\u001b");
		}
		expect(ui.theme.name).toBe("peer");
	});

	test("has no terminal: custom is unavailable and drawing is a no-op", async () => {
		const ui = createPeerUIContext(fakeChannel().channel);
		const screen = () => ({ render: () => [], invalidate: () => {} });
		expect(await ui.custom<undefined>(screen)).toBeUndefined();
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

describe("dialog routing", () => {
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

	test("posts a notification to the peer and reports it locally", async () => {
		const { channel, posted } = fakeChannel();
		const notices: string[] = [];
		const ui = createPeerUIContext(channel, (message) => notices.push(message));
		ui.notify("heads up", "warning");
		await Promise.resolve();
		expect(posted).toEqual(["heads up"]);
		expect(notices).toEqual(["heads up"]);
	});
});

/**
 * The peer context carries the channel marker `askHuman` reads. The terminal's own
 * UI is never marked, so a local turn keeps its full-screen dialogs even while a
 * peer turn runs.
 */
describe("peer turn marker", () => {
	test("reports the channel through remoteChannel and isRemoteTurn", () => {
		const { channel } = fakeChannel();
		const ui = createPeerUIContext(channel);
		expect(remoteChannel({ ui })).toBe(channel);
		expect(isRemoteTurn({ ui })).toBe(true);
		expect((ui as unknown as Record<string, unknown>)[INTERACTION_TURN_KEY]).toBe(channel);
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
