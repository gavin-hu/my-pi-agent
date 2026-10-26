/**
 * The tool-rendering gallery's fixtures, one module per tool family (dev tooling).
 *
 * `FIXTURES` is the gallery's order: the transcript surfaces, Pi's built-ins,
 * then this package's tools grouped by the extension they belong to. That order
 * is contract — the committed gallery PNG is this sequence — so a new fixture
 * joins its family's module rather than the end of this list.
 */

import { BOARD_FIXTURES } from "./board.ts";
import { BUILTIN_FIXTURES } from "./builtin.ts";
import { CHECK_FIXTURES } from "./check.ts";
import { DELEGATION_FIXTURES } from "./delegation.ts";
import { INTERACTION_FIXTURES } from "./interaction.ts";
import { JOB_FIXTURES } from "./jobs.ts";
import { PLAN_FIXTURES } from "./plan.ts";
import { SESSION_FIXTURES } from "./session.ts";
import type { ToolFixture } from "./types.ts";
import { TRANSCRIPT_FIXTURES } from "./transcript.ts";
import { VARIANT_FIXTURES } from "./variants.ts";
import { WEB_FIXTURES } from "./web.ts";
import { WORKTREE_FIXTURES } from "./worktree.ts";

export { JOB_RECORDS } from "./jobs.ts";
export type { FixtureResult, ToolFixture } from "./types.ts";

/** Every gallery entry, in the order the gallery and its committed PNG use. */
export const FIXTURES: ToolFixture[] = [
	...TRANSCRIPT_FIXTURES,
	...BUILTIN_FIXTURES,
	...VARIANT_FIXTURES,
	...SESSION_FIXTURES,
	...JOB_FIXTURES,
	...DELEGATION_FIXTURES,
	...WEB_FIXTURES,
	...CHECK_FIXTURES,
	...INTERACTION_FIXTURES,
	...PLAN_FIXTURES,
	...WORKTREE_FIXTURES,
	...BOARD_FIXTURES,
];
