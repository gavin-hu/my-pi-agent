/**
 * One interaction channel per peer.
 *
 * Two peers' turns can run at once ({@link PEER_CONCURRENCY}), and a forwarded
 * dialog is only unambiguous if the channel that asks knows which peer it is
 * asking — so each peer owns a channel, and a reply can only answer its own
 * peer's prompt. This registry builds them lazily, routes an inbound message to
 * that peer's channel, and aggregates what waits so the control screen and
 * `/wechat status` can name each waiting peer.
 *
 * It also owns the dialogs' outbound path — the flush of buffered text, the
 * prompt gate, and the deliverer call — because that path is per peer and belongs
 * with the channel that uses it rather than with the bridge that wires it.
 *
 * Value-only: the map lives in the closure.
 */

import type { PendingPromptInfo, WechatInteractionChannel } from "./interaction.ts";
import { createWechatInteractionChannel } from "./interaction.ts";
import type { PeerLanguage } from "../text/format.ts";
import type { ArmTimer } from "../timer.ts";

/** What the registry needs from the bridge; the turn's item carries the token. */
export interface PeerChannelDeps {
	/** Put buffered assistant text on the wire before a prompt or a file. */
	flush: (peer: string) => Promise<void>;
	/** Send one dialog message to a peer as that peer's next bubble. */
	send: (peer: string, text: string, signal?: AbortSignal) => Promise<boolean>;
	/** Send one local file to a peer. */
	sendFile: (peer: string, path: string, name: string, signal?: AbortSignal) => Promise<boolean>;
	/** Whether the peer owns a running turn, so a prompt has somewhere to land. */
	active: (peer: string) => boolean;
	/** The language the peer writes in, for the prompt and the timeout notices. */
	language: (peer: string) => PeerLanguage;
	/** Arm a cancellable one-shot timer. Defaults to a real, unref'd one. */
	armTimer?: ArmTimer;
	/** Clock for a prompt's start time; defaults to `Date.now`. */
	now?: () => number;
}

export interface PeerChannels {
	/** This peer's channel, created on first use. */
	for(peer: string): WechatInteractionChannel;
	/** Route an inbound message to the peer's pending prompt; true when it answered one. */
	handleInbound(peer: string, text: string): boolean;
	/** The prompt one peer is waiting on, if any. */
	pendingFor(peer: string): PendingPromptInfo | undefined;
	/** Every waiting prompt, oldest channel first. */
	prompts(): PendingPromptInfo[];
	/** Whether that peer — or with no argument, any peer — has a prompt waiting. */
	hasPending(peer?: string): boolean;
	/** Withdraw every waiting prompt, telling each peer. */
	cancelAll(): Promise<void>;
	/** Drop every channel and its waiting prompt, silently. */
	reset(): void;
}

export function createPeerChannels(deps: PeerChannelDeps): PeerChannels {
	const channels = new Map<string, WechatInteractionChannel>();

	function build(peer: string): WechatInteractionChannel {
		let channel: WechatInteractionChannel | undefined;
		/**
		 * Dialog text is only sent while its prompt is registered; the timeout,
		 * waiting, and withdrawal lines force their way through. Reading the channel
		 * this closure builds keeps one owner for "is a prompt waiting".
		 */
		const allowed = (options?: { force?: boolean }): boolean =>
			options?.force === true || (channel?.hasPending() ?? false);

		channel = createWechatInteractionChannel({
			peer,
			send: async (text, signal, options) => {
				if (!allowed(options)) return false;
				await deps.flush(peer);
				return deps.send(peer, text, signal);
			},
			sendFile: async (path, name, signal, options) => {
				if (!allowed(options)) return false;
				await deps.flush(peer);
				return deps.sendFile(peer, path, name, signal);
			},
			active: () => deps.active(peer),
			language: () => deps.language(peer),
			armTimer: deps.armTimer,
			now: deps.now,
		});
		return channel;
	}

	return {
		for(peer: string): WechatInteractionChannel {
			const existing = channels.get(peer);
			if (existing) return existing;
			const created = build(peer);
			channels.set(peer, created);
			return created;
		},

		handleInbound(peer: string, text: string): boolean {
			// Only a channel that exists can be waiting, so an inbound message never
			// creates one for a peer that has not been asked anything.
			return channels.get(peer)?.handleInbound(text) ?? false;
		},

		pendingFor(peer: string): PendingPromptInfo | undefined {
			return channels.get(peer)?.pendingInfo();
		},

		prompts(): PendingPromptInfo[] {
			const waiting: PendingPromptInfo[] = [];
			for (const channel of channels.values()) {
				const info = channel.pendingInfo();
				if (info) waiting.push(info);
			}
			return waiting;
		},

		hasPending(peer?: string): boolean {
			if (peer !== undefined) return channels.get(peer)?.hasPending() ?? false;
			for (const channel of channels.values()) if (channel.hasPending()) return true;
			return false;
		},

		async cancelAll(): Promise<void> {
			for (const channel of channels.values()) {
				if (channel.hasPending()) await channel.cancel();
			}
		},

		reset(): void {
			for (const channel of channels.values()) channel.reset();
			channels.clear();
		},
	};
}
