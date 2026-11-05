/**
 * The terminal boundary: every value the wire chose is sanitized before a notice or
 * a screen shows it in the operator's terminal.
 *
 * The cases sit together because the rule does, not the code: a sender's id arrives
 * in a polled message, an account's id in a login response, and a status or URL in a
 * QR poll, and each one reaches a different surface. `lib/tui/README.md` is the
 * contract they hold — untrusted text goes through `sanitizeLine` before a widget.
 *
 * The bridge, the login context, and the host turn are doubles, so no case needs a
 * network, a real session, or a timer.
 */

import { describe, expect, test } from "bun:test";
import { fakeCtx } from "../../test/helpers/context.ts";
import { account, inbound, makeClient, makeDeps, updates } from "../../test/helpers/fixtures/wechat-bridge.ts";
import { settle, waitFor } from "../../test/helpers/process.ts";
import { createBridge } from "./bridge.ts";
import { finishLogin, type CommandDeps } from "./commands/commands.ts";
import { DEFAULT_CONFIG } from "./config.ts";
import { createTurnRunner } from "./conversation/turn.ts";
import type { ChatTurn } from "./host/chat.ts";
import { loginBody } from "./view/login-screen.ts";

/** A sender id whose label carries an ANSI escape, as the wire may hand one over. */
const NOISY_SENDER = "stranger\u001b[31m@im.wechat";

describe("the terminal boundary", () => {
	test("a refused sender's control characters never reach the notice", async () => {
		const notifications: string[] = [];
		const { client } = makeClient([updates([inbound("hi", NOISY_SENDER)])]);
		const { deps } = makeDeps(client, { notify: (message) => notifications.push(message) });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => bridge.status().refused === 1);
		const named = notifications.filter((message) => message.includes("refused a message from"));
		expect(named).toHaveLength(1);
		expect(named[0]).toContain("refused a message from stranger [31m:");
		expect(named[0]).not.toContain("\u001b");
		await bridge.close();
	});

	test("the connected-as line carries the account label sanitized", async () => {
		const { ctx, notices } = fakeCtx();
		const deps: CommandDeps = {
			getBridge: () => undefined,
			startBridge: async () => "started",
			stopBridge: async () => false,
			loadConfig: () => DEFAULT_CONFIG,
			createLoginClient: async () => {
				throw new Error("this case logs in with a stored result, not a client");
			},
			saveAccount: () => {},
			storedAccount: () => undefined,
			readHistory: async () => "",
			logout: () => {},
			now: () => 0,
		};
		const noisy = { ...account, ilinkUserId: "owner\u001b[31m@im.wechat" };
		await finishLogin({ kind: "confirmed", account: noisy }, ctx, deps);
		const message = notices.at(-1)?.message ?? "";
		expect(message).toContain("WeChat connected as owner [31m.");
		expect(message).not.toContain("\u001b");
	});

	test("a failed turn names the sender without its control characters", async () => {
		const notices: string[] = [];
		// The host turn the runner opens rejects, so the runner's own notice is what shows.
		const failing: ChatTurn = {
			session: {
				prompt: async () => {
					throw new Error("model exploded");
				},
				abort: () => {},
				subscribe: () => () => {},
				getLastAssistantText: () => "",
			},
			dispose: async () => {},
		};
		const worker = createTurnRunner({
			openChat: async () => failing,
			send: async () => true,
			fallback: (_item, reason) => `fallback:${reason}`,
			notify: (message) => notices.push(message),
			idleTimeoutMs: 0,
		});
		worker.enqueue({ peer: "bad\u001b[31m@im.wechat", text: "ping", language: "en" });
		await settle();
		await settle();
		expect(notices).toHaveLength(1);
		expect(notices[0]).toContain("WeChat turn failed for bad [31m@im.wechat:");
		expect(notices[0]).not.toContain("\u001b");
		await worker.close();
	});

	test("the login screen sanitizes the status, the error, and the URL it shows", () => {
		// All three arrive from a QR poll; the QR itself is drawn here from block characters.
		const status = loginBody({ status: "mystery\u001b[31m", lines: [], url: "" }, 40);
		expect(status[0]).toBe("mystery [31m");
		const error = loginBody({ status: "wait", lines: [], url: "", error: "bad\u001b[1m" }, 40);
		expect(error[0]).toBe("bad [1m");
		// The URL is sanitized before it is chunked, so no chunk carries a control byte.
		const chunks = loginBody({ status: "wait", lines: ["XXXXX"], url: "ab\u001bcd" }, 4);
		expect(chunks.slice(1)).toEqual(["ab c", "d"]);
	});
});
