/**
 * The shared label rules: the cap, the one-line flattening, and the fallback
 * chain a session betrays its name with.
 *
 * These live in `lib/` because the board records a label on a card and
 * `session-bus` settles the one a session is addressed by, so the two must agree
 * character for character — a card that names `billing core` while the bus
 * answers to `billing-core` cannot be assigned.
 */

import { describe, expect, test } from "bun:test";
import {
	agentLabel,
	defaultLabel,
	MAX_LABEL,
	normalizeLabel,
	presetNameFor,
	shortId,
	TEAM_AGENT_PREFIX,
	TEAMMATE_NAMES,
} from "./session-label.ts";

describe("normalizeLabel", () => {
	test("collapses whitespace and trims", () => {
		expect(normalizeLabel("  billing   core \n", "fallback")).toBe("billing core");
	});

	test("falls back when the name is empty or missing", () => {
		expect(normalizeLabel(undefined, "fallback")).toBe("fallback");
		expect(normalizeLabel("   ", "fallback")).toBe("fallback");
	});

	test("keeps one line, so a label cannot wrap a row or open a second line", () => {
		expect(normalizeLabel("a\r\nb", "fallback")).toBe("a b");
	});

	test("caps the label, and the cap is what a target may be", () => {
		const long = "x".repeat(MAX_LABEL + 20);
		expect(normalizeLabel(long, "fallback")).toHaveLength(MAX_LABEL);
	});
});

describe("shortId", () => {
	test("keeps the tail of the alphanumerics", () => {
		expect(shortId("2026-10-25-abc123")).toBe("abc123");
	});

	test("survives an id with nothing alphanumeric in it", () => {
		expect(shortId("----")).toBe("----");
	});
});

describe("agentLabel", () => {
	test("names the session after the tail of its id", () => {
		expect(agentLabel("session-9f21ac3b")).toBe("team-agent-21ac3b");
	});

	test("derives the same name every time, whatever the user calls the session", () => {
		// The point of deriving it: a rename cannot strand the card that recorded the name.
		expect(agentLabel("session-9f21ac3b")).toBe(agentLabel("session-9f21ac3b"));
		expect(agentLabel("session-9f21ac3b")).not.toBe(agentLabel("session-00000000"));
	});

	test("stays one line and inside the cap, because it is a target", () => {
		const label = agentLabel(`x-${"y".repeat(MAX_LABEL * 2)}`);
		expect(label.length).toBeLessThanOrEqual(MAX_LABEL);
		expect(label.startsWith(TEAM_AGENT_PREFIX)).toBe(true);
		expect(agentLabel("a\nb")).toBe("team-agent-ab");
	});

	test("keeps a name even when the id has nothing alphanumeric in it", () => {
		expect(agentLabel("----")).toBe("team-agent-----");
	});
});

describe("TEAMMATE_NAMES", () => {
	test("are distinct names a person answers to, not derived ids", () => {
		expect(new Set(TEAMMATE_NAMES).size).toBe(TEAMMATE_NAMES.length);
		for (const name of TEAMMATE_NAMES) {
			// A name is a label, so it is already one line, inside the cap, and one word.
			expect(normalizeLabel(name, ""), name).toBe(name);
			expect(name, name).toMatch(/^[a-z]{2,8}$/);
		}
	});
});

describe("presetNameFor", () => {
	test("draws the same name for the same id every time", () => {
		const drawn = presetNameFor("session-9f21ac3b");
		if (drawn === undefined) throw new Error("the pool is empty");
		const pool: readonly string[] = TEAMMATE_NAMES;
		expect(pool).toContain(drawn);
		expect(presetNameFor("session-9f21ac3b")).toBe(drawn);
	});

	test("spreads different sessions across the list", () => {
		const ids = Array.from({ length: 40 }, (_, index) => `session-${index}`);
		const drawn = new Set(ids.map((id) => presetNameFor(id)));
		expect(drawn.size).toBeGreaterThan(5);
	});

	test("skips a name a live teammate holds, and walks on to the next free one", () => {
		const first = presetNameFor("s-1");
		if (first === undefined) throw new Error("the pool is empty");
		const second = presetNameFor("s-1", [first]);
		if (second === undefined) throw new Error("the pool is empty");
		expect(second).not.toBe(first);
		expect(presetNameFor("s-1", [first, second])).not.toBe(first);
		expect(presetNameFor("s-1", [first, second])).not.toBe(second);
	});

	test("compares a held label the way a peer is addressed: without case", () => {
		const first = presetNameFor("s-1");
		if (first === undefined) throw new Error("the pool is empty");
		expect(presetNameFor("s-1", [first.toUpperCase()])).not.toBe(first);
	});

	test("answers nothing when every name is taken, so the caller can fall back", () => {
		expect(presetNameFor("s-1", TEAMMATE_NAMES)).toBeUndefined();
	});
});

describe("defaultLabel", () => {
	test("prefers the Pi session name", () => {
		expect(defaultLabel("billing lead", "/repo/somewhere", "id-1")).toBe("billing lead");
	});

	test("falls back to the working directory's basename", () => {
		expect(defaultLabel(undefined, "/repo/my-pi-agent", "id-1")).toBe("my-pi-agent");
		expect(defaultLabel("   ", "/repo/my-pi-agent", "id-1")).toBe("my-pi-agent");
	});

	test("falls back to `session` when there is no name and no directory to borrow", () => {
		// A cwd with no last segment borrows nothing, and the label itself is the
		// fallback before the id ever is.
		expect(defaultLabel(undefined, "/", "session-9191")).toBe("session");
	});

	test("a windows path borrows its last segment too", () => {
		expect(defaultLabel(undefined, "C:\\work\\billing", "id-1")).toBe("billing");
	});
});
