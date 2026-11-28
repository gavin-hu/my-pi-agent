/**
 * The `/sessions` board's bus: this session, two peers — one of them not listening and one whose
 * process is gone — three held paths, one unread message, and the inbox watch armed.
 *
 * Both marks the board can draw are here because the frame is what a reader learns them from: a
 * capture with three healthy rows would show neither.
 */

import type { BoardSnapshot } from "../../../extensions/session-bus/types.ts";
import { now } from "./shared.ts";

/** The board one frame of `/sessions` draws. */
export const BUS_BOARD: BoardSnapshot = {
	status: {
		me: { id: "3f9a2c1b7d40", label: "billing-core" },
		onBus: true,
		watching: { armed: true, wake: false },
		sessions: [
			{
				id: "3f9a2c1b7d40",
				label: "billing-core",
				pid: 48213,
				cwd: "/home/u/repo/billing",
				repoRoot: "/home/u/repo/billing",
				mode: "tui",
				startedAt: now - 41 * 60_000,
				lastSeen: now - 2_000,
				unread: 1,
				state: "live",
				// The same watch the summary chip draws: one frame cannot say `you: watch on` and
				// `watch: not recorded` about one session.
				watching: { armed: true, wake: false },
			},
			{
				id: "8c14de60a2f1",
				label: "integrator",
				pid: 48240,
				cwd: "/home/u/repo/billing",
				repoRoot: "/home/u/repo/billing",
				mode: "tui",
				startedAt: now - 33 * 60_000,
				lastSeen: now - 4_000,
				unread: 0,
				state: "live",
				watching: { armed: false, wake: false },
			},
			{
				id: "a71f90c3e5b2",
				label: "verify-billing",
				pid: 48288,
				cwd: "/home/u/repo/billing",
				repoRoot: "/home/u/repo/billing",
				mode: "rpc",
				startedAt: now - 12 * 60_000,
				lastSeen: now - 9_000,
				unread: 1,
				state: "gone",
			},
		],
		claims: [
			{ path: "src/api", owner: "3f9a2c1b7d40", ownerLabel: "billing-core", at: now - 5 * 60_000 },
			{ path: "src/api/routes.ts", owner: "3f9a2c1b7d40", ownerLabel: "billing-core", at: now - 5 * 60_000 },
			{ path: "src/db", owner: "8c14de60a2f1", ownerLabel: "integrator", at: now - 3 * 60_000 },
		],
	},
	messages: [
		{
			id: "1-a",
			from: "8c14de60a2f1",
			fromLabel: "integrator",
			to: "3f9a2c1b7d40",
			toLabel: "billing-core",
			kind: "event",
			text: "contract v2 landed: POST /orders now requires an idempotencyKey header, and the 409 path changed",
			paths: ["src/api"],
			at: now - 2 * 60_000,
		},
	],
};
