/**
 * What does one `/getupdates` request actually return?
 *
 * Two questions, one request. First, every response carries
 * `longpolling_timeout_ms`, the hold the server used, and whether the *request*
 * may ask for a shorter one is undocumented — worth knowing, because a message is
 * only visible to Pi when a poll returns, so the hold is the floor on "how fast
 * can the bot react". Second, a message carries a `group_id` and a `session_id`
 * when the protocol supplies them, and the bridge routes on the sender alone; the
 * probe prints both, so a message sent in a group answers whether rooms are
 * delivered at all, a question a group-chat design would have to answer first.
 *
 * This is a manual experiment, so it refuses to run while a bridge is polling: two
 * clients on one account can steal each other's messages.
 *
 * Usage: `bun run probe:wechat [holdMs]` (default 3000)
 *
 * Run it with `pi` stopped. A message that arrives during the probe is printed,
 * not processed, and the stored cursor is left untouched.
 */

import { createFetchRunner, WechatClient } from "../extensions/wechat/transport/client.ts";
import { loadWechatConfig } from "../extensions/wechat/config.ts";
import { primaryAccount } from "../extensions/wechat/state/credentials.ts";
import { isLocked, lockPath } from "../extensions/wechat/state/lock.ts";
import { readState, statePath } from "../extensions/wechat/state/state.ts";

const requested = Number.parseInt(process.argv[2] ?? "3000", 10);
if (!Number.isFinite(requested) || requested < 1000 || requested > 120_000) {
	console.error("Usage: bun run probe:wechat [holdMs]  (1000–120000)");
	process.exit(2);
}

/** Whether a live process still holds the poller lock. */
function bridgeIsPolling(): boolean {
	return isLocked(lockPath(), {
		now: () => Date.now(),
		pid: process.pid,
		isAlive: (pid) => {
			try {
				process.kill(pid, 0);
				return true;
			} catch {
				return false;
			}
		},
	});
}

if (bridgeIsPolling()) {
	console.error("A bridge is polling this account. Quit `pi` first: two pollers steal each other's messages.");
	process.exit(1);
}

const account = primaryAccount();
if (!account) {
	console.error("No WeChat account is stored. Run /wechat login first.");
	process.exit(1);
}

const cursor = readState(statePath()).cursor;
const config = loadWechatConfig(process.cwd());
const client = new WechatClient({
	http: createFetchRunner(),
	channelVersion: config.channelVersion,
	botAgent: config.botAgent,
	baseUrl: account.baseUrl,
	cdnBaseUrl: config.cdnBaseUrl,
});

const started = performance.now();
try {
	const response = await client.getUpdates(account, cursor, undefined, { holdMs: requested });
	const elapsed = Math.round(performance.now() - started);
	console.log("requested hold:", requested, "ms");
	console.log("measured hold: ", elapsed, "ms");
	console.log("server echoed: ", response.timeoutMs ?? "(none)", "ms");
	console.log("messages:     ", response.msgs.length);
	for (const message of response.msgs) {
		console.log("  from", message.from_user_id, JSON.stringify(message.item_list ?? []).slice(0, 120));
		// A room is a routing question the bridge cannot answer yet; name what arrived.
		if (message.group_id !== undefined) console.log("       group_id:  ", message.group_id);
		if (message.session_id !== undefined) console.log("       session_id:", message.session_id);
	}
	if (response.ret !== undefined && response.ret !== 0) console.log("ret:          ", response.ret);
	if (response.errcode !== undefined && response.errcode !== 0) console.log("errcode:      ", response.errcode);

	const honoured = elapsed > 1000 && elapsed < requested * 2.5;
	console.log(
		honoured
			? "\nThe hold follows the request: `pollHoldMs` can shorten the first reaction."
			: "\nThe hold ignored the request: the server's own timeout is the floor for the first reaction.",
	);
} catch (error) {
	console.error("probe failed:", error instanceof Error ? error.message : String(error));
	process.exit(1);
}
