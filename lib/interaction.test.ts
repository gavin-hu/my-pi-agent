import { describe, expect, test } from "bun:test";
import {
	askHuman,
	INTERACTION_TURN_KEY,
	type InteractionChannel,
	type InteractionMode,
	isRemoteTurn,
	remoteChannel,
	supportsCustomUI,
	type UIContextCarrier,
} from "./interaction.ts";

/** A channel double recording `post`/`postFile`. */
function fakeChannel(active = true) {
	const posted: string[] = [];
	const files: Array<{ path: string; name: string }> = [];
	let fileResult = true;
	const channel: InteractionChannel = {
		isActive: () => active,
		request: async () => ({ kind: "cancelled" }),
		post: async (text) => {
			posted.push(text);
		},
		postFile: async (path, name) => {
			files.push({ path, name });
			return fileResult;
		},
	};
	return {
		channel,
		posted,
		files,
		setActive: (value: boolean) => {
			channel.isActive = () => value;
		},
		setFileResult: (value: boolean) => {
			fileResult = value;
		},
	};
}

/** A carrier whose `ctx.ui` installs `channel` when given. */
function carrier(mode: InteractionMode | undefined, channel?: InteractionChannel): UIContextCarrier {
	const ui: Record<string, unknown> = { select: async () => undefined };
	if (channel) ui[INTERACTION_TURN_KEY] = channel;
	return { ui, mode };
}

describe("remoteChannel", () => {
	test("is undefined without a channel", () => {
		expect(remoteChannel(carrier("tui"))).toBeUndefined();
	});

	test("returns the channel while it is active", () => {
		const { channel } = fakeChannel();
		expect(remoteChannel(carrier("tui", channel))).toBe(channel);
	});

	test("is undefined when the channel is inactive", () => {
		const { channel } = fakeChannel(false);
		expect(remoteChannel(carrier("tui", channel))).toBeUndefined();
	});

	test("ignores a non-channel marker", () => {
		expect(remoteChannel({ ui: { [INTERACTION_TURN_KEY]: true } })).toBeUndefined();
	});
});

describe("isRemoteTurn", () => {
	test("mirrors an active channel", () => {
		const { channel } = fakeChannel();
		expect(isRemoteTurn(carrier("tui", channel))).toBe(true);
		expect(isRemoteTurn(carrier("tui"))).toBe(false);
	});
});

describe("supportsCustomUI", () => {
	test("allows the rich component only for a local TUI turn", () => {
		expect(supportsCustomUI(carrier("tui"))).toBe(true);
		expect(supportsCustomUI(carrier("tui", fakeChannel().channel))).toBe(false);
		expect(supportsCustomUI(carrier("rpc"))).toBe(false);
		expect(supportsCustomUI(carrier("print"))).toBe(false);
	});
});

describe("askHuman", () => {
	const rich = async () => "rich";
	const text = async () => "text";

	test("runs custom for a local TUI turn and posts nothing", async () => {
		const { posted } = fakeChannel();
		const result = await askHuman(carrier("tui") as never, { custom: rich, dialogs: text, body: "unused" });
		// No channel, so nothing is posted.
		expect(result).toBe("rich");
		expect(posted).toEqual([]);
	});

	test("runs dialogs for a remote turn", async () => {
		const { channel } = fakeChannel();
		const result = await askHuman(carrier("tui", channel) as never, { custom: rich, dialogs: text });
		expect(result).toBe("text");
	});

	test("sends a file before the dialogs", async () => {
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

	test("falls back to the body when the file cannot be sent", async () => {
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

	test("posts a body when there is no file", async () => {
		const { channel, posted } = fakeChannel();
		await askHuman(carrier("tui", channel) as never, { custom: rich, dialogs: text, body: "plan text" });
		expect(posted).toEqual(["plan text"]);
	});
});
