/**
 * Wire and domain types for the WeChat bridge.
 *
 * The wire types mirror the subset of the Weixin iLink bot protocol the bridge
 * uses (see `Tencent/openclaw-weixin` `docs/protocol.md`); the domain types are
 * the persisted credentials, cursor, and peer state.
 */

import type { PeerLanguage } from "./text/format.ts";

/** One content item inside a message (`type` 1 = text). */
export interface MessageItem {
	type?: number;
	msg_id?: string;
	text_item?: { text?: string };
	image_item?: ImageItem;
	voice_item?: VoiceItem;
	file_item?: FileItem;
	video_item?: VideoItem;
}

/** CDN media reference; `aes_key` is base64-encoded bytes in JSON. */
export interface CDNMedia {
	encrypt_query_param?: string;
	aes_key?: string;
	encrypt_type?: number;
	/** Full download URL, preferred over a constructed one. */
	full_url?: string;
}

/** `image_item`; `aeskey` is a raw 16-byte AES key as hex, preferred inbound. */
export interface ImageItem {
	media?: CDNMedia;
	thumb_media?: CDNMedia;
	aeskey?: string;
	url?: string;
	mid_size?: number;
	thumb_size?: number;
}

/** `voice_item`; a transcript may be present in `text`. */
export interface VoiceItem {
	media?: CDNMedia;
	encode_type?: number;
	sample_rate?: number;
	playtime?: number;
	text?: string;
}

/** `file_item`; `len` is the plaintext byte count as a decimal string. */
export interface FileItem {
	media?: CDNMedia;
	file_name?: string;
	md5?: string;
	len?: string;
}

/** `video_item` (typed but not downloaded by this bridge). */
export interface VideoItem {
	media?: CDNMedia;
	video_size?: number;
	play_length?: number;
}

/** An inbound Weixin message (the fields the bridge reads). */
export interface WeixinMessage {
	seq?: number;
	message_id?: number;
	from_user_id?: string;
	to_user_id?: string;
	/**
	 * A group message's room, declared by the protocol as "when applicable".
	 *
	 * Nothing routes on it: the bridge keys a conversation by sender. The poll
	 * probe prints it so a probe can tell whether rooms are delivered at all.
	 */
	group_id?: string;
	/** The conversation the message belongs to, when the protocol supplies one. */
	session_id?: string;
	message_type?: number;
	message_state?: number;
	item_list?: MessageItem[];
	context_token?: string;
}

/** A stored bot account, keyed by `ilinkBotId` in the credentials file. */
export interface BotCredentials {
	botToken: string;
	ilinkUserId: string;
	ilinkBotId: string;
	baseUrl: string;
	botAgent: string;
	createdAt: number;
}

/** Persisted `<agent-dir>/wechat/credentials.json`. */
export interface CredentialsFile {
	accounts: Record<string, BotCredentials>;
	/**
	 * Key of the account the most recent `/wechat login` confirmed, so a second
	 * login switches to the account that was just scanned instead of keeping the
	 * first one stored. Absent in a file written before this field existed, where
	 * the first account is still used.
	 */
	activeAccount?: string;
}

/** Per-peer state: the reply token and the last inbound time. */
export interface PeerState {
	lastContextToken?: string;
	lastSeen: number;
}

/** Persisted `<agent-dir>/wechat/state.json`. */
export interface WechatState {
	cursor: string;
	ownerId?: string;
	peers: Record<string, PeerState>;
	/** Recently handled inbound ids, so a replay is answered once. */
	seen?: SeenMessage[];
}

/** One handled inbound message, keyed by the normalized peer and its id. */
export interface SeenMessage {
	peer: string;
	id: number;
	/** Epoch milliseconds; entries older than the window are pruned. */
	at: number;
}

/** A queued inbound message awaiting a turn. */
export interface InboundItem {
	peer: string;
	contextToken?: string;
	text: string;
	media: MediaRef[];
	/** The peer's language, decided from this message. */
	language: PeerLanguage;
}

/** An inbound image to download, decrypt, and attach to the turn. */
export interface ImageRef {
	kind: "image";
	media: CDNMedia;
	/** Hex key from `image_item.aeskey`, when present. */
	aeskey?: string;
}

/** An inbound file to download, decrypt, and save for the agent. */
export interface FileRef {
	kind: "file";
	media: CDNMedia;
	fileName: string;
}

/** A downloadable inbound attachment (video is not handled). */
export type MediaRef = ImageRef | FileRef;

/** `get_bot_qrcode` response. */
export interface QrResponse {
	qrcode: string;
	imgContent: string;
}

/** `get_qrcode_status` response. */
export interface QrStatus {
	status: string;
	botToken?: string;
	ilinkBotId?: string;
	baseUrl?: string;
	ilinkUserId?: string;
}

/** `getupdates` response. */
export interface UpdatesResponse {
	ret?: number;
	errcode?: number;
	msgs: WeixinMessage[];
	buf: string;
	timeoutMs?: number;
}

/** `sendmessage` response. */
export interface SendResponse {
	ret?: number;
	errcode?: number;
	/** The server's own description of a rejected send, when it sends one. */
	errmsg?: string;
}

/** `getconfig` response: the per-user typing ticket. */
export interface GetConfigResponse {
	ret?: number;
	errcode?: number;
	typingTicket?: string;
}

/** `sendtyping` response (the body is not relied on). */
export interface SendTypingResponse {
	ret?: number;
	errcode?: number;
}
