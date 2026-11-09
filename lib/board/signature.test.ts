/**
 * What decides whether the page is sent a frame at all: the signature.
 *
 * A frame is a whole snapshot, so the page is offered one every second and pushed only when
 * this string moved. Every fact a reader can see belongs in it, or the tab keeps a frame that
 * is no longer true — which is why the rollup's clock is one of them: `unwritten` is a
 * membership time alone decides, and a card going quiet moved the queue without moving any
 * card's revision.
 *
 * Held apart from `view.test.ts` — what a frame *carries* — because those are two questions
 * about one record, and that suite is named at its height.
 */

import { describe, expect, test } from "bun:test";
import { type Card, signatureOf } from "./card.ts";
import { boardCard as cardFixture } from "../../test/helpers/fixtures/board.ts";
import { UNWRITTEN_MS } from "./round.ts";
import { buildView } from "./view.ts";

const NOW = 5_000;

const ME = { id: "s-lead", label: "billing-lead" };
const WHERE = "~/.pi/agent/board/8872d3adda0e";
const REPO = "my-pi-agent";
const ROOT = "/Users/someone/my-pi-agent";

/** One snapshot at `now`, with the arguments a case varies. */
function view(
	cards: readonly Card[],
	now = NOW,
	roster?: Parameters<typeof buildView>[0]["roster"],
): ReturnType<typeof buildView> {
	return buildView({
		me: ME,
		cards: [...cards],
		now,
		bytes: 0,
		where: WHERE,
		repo: REPO,
		root: ROOT,
		...(roster === undefined ? {} : { roster }),
	});
}

describe("the frame's signature", () => {
	test("starts from the cards' signature, so a bump or a drop moves it", () => {
		const one = cardFixture("1", { updatedAt: NOW });
		const base = view([one]);
		expect(base.sig.startsWith(signatureOf([one]))).toBe(true);
		expect(view([{ ...one, rev: 2 }]).sig).not.toBe(base.sig);
		expect(view([]).sig).not.toBe(base.sig);
	});

	test("moves when the clock pushes a card into the rollup's unwritten set", () => {
		// One executing card, last written at `NOW`, and nothing else happens: the only fact that
		// changes is that half an hour went by, and the queue is where a lead reads that.
		const quiet = cardFixture("1", { lane: "execute", owner: { label: "billing-core" }, updatedAt: NOW });
		const early = view([quiet], NOW + UNWRITTEN_MS - 60_000);
		const late = view([quiet], NOW + UNWRITTEN_MS + 60_000);
		expect(early.round.unwritten).toEqual([]);
		expect(late.round.unwritten.map((entry) => entry.id)).toEqual(["1"]);
		expect(late.sig).not.toBe(early.sig);
		// It is the membership and not the minute: the same age twice is the same frame, so a
		// quiet board still pushes nothing.
		expect(view([quiet], NOW + UNWRITTEN_MS + 60_000).sig).toBe(late.sig);
	});

	test("moves on a join, a quiet, and mail, and not on a heartbeat", () => {
		const at = (roster: NonNullable<Parameters<typeof buildView>[0]["roster"]>) => view([], NOW, roster).sig;
		const base = at([{ id: "s-core", label: "billing-core", mode: "tui", lastSeen: NOW - 1_000, mail: 0 }]);
		const heartbeat = at([{ id: "s-core", label: "billing-core", mode: "tui", lastSeen: NOW, mail: 0 }]);
		expect(heartbeat).toBe(base);
		const joined = at([
			{ id: "s-core", label: "billing-core", mode: "tui", lastSeen: NOW, mail: 0 },
			{ id: "s-new", label: "api", mode: "tui", lastSeen: NOW, mail: 0 },
		]);
		expect(joined).not.toBe(base);
		const mailed = at([{ id: "s-core", label: "billing-core", mode: "tui", lastSeen: NOW, mail: 1 }]);
		expect(mailed).not.toBe(base);
		const quiet = at([{ id: "s-core", label: "billing-core", mode: "tui", lastSeen: NOW - 20 * 60_000, mail: 0 }]);
		expect(quiet).not.toBe(base);
		// Listening is news too: a peer arming its watch changes what the row says, and the frame
		// has to be drawn again or the mark would be a frame behind.
		const listening = at([
			{
				id: "s-core",
				label: "billing-core",
				mode: "tui",
				lastSeen: NOW,
				mail: 0,
				watching: { armed: true, wake: false },
			},
		]);
		expect(listening).not.toBe(base);
	});

	test("carries the files a reader cannot open, so a swapped one is a new frame", () => {
		const withSkips = (skipped: NonNullable<Parameters<typeof buildView>[0]["skipped"]>) =>
			buildView({ me: ME, cards: [], now: NOW, bytes: 0, skipped, where: WHERE, repo: REPO, root: ROOT }).sig;
		const plain = withSkips([]);
		const two = withSkips([
			{ file: "0042.json", why: "bad JSON" },
			{ file: "0051.json", why: "version 3" },
		]);
		expect(two).not.toBe(plain);
		// A different file refusing to read leaves the count alone, so the names have to be in here.
		expect(withSkips([{ file: "0077.json", why: "bad JSON" }])).not.toBe(
			withSkips([{ file: "0042.json", why: "bad JSON" }]),
		);
	});
});
