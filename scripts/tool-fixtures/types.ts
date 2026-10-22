/**
 * The shape of one gallery fixture.
 *
 * A fixture is the call and the `AgentToolResult` a real run would produce,
 * taken from the tool's `details` shape and matching what its `renderResult`
 * reads. Every path in one is synthetic: the gallery ships in the repo, so no
 * fixture may name the real workspace.
 */

/** The `AgentToolResult` a fixture renders. */
export interface FixtureResult {
	content: Array<{ type: "text"; text: string }>;
	details?: unknown;
	isError?: boolean;
}

/** One gallery entry. */
export interface ToolFixture {
	name: string;
	group: "builtin" | "package" | "transcript";
	/** The real tool to render when `name` is a variant label. */
	tool?: string;
	/** One line of context shown beside the name in the gallery. */
	label: string;
	/** The call arguments; unused by a `transcript` entry. */
	args?: unknown;
	/** The result the renderer draws; unused by a `transcript` entry. */
	result?: FixtureResult;
	/** Render options, e.g. `expanded` for a block that hides its body. */
	options?: { expanded?: boolean; isPartial?: boolean; argsComplete?: boolean; durationMs?: number };
}
