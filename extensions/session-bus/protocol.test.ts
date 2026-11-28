import { describe, expect, test } from "bun:test";
import {
	defaultLabel,
	lapseNotice,
	lapsedOwners,
	normalizeAbout,
	normalizeAction,
	normalizeKind,
	normalizeLabel,
	normalizeLimit,
	normalizePaths,
	normalizeReplyTo,
	normalizeText,
	resolveRecipients,
	sessionMode,
	settleSend,
	shortId,
} from "./protocol.ts";
import type { ClaimRecord } from "./types.ts";
import { INBOX_BUDGET } from "./format.ts";
import { MAX_MESSAGE_TEXT } from "../../lib/session-tool.ts";

describe("labels and actions", () => {
	test("normalizes a label and falls back when empty", () => {
		expect(normalizeLabel("  front\tend  ", "session")).toBe("front end");
		expect(normalizeLabel("   ", "session")).toBe("session");
	});
	test("uses the cwd basename as the default label", () => {
		expect(defaultLabel({ cwd: "/repo/frontend", id: "s1" })).toBe("frontend");
		expect(defaultLabel({ sessionName: "named", cwd: "/repo/frontend", id: "s1" })).toBe("named");
	});
	test("shortens an id for display", () => {
		expect(shortId("abcdef123456")).toBe("123456");
	});
	test("accepts only known actions and kinds", () => {
		expect(normalizeAction("send")).toBe("send");
		expect(normalizeAction("nope")).toBeUndefined();
		expect(normalizeKind(undefined)).toBe("message");
		expect(normalizeKind("handoff")).toBe("handoff");
	});
	test("records the session mode, and unknown for anything else", () => {
		expect(["tui", "rpc", "json", "print"].map((mode) => sessionMode(mode))).toEqual(["tui", "rpc", "json", "print"]);
		expect(sessionMode("wechat")).toBe("unknown");
		expect(sessionMode(undefined)).toBe("unknown");
	});
});

describe("validation", () => {
	test("trims text and enforces the limit", () => {
		expect(normalizeText("  hello  ")).toEqual({ text: "hello" });
		expect(normalizeText("   ")).toEqual({ error: "text is required." });
		expect(normalizeText("x".repeat(4_001))).toHaveProperty("error");
	});
	test("bounds a read at the cap a send refuses over, rather than a second number", () => {
		// One owner: `lib/session-tool.ts`'s MAX_MESSAGE_TEXT. The read takes one full-length body, and
		// a literal in the read's module is how its ceiling and the send's cap drift a number apart.
		expect(INBOX_BUDGET).toBe(MAX_MESSAGE_TEXT);
		expect(normalizeText("x".repeat(INBOX_BUDGET))).toEqual({ text: "x".repeat(INBOX_BUDGET) });
		expect(normalizeText("x".repeat(INBOX_BUDGET + 1))).toHaveProperty("error");
	});

	test("takes a reply id as one word, on the same alphabet as a key", () => {
		expect(normalizeReplyTo(undefined)).toEqual({});
		expect(normalizeReplyTo("  a1b2c3  ")).toEqual({ value: "a1b2c3" });
		expect(normalizeReplyTo("board.667")).toEqual({ value: "board.667" });
		// The value is named, because a sentence listing only the alphabet sends the sender hunting.
		expect(normalizeReplyTo("two words")).toEqual({
			error: 'replyTo "two words" may hold letters, digits, ".", "_", "-" and ":".',
		});
		expect(normalizeReplyTo("x".repeat(65))).toEqual({
			error: "replyTo is 65 characters; the limit is 64 — trim 1.",
		});
		expect(normalizeReplyTo("   ")).toEqual({ error: "replyTo must be a non-empty string." });
	});
	test("takes what a message is about as one line, in the sender's own spelling", () => {
		expect(normalizeAbout(undefined)).toEqual({});
		// The board's own spelling of a card — the value `about`'s description invites.
		expect(normalizeAbout("#673")).toEqual({ value: "#673" });
		expect(normalizeAbout("  dev stack restart  ")).toEqual({ value: "dev stack restart" });
		// One line, because a message row is one line: what is stored is already what is drawn.
		expect(normalizeAbout("a\nb")).toEqual({ value: "a b" });
		expect(normalizeAbout("x".repeat(65))).toEqual({
			error: "about is 65 characters; the limit is 64 — trim 1.",
		});
		expect(normalizeAbout("   ")).toEqual({ error: "about must be a non-empty string." });
	});
	test("settles a send's own words in one place, refusing the first that is wrong", () => {
		expect(settleSend({ to: "backend", text: "  hi  ", kind: "ask", about: "#673" })).toEqual({
			fields: { text: "hi", kind: "ask", about: "#673" },
		});
		// The rule that needs the addressee lives here too, after the words it is about.
		expect(settleSend({ to: "*", text: "hi", kind: "message" })).toEqual({
			error: 'a broadcast needs kind: "event".',
		});
		expect(settleSend({ to: "backend", text: "   " })).toEqual({ error: "text is required." });
	});
	test("clamps the inbox limit", () => {
		expect(normalizeLimit(undefined)).toBe(20);
		expect(normalizeLimit(0)).toBe(1);
		expect(normalizeLimit(999)).toBe(50);
	});
	test("makes paths repository-relative and rejects escapes", () => {
		expect(normalizePaths("/repo", "/repo/frontend", ["src/a.ts", "./src/a.ts"])).toEqual({
			paths: ["frontend/src/a.ts"],
		});
		expect(normalizePaths("/repo", "/repo", ["../outside"])).toEqual({
			error: 'path "../outside" is outside the repository.',
		});
		expect(normalizePaths("/repo", "/repo", [])).toHaveProperty("error");
	});
	test("hands a path that resolves to the root on in the caller's own spelling", () => {
		// The refusal is `resolve.ts`'s, so this module does not pre-empt it with a worse one.
		expect(normalizePaths("/repo", "/repo", ["."])).toEqual({ paths: ["."] });
		expect(normalizePaths("/repo", "/repo", ["src/.."])).toEqual({ paths: ["src/.."] });
		// From below the root, the same spelling is an ordinary claim on that directory.
		expect(normalizePaths("/repo", "/repo/src", ["."])).toEqual({ paths: ["src"] });
	});
});

describe("claim targets", () => {
	test("resolves an exact id, a unique label, or a broadcast", () => {
		const sessions = [
			{ id: "s1", label: "frontend" },
			{ id: "s2", label: "backend" },
		];
		expect(resolveRecipients(sessions, "s2", "s1")).toEqual({ recipients: [sessions[1]] });
		expect(resolveRecipients(sessions, "BACKEND", "s1")).toEqual({ recipients: [sessions[1]] });
		expect(resolveRecipients(sessions, "*", "s1")).toEqual({ recipients: [sessions[1]] });
	});
	test("names an ambiguous label and a name no record holds, in one sentence each", () => {
		const sessions = [
			{ id: "s1", label: "same" },
			{ id: "s2", label: "same" },
		];
		expect(resolveRecipients(sessions, "same", "s3")).toEqual({
			error: 'the label "same" is ambiguous; use a session id.',
		});
		expect(resolveRecipients(sessions, "missing", "s1")).toEqual({ error: 'no active session "missing".' });
	});
});

describe("addressing records that say whether they are alive", () => {
	test("a label held by a gone record and a live one reaches the live session", () => {
		// The session that held this id ended and a later one took its name: the label is the answer,
		// and the stopped holder is not a candidate. The bus's own wording for a stopped id stays a
		// refusal, because one `to` string is tried as an id and as a label before the rule is asked.
		const rows = [
			{ id: "s-dead", label: "api-core", state: "gone" as const },
			{ id: "s-live", label: "api-core", state: "live" as const },
		];
		expect(resolveRecipients(rows, "api-core", "s-x")).toEqual({ recipients: [rows[1]] });
	});

	test("refuses a name only a stopped record holds, and says which of the two it is", () => {
		const rows = [{ id: "s-dead", label: "api-core", state: "gone" as const }];
		// A name no record holds and a record whose process stopped are different facts: one is a typo to
		// retype, the other a name to drop. The listing marks the second, and this is the sentence that
		// says the same thing when mail is written to it. The two assertions also hold the two branches:
		// the id is named by `lookupPeer`'s last step, and the label is the only spelling that reaches the
		// branch where nothing was found.
		expect(resolveRecipients(rows, "s-dead", "s-x")).toEqual({
			error: 'no active session "s-dead" — its process is gone.',
		});
		expect(resolveRecipients(rows, "api-core", "s-x")).toEqual({
			error: 'no active session "api-core" — its process is gone.',
		});
	});

	test("skips a gone peer in a broadcast", () => {
		const rows = [
			{ id: "s-me", label: "me", state: "live" as const },
			{ id: "s-dead", label: "api-core", state: "gone" as const },
			{ id: "s-peer", label: "api-web", state: "live" as const },
		];
		expect(resolveRecipients(rows, "*", "s-me")).toEqual({ recipients: [rows[2]] });
	});

	test("delivers a note to itself with its own record gone", () => {
		// The sender is its own recipient whatever its record says: a heartbeat cannot refuse a
		// session its own note.
		const rows = [{ id: "s-me", label: "me", state: "gone" as const }];
		expect(resolveRecipients(rows, "s-me", "s-me")).toEqual({ recipients: [rows[0]] });
	});
});

/**
 * Who a lapse's notice reaches, and what it says.
 *
 * The rule the prune's answer is put through, tested here because it is the one decision in the
 * notice that the filesystem cannot show: who is owed a sentence and who is not.
 */
describe("a lapse's notice", () => {
	const claim = (path: string, owner: string, host?: string): ClaimRecord => ({
		path,
		owner,
		ownerLabel: `${owner}-label`,
		at: 0,
		...(host === undefined ? {} : { host }),
	});

	test("groups one owner's paths into one notice, and leaves this session out", () => {
		const owners = lapsedOwners([claim("src/a.ts", "s2"), claim("src/b.ts", "s2"), claim("src/c.ts", "me")], {
			host: "here",
			self: "me",
		});
		expect([...owners.keys()]).toEqual(["s2"]);
		expect(owners.get("s2")?.map((entry) => entry.path)).toEqual(["src/a.ts", "src/b.ts"]);
	});

	test("leaves another machine's claim to that machine's mail", () => {
		const owners = lapsedOwners([claim("src/a.ts", "s2", "elsewhere"), claim("src/b.ts", "s3")], {
			host: "here",
			self: "me",
		});
		expect([...owners.keys()]).toEqual(["s3"]);
	});

	test("names the paths, keeps the grammar of one, and counts past six", () => {
		expect(lapseNotice(["src/a.ts"])).toBe(
			"claim lapse: 1 path is no longer yours — src/a.ts. Claim it again if the work is still yours.",
		);
		const many = lapseNotice(["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"]);
		expect(many).toContain("8 paths are no longer yours — p1, p2, p3, p4, p5, p6 and 2 more.");
		expect(many).not.toContain("p7");
	});
});
