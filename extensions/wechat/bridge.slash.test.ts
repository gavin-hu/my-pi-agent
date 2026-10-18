import { describe, expect, test } from "bun:test";
import {
	account,
	encrypt,
	inbound,
	inboundImage,
	makeClient,
	makeDeps,
	owner,
	updates,
} from "../../test/helpers/fixtures/wechat-bridge.ts";
import { waitFor } from "../../test/helpers/process.ts";
import { createBridge } from "./bridge.ts";
import { DEFAULT_CONFIG } from "./config.ts";
import type { SlashCommand } from "./slash.ts";

describe("bridge slash commands", () => {
	test("answers /history from the peer's own session", async () => {
		const { client, sent } = makeClient([updates([inbound("/history")])]);
		const { deps } = makeDeps(client, {
			readHistory: async (peer, count) => `${peer} ${count}\nYou: hi`,
		});
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => sent.length === 1);
		expect(sent[0]?.text).toContain("You: hi");
		await bridge.close();
	});

	test("expands a snippet command into the injected turn", async () => {
		const commands: SlashCommand[] = [{ name: "sum", summary: "s", kind: "snippet", snippet: "Summarize." }];
		const { client } = makeClient([updates([inbound("/sum extra")])]);
		const { deps, injected } = makeDeps(client, { slashCommands: commands });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);
		expect(injected[0]).toBe("Summarize.\n\nextra");
		await bridge.close();
	});

	test("runs an action and replies without injecting a turn", async () => {
		const calls: string[] = [];
		const commands: SlashCommand[] = [
			{
				name: "hi",
				summary: "s",
				kind: "action",
				run: async (ctx) => {
					calls.push(ctx.args);
					await ctx.reply("hello there");
				},
			},
		];
		const { client, sent } = makeClient([updates([inbound("/hi a b")])]);
		const { deps, injected } = makeDeps(client, { slashCommands: commands });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => sent.length === 1);
		expect(calls).toEqual(["a b"]);
		expect(injected).toEqual([]);
		expect(sent[0]).toMatchObject({ to: owner, text: "hello there" });
		await bridge.close();
	});

	test("ignores an owner-only command from a non-owner peer", async () => {
		const calls: string[] = [];
		const peer = "friend@im.wechat";
		const commands: SlashCommand[] = [
			{ name: "new", summary: "s", kind: "action", ownerOnly: true, run: () => void calls.push("ran") },
		];
		const { client, sent } = makeClient([updates([inbound("/new", peer)])]);
		const { deps, injected } = makeDeps(client, {
			slashCommands: commands,
			config: { ...DEFAULT_CONFIG, allowedPeers: [peer] },
		});
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => bridge.status().refused === 1);
		expect(calls).toEqual([]);
		expect(injected).toEqual([]);
		expect(sent).toEqual([]);
		await bridge.close();
	});

	test("accepts an owner-only command from the owner in either id form", async () => {
		// Admission normalizes the `@im.wechat` suffix, so the owner check must too:
		// a message that carries the suffix reaches an owner stored without it.
		const calls: string[] = [];
		const commands: SlashCommand[] = [
			{ name: "new", summary: "s", kind: "action", ownerOnly: true, run: () => void calls.push("ran") },
		];
		const { client } = makeClient([updates([inbound("/new", "boss@im.wechat")])]);
		const { deps } = makeDeps(client, {
			slashCommands: commands,
			loadAccount: () => ({ ...account, ilinkUserId: "boss" }),
		});
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => calls.length === 1);
		expect(calls).toEqual(["ran"]);
		expect(bridge.status().refused).toBe(0);
		await bridge.close();
	});

	test("passes an unknown slash command through as a normal turn", async () => {
		const { client } = makeClient([updates([inbound("/nope")])]);
		const { deps, injected } = makeDeps(client);
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);
		expect(injected[0]).toBe("/nope");
		await bridge.close();
	});

	test("does not intercept a command carrying media", async () => {
		const mixed = inbound("look");
		mixed.item_list = [{ type: 1, text_item: { text: "/new" } }, ...(inboundImage().item_list ?? [])];
		const plain = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
		const { client } = makeClient([updates([mixed])], { media: { "https://cdn/i": encrypt(plain) } });
		const calls: string[] = [];
		const { deps, peers } = makeDeps(client, {
			slashCommands: [
				{ name: "new", summary: "s", kind: "action", ownerOnly: true, run: () => void calls.push("ran") },
			],
		});
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => (peers[0]?.prompts.length ?? 0) === 1);
		expect(peers[0]?.prompts[0]).toMatchObject({ text: "/new" });
		expect(calls).toEqual([]);
		await bridge.close();
	});
});
