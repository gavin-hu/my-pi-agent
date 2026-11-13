/**
 * The board page's class vocabulary, as one table.
 *
 * The document (`page.ts`) and the client bundle cannot import from each other, so a
 * class name used to be a string in each — and two of them were assembled at runtime
 * (`"board-row__priority--" + level`), which is why nothing could compare what the page
 * wears with what `styles.ts` draws. Reading both halves from this table makes those two
 * sets enumerable, and `pages.test.ts` holds them equal.
 *
 * A name here is a **class**, not an id: ids are how the client finds an element
 * (`getElementById`), they are not styled, and `pages.test.ts` pins their list. The
 * shared shapes — a lane, a row, a section, a tone, a badge — are the kit's (`bf-*`);
 * these are the board's own hooks and the details the kit does not name.
 */

/** Every `board-*` class the page wears. Keys are what the code reads; values are what CSS matches. */
export const BOARD_CLASS = {
	// The shell's page hooks and the two panel wrappers.
	bar: "board-bar",
	main: "board-main",
	panel: "board-panel",
	picker: "board-picker",
	progress: "board-progress",
	filter: "board-filter",
	noCards: "board-no-cards",
	skeleton: "board-skeleton",

	// One lane: a head with a tone rule, then rows.
	lanes: "board-lanes",
	lane: "board-lane",
	laneToggle: "board-lane__toggle",
	laneList: "bf-lane__list",

	// One row: the card's body, its facts, and its paths.
	row: "board-row",
	rowBody: "board-row__body",
	// A note leads with what it is — its id, its kind, its order — and whose it is at the far
	// edge, before its name.
	rowTop: "board-row__top",
	rowOwner: "board-row__owner",
	rowHead: "board-row__head",
	rowNotes: "board-row__notes",
	rowPaths: "board-row__paths",
	// The `+N` marker trails the row rather than being a tag that can be left alone on a line.
	rowMore: "board-row__more",
	// A priority is a word and a level, not a second tag: the level is what it is coloured by.
	rowPriority: "board-row__priority",
	rowPriorityHigh: "board-row__priority--high",
	rowPriorityLow: "board-row__priority--low",

	// The card dialog: the record of one card — its reason, a ladder of facts, the contract
	// it promises, and its notes.
	dialogPanel: "board-dialog__panel",
	dialogHead: "board-dialog__head",
	dialogId: "board-dialog__id",
	dialogState: "board-dialog__state",
	// How long the card has held the lane the head names, in the lane word's own line.
	dialogAge: "board-dialog__age",
	dialogBody: "board-dialog__body",
	dialogSection: "board-dialog__section",
	dialogHeading: "board-dialog__heading",
	dialogCount: "board-dialog__count",
	dialogFacts: "board-dialog__facts",
	dialogPaths: "board-dialog__paths",
	dialogPath: "board-dialog__path",
	dialogValue: "board-dialog__value",
	dialogPlan: "board-dialog__plan",
	// The sentence the card face prints, whole, and the promise it was opened to read: the
	// contract's block is its own, and its signature closes it.
	dialogReason: "board-dialog__reason",
	dialogContract: "board-dialog__contract",
	dialogSign: "board-dialog__sign",
	dialogNotes: "board-dialog__notes",
	dialogNote: "board-dialog__note",
	dialogNoteFoot: "board-dialog__note-foot",
	dialogNoteBy: "board-dialog__note-by",
	dialogNoteAt: "board-dialog__note-at",
	dialogNoteText: "board-dialog__note-text",

	// The Team tab: three columns — the agents, the work that is moving, what arrived.
	team: "board-team",
	teamGrid: "board-team__grid",
	teamColumn: "board-team__column",
	teamEmpty: "board-team__empty",
	teamSkeleton: "board-team__skeleton",

	// Left: one row per session, the lead pinned first.
	agents: "board-team__agents",
	agent: "board-agent",
	agentBody: "board-agent__body",
	agentHead: "board-agent__head",
	monogram: "board-agent__monogram",
	agentName: "board-agent__name",
	agentChips: "board-agent__chips",
	agentState: "board-agent__state",
	agentMail: "board-agent__mail",
	missions: "board-team__missions",
	mission: "board-team__mission",
	missionRef: "board-team__mission-ref",
	missionLane: "board-team__mission-lane",
	missionAge: "board-team__mission-age",
	agentNone: "board-team__none",
	// Both "there is more" controls and the folded history row: one shape for one fact.
	fold: "board-fold",

	// Middle: the queue of asks, in bands, over three swimlanes.
	queue: "board-queue",
	queueBand: "board-queue__band",
	queueRow: "board-queue__row",
	queueRank: "board-queue__rank",
	queueRef: "board-queue__ref",
	queueWhy: "board-queue__why",
	teamLanes: "board-team__lanes",
	// A person's lines: the cards one session holds, one line each.

	// Right: the mail nobody has read, then what the cards say happened.
	paneBody: "board-team__pane-body",
	waiting: "board-team__waiting",
	mail: "board-mail",
	mailBody: "board-mail__body",
	mailFrom: "board-mail__from",
	mailArrow: "board-mail__arrow",
	mailTo: "board-mail__to",
	recent: "board-team__recent",
	event: "board-event",
	eventRef: "board-event__ref",
	eventWhat: "board-event__what",

	// An age, wherever one is printed: a stamp the ticker keeps honest, pushed to the row's edge.
	stamp: "board-stamp",
	// A state dot, shared by an agent's pill and a waiting row's recipient: one vocabulary for
	// live, quiet, gone and no record, whichever column reads it.
	dot: "board-dot",
	// The owner, as a dot and a name, on both cards inside ACTIVE WORK.
	owner: "board-owner",
} as const satisfies Readonly<Record<string, string>>;
