/**
 * The turn-affinity prompt contract: which channel owns a turn, what a remote
 * turn's preface carries, and how that turn takes the terminal's dialogs over for
 * its length.
 */

import { describe, expect, test } from "bun:test";
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import {
	askHuman,
	INTERACTION_TURN_KEY,
	type InteractionAnswer,
	type InteractionChannel,
	type InteractionMode,
	type InteractionRequest,
	isRemoteTurn,
	markRemoteTurn,
	remoteChannel,
	supportsCustomUI,
	type UIContextCarrier,
} from "./interaction.ts";

describe("the turn-affinity prompt channel", () => {
	/** A channel double recording `request`/`post`/`postFile` deliveries in call order. */
	function fakeChannel(active = true) {
		const posted: string[] = [];
		const files: Array<{ path: string; name: string }> = [];
		const events: string[] = [];
		const requests: Array<{ request: InteractionRequest; signal?: AbortSignal }> = [];
		let fileResult = true;
		let answer: InteractionAnswer = { kind: "cancelled" };
		const channel: InteractionChannel = {
			isActive: () => active,
			request: async (request, signal) => {
				requests.push(signal === undefined ? { request } : { request, signal });
				return answer;
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
			posted,
			files,
			events,
			requests,
			setActive: (value: boolean) => {
				channel.isActive = () => value;
			},
			setFileResult: (value: boolean) => {
				fileResult = value;
			},
			setAnswer: (value: InteractionAnswer) => {
				answer = value;
			},
		};
	}

	/** A carrier whose `ctx.ui` installs `channel` when given. */
	function carrier(mode: InteractionMode | undefined, channel?: InteractionChannel): UIContextCarrier {
		const ui: Record<string, unknown> = { select: async () => undefined };
		if (channel) ui[INTERACTION_TURN_KEY] = channel;
		return { ui, mode };
	}

	/** A UI context double that answers every dialog locally, and says which it answered. */
	function terminal() {
		const calls: string[] = [];
		const ui: Record<string, unknown> = {
			select: async (title: string) => {
				calls.push(`select:${title}`);
				return "terminal";
			},
			confirm: async (title: string) => {
				calls.push(`confirm:${title}`);
				return true;
			},
			input: async (title: string) => {
				calls.push(`input:${title}`);
				return "terminal";
			},
			editor: async (title: string) => {
				calls.push(`editor:${title}`);
				return "terminal";
			},
		};
		return { ui, calls, ask: ui as unknown as ExtensionUIContext };
	}

	const rich = async (): Promise<string> => "rich";
	const text = async (): Promise<string> => "text";

	test("remoteChannel is undefined without a channel, or while it is inactive", () => {
		expect(remoteChannel(carrier("tui"))).toBeUndefined();
		expect(remoteChannel(carrier("tui", fakeChannel(false).channel))).toBeUndefined();
		expect(remoteChannel({ ui: { [INTERACTION_TURN_KEY]: true } })).toBeUndefined();
	});

	test("remoteChannel returns the channel that owns the turn", () => {
		const { channel } = fakeChannel();
		expect(remoteChannel(carrier("tui", channel))).toBe(channel);
	});

	test("isRemoteTurn mirrors an active channel", () => {
		expect(isRemoteTurn(carrier("tui", fakeChannel().channel))).toBe(true);
		expect(isRemoteTurn(carrier("tui"))).toBe(false);
	});

	test("supportsCustomUI allows the rich component only for a local TUI turn", () => {
		expect(supportsCustomUI(carrier("tui"))).toBe(true);
		expect(supportsCustomUI(carrier("tui", fakeChannel().channel))).toBe(false);
		expect(supportsCustomUI(carrier("rpc"))).toBe(false);
		expect(supportsCustomUI(carrier("print"))).toBe(false);
	});

	test("markRemoteTurn answers the four dialogs through the channel, not the terminal", async () => {
		const { channel, requests, setAnswer } = fakeChannel();
		const { ui, calls, ask } = terminal();
		const restore = markRemoteTurn(ui, channel);
		const signal = new AbortController().signal;

		setAnswer({ kind: "value", value: "second" });
		expect(await ask.select("Pick", ["first", "second"], { signal })).toBe("second");
		setAnswer({ kind: "confirmed", confirmed: true });
		expect(await ask.confirm("Go?", "Plan first.")).toBe(true);
		setAnswer({ kind: "value", value: "typed" });
		expect(await ask.input("Name", "here")).toBe("typed");
		setAnswer({ kind: "value", value: "written" });
		expect(await ask.editor("Notes", "prefill")).toBe("written");

		expect(calls, "the terminal must not be asked").toEqual([]);
		expect(requests.map((entry) => entry.request)).toEqual([
			{ kind: "select", title: "Pick", options: ["first", "second"] },
			{ kind: "confirm", title: "Go?", message: "Plan first." },
			{ kind: "input", title: "Name", placeholder: "here" },
			{ kind: "editor", title: "Notes", prefill: "prefill" },
		]);
		// The dialog's own signal reaches the transport, so an aborted turn drops its prompt.
		expect(requests[0]?.signal).toBe(signal);
		restore();
	});

	test("a cancelled dialog reads as a refusal for confirm and nothing for the rest", async () => {
		const { channel, setAnswer } = fakeChannel();
		const { ui, ask } = terminal();
		const restore = markRemoteTurn(ui, channel);
		setAnswer({ kind: "cancelled" });
		expect(await ask.confirm("Go?", "body")).toBe(false);
		expect(await ask.select("Pick", ["a"])).toBeUndefined();
		expect(await ask.input("Name")).toBeUndefined();
		expect(await ask.editor("Notes")).toBeUndefined();
		// A value that does not answer this dialog's kind is not a confirmation either.
		setAnswer({ kind: "value", value: "yes" });
		expect(await ask.confirm("Go?", "body")).toBe(false);
		restore();
	});

	test("the restore puts the terminal back and drops the marker", async () => {
		const { channel } = fakeChannel();
		const { ui, calls, ask } = terminal();
		const restore = markRemoteTurn(ui, channel);
		expect(isRemoteTurn({ ui })).toBe(true);
		restore();
		expect(isRemoteTurn({ ui })).toBe(false);
		expect(ui[INTERACTION_TURN_KEY]).toBeUndefined();
		expect(await ask.confirm("Go?", "body")).toBe(true);
		expect(calls).toEqual(["confirm:Go?"]);
	});

	test("the restore reaches a member only the prototype carries", async () => {
		class Context {
			async input(): Promise<string> {
				return "prototype";
			}
		}
		const ui = new Context() as unknown as Record<string, unknown>;
		const restore = markRemoteTurn(ui, fakeChannel().channel);
		restore();
		expect(Object.hasOwn(ui, "input")).toBe(false);
		expect(await (ui as unknown as ExtensionUIContext).input("Name")).toBe("prototype");
	});

	test("a second restore changes nothing", async () => {
		const { ui } = terminal();
		const restore = markRemoteTurn(ui, fakeChannel().channel);
		restore();
		const replacement = async () => "replacement";
		ui.confirm = replacement;
		restore();
		expect(ui.confirm).toBe(replacement);
	});

	test("an older restore leaves a newer takeover alone", async () => {
		const second = fakeChannel();
		const { ui, calls, ask } = terminal();
		const older = markRemoteTurn(ui, fakeChannel().channel);
		const newer = markRemoteTurn(ui, second.channel);
		older();
		second.setAnswer({ kind: "confirmed", confirmed: true });
		expect(await ask.confirm("Go?", "body")).toBe(true);
		expect(calls).toEqual([]);
		newer();
	});

	test("a sealed UI context keeps its dialogs local and still returns a restore", async () => {
		const { ui, calls, ask } = terminal();
		Object.freeze(ui);
		const restore = markRemoteTurn(ui, fakeChannel().channel);
		expect(isRemoteTurn({ ui })).toBe(false);
		expect(await ask.confirm("Go?", "body")).toBe(true);
		expect(calls).toEqual(["confirm:Go?"]);
		expect(() => restore()).not.toThrow();
	});

	test("askHuman runs custom for a local TUI turn and posts nothing", async () => {
		const { posted } = fakeChannel();
		const result = await askHuman(carrier("tui") as never, { custom: rich, dialogs: text, body: "unused" });
		expect(result).toBe("rich");
		expect(posted).toEqual([]);
	});

	test("askHuman runs the dialogs for a remote turn", async () => {
		const { channel } = fakeChannel();
		const result = await askHuman(carrier("tui", channel) as never, { custom: rich, dialogs: text });
		expect(result).toBe("text");
	});

	test("askHuman sends a file before the dialogs", async () => {
		const { channel, files, posted } = fakeChannel();
		const result = await askHuman(carrier("tui", channel) as never, {
			custom: rich,
			dialogs: text,
			file: { path: "/tmp/plan.md", name: "plan.md" },
			body: "fallback",
		});
		expect(result).toBe("text");
		expect(files).toEqual([{ path: "/tmp/plan.md", name: "plan.md" }]);
		expect(posted).toEqual([]);
	});

	test("askHuman falls back to the body when the file cannot be sent", async () => {
		const { channel, posted, setFileResult } = fakeChannel();
		setFileResult(false);
		await askHuman(carrier("tui", channel) as never, {
			custom: rich,
			dialogs: text,
			file: { path: "/tmp/plan.md", name: "plan.md" },
			body: "fallback",
		});
		expect(posted).toEqual(["fallback"]);
	});

	test("askHuman posts the digest after the file, before the dialogs", async () => {
		const { channel, files, events } = fakeChannel();
		const result = await askHuman(carrier("tui", channel) as never, {
			custom: rich,
			dialogs: text,
			file: { path: "/tmp/plan.md", name: "plan.md" },
			body: "fallback",
			note: "Plan: Demo (2 steps)",
		});
		expect(result).toBe("text");
		expect(files).toHaveLength(1);
		// The file goes out first; the digest follows, so the choices make sense even
		// when the attachment is never opened.
		expect(events).toEqual(["file:plan.md", "post:Plan: Demo (2 steps)"]);
	});

	test("askHuman posts the fallback text and then the digest", async () => {
		const { channel, posted, setFileResult } = fakeChannel();
		setFileResult(false);
		await askHuman(carrier("tui", channel) as never, {
			custom: rich,
			dialogs: text,
			file: { path: "/tmp/plan.md", name: "plan.md" },
			body: "full plan",
			note: "digest",
		});
		expect(posted).toEqual(["full plan", "digest"]);
	});

	test("askHuman posts a body when there is no file", async () => {
		const { channel, posted } = fakeChannel();
		await askHuman(carrier("tui", channel) as never, { custom: rich, dialogs: text, body: "plan text" });
		expect(posted).toEqual(["plan text"]);
	});

	test("askHuman posts no digest for a local turn", async () => {
		const { posted } = fakeChannel();
		const result = await askHuman(carrier("tui") as never, { custom: rich, dialogs: text, note: "digest" });
		expect(result).toBe("rich");
		expect(posted).toEqual([]);
	});

	test("askHuman still runs the dialogs when the preface throws", async () => {
		const { channel } = fakeChannel();
		channel.postFile = async () => {
			throw new Error("transport gone");
		};
		const result = await askHuman(carrier("tui", channel) as never, {
			custom: rich,
			dialogs: text,
			file: { path: "/tmp/plan.md", name: "plan.md" },
		});
		expect(result).toBe("text");
	});
});
