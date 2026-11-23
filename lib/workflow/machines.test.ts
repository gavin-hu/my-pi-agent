/**
 * Another machine in one frame: how a replicated bus reads on the page.
 *
 * Three facts hold the page's half of a shared bus, and all three are about *where*: a session
 * whose record names another machine says which one, a machine whose sessions have been pruned
 * still has a row, and this machine's own row is not one of them. The signature's rule is here too,
 * because a machine's age moves every second and a frame that signed it would push one per second.
 */

import { describe, expect, test } from "bun:test";
import type { HostRecord } from "../session-files.ts";
import type { RosterSession } from "../session-roster.ts";
import { SESSION_TTL_MS } from "../session-roster.ts";
import { buildView } from "./view.ts";

const NOW = 5_000;
const ME = { id: "s-lead", label: "billing-lead" };
const HERE = "aaaaaaaaaaaaaaa1";
const STUDIO = "bbbbbbbbbbbbbbb2";

/** One record as the roster hands it over, with the machine fields a case varies. */
function session(overrides: Partial<RosterSession> = {}): RosterSession {
	return { id: "s-core", label: "billing-core", mode: "tui", lastSeen: NOW, mail: 0, ...overrides };
}

/** One machine's row in `hosts/`. */
function machine(name: string, lastSeen = NOW): HostRecord {
	return { host: name === "studio" ? STUDIO : HERE, name, lastSeen };
}

/** A frame of one roster and its machines, with the arguments a case varies. */
function frame(
	roster: readonly RosterSession[],
	hosts?: readonly HostRecord[],
	host: string | undefined = HERE,
): ReturnType<typeof buildView> {
	return buildView({
		me: ME,
		cards: [],
		now: NOW,
		bytes: 0,
		where: "x",
		repo: "r",
		root: "/r",
		roster,
		...(hosts === undefined ? {} : { hosts }),
		...(host === undefined ? {} : { host }),
	});
}

describe("a machine's sessions", () => {
	test("draws every machine but this one, with its age read into a state", () => {
		const view = frame([session()], [machine("studio", NOW - SESSION_TTL_MS - 1), machine("here")]);
		// This machine's row is left out: its sessions are the column itself, and a row naming it
		// would say "another machine" about the one the page is read on.
		expect(view.machines).toEqual([{ name: "studio", seen: NOW - SESSION_TTL_MS - 1, state: "quiet" }]);
	});

	test("says which machine a teammate is on, and does not call it this seat", () => {
		// Two machines can hold one label, so a foreign row with this seat's name is still not this
		// seat: `you` is a fact about where a record was written, not only what it is called.
		const view = frame(
			[session({ foreign: true, host: STUDIO, label: ME.label }), session({ id: "s-other", label: "billing-web" })],
			[machine("studio"), machine("here")],
		);
		const foreign = view.teammates?.find((mate) => mate.label === ME.label);
		expect(foreign?.machine).toBe("studio");
		expect(foreign?.you).toBe(false);
		// This machine's own rows say nothing about a machine, because there is nothing to say.
		expect(view.teammates?.find((mate) => mate.label === "billing-web")?.machine).toBeUndefined();
	});

	test("signs a machine's name and state, and not its age", () => {
		const moving = (lastSeen: number) => frame([session()], [machine("studio", lastSeen)]).sig;
		// A heartbeat is not news, which is the rule the roster's own signature states: only a machine
		// crossing from live to quiet moves a frame.
		expect(moving(NOW - 1_000)).toBe(moving(NOW - 2_000));
		expect(moving(NOW - 1_000)).not.toBe(moving(NOW - SESSION_TTL_MS - 1));
		// And a bus with no other machine signs exactly what it signed before machines existed.
		expect(frame([session()], [machine("here")]).sig).toBe(frame([session()]).sig);
	});
});
