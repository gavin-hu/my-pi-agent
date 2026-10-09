/**
 * Wire and domain types for the WeChat bridge.
 *
 * The wire types mirror the subset of the Weixin iLink bot protocol the bridge
 * uses (see `Tencent/openclaw-weixin` `docs/protocol.md`); the domain types are
 * the persisted credentials, cursor, and peer state.
 */

/** One content item inside a message (`type` 1 = text). */
export interface MessageItem {
	type?: number;
	text_item?: { text?: string };
}

/** An inbound Weixin message (the fields the bridge reads). */
export interface WeixinMessage {
	seq?: number;
	message_id?: number;
	from_user_id?: string;
	to_user_id?: string;
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

/** Persisted `<agentDir>/wechat/credentials.json`. */
export interface CredentialsFile {
	accounts: Record<string, BotCredentials>;
}

/** Per-peer state: the reply token and the last inbound time. */
export interface PeerState {
	lastContextToken?: string;
	lastSeen: number;
}

/** Persisted `<agentDir>/wechat/state.json`. */
export interface WechatState {
	cursor: string;
	ownerId?: string;
	peers: Record<string, PeerState>;
}

/** A queued inbound message awaiting a turn. */
export interface InboundItem {
	peer: string;
	contextToken?: string;
	text: string;
}

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
}
