/**
 * The board page's class vocabulary, as one table.
 *
 * The document (`page.ts`) and the client bundle cannot import from each other, so a
 * class name used to be a string in each — and two of them were assembled at runtime
 * (`"board-card__reason" + kind`), which is why nothing could compare what the page
 * wears with what `styles.ts` draws. Reading both halves from this table makes those two
 * sets enumerable, and `pages.test.ts` holds them equal.
 *
 * A name here is a **class**, not an id: ids are how the client finds an element
 * (`getElementById`), they are not styled, and `pages.test.ts` pins their list.
 */

/** Every `board-*` class the page wears. Keys are what the code reads; values are what CSS matches. */
export const BOARD_CLASS = {
	// The shell, the toolbar, the bar under it, and the two panel wrappers.
	toolbar: "board-toolbar",
	bar: "board-bar",
	main: "board-main",
	panel: "board-panel",
	filter: "board-filter",
	picker: "board-picker",
	progress: "board-progress",
	noCards: "board-no-cards",
	skeleton: "board-skeleton",

	// One lane: a tray of cards with a head that sticks and folds.
	lanes: "board-lanes",
	lane: "board-lane",
	laneHead: "board-lane__head",
	laneDot: "board-lane__dot",
	laneToggle: "board-lane__toggle",
	laneCount: "board-lane__count",
	laneList: "board-lane__list",
	laneEmpty: "board-lane__empty",

	// One card, the facts its meta line carries, and the two tones its reason line can take.
	card: "board-card",
	cardHead: "board-card__head",
	cardId: "board-card__id",
	cardTitle: "board-card__title",
	cardMeta: "board-card__meta",
	cardNotes: "board-card__notes",
	cardPaths: "board-card__paths",
	cardReason: "board-card__reason",
	// One class per tone, never per reason kind: the same tone is what the terminal paints.
	cardReasonMuted: "board-card__reason--muted",
	cardReasonDim: "board-card__reason--dim",
	cardReasonWarn: "board-card__reason--warn",
	cardReasonAccent: "board-card__reason--accent",
	cardReasonDanger: "board-card__reason--danger",
	cardReasonSuccess: "board-card__reason--success",
	// A priority is a word and a level, not a second pill: the level is what it is coloured by.
	cardPriority: "board-card__priority",
	cardPriorityHigh: "board-card__priority--high",
	cardPriorityLow: "board-card__priority--low",
	// A kind is a label the card carries rather than a state it is in, so the one pill on the
	// row stays the person and the kind stays a word.
	kind: "board-kind",
	// The marker rides inside the kind's own label: `feature · breaking` is one statement, and
	// the half that a release must say out loud is the half that is coloured.
	kindBreaking: "board-kind__breaking",

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
	// The shell and its captions.
	team: "board-team",
	teamGrid: "board-team__grid",
	teamColumn: "board-team__column",
	teamCaption: "board-team__caption",
	teamCount: "board-team__count",
	teamDoor: "board-team__door",
	teamEmpty: "board-team__empty",
	teamSkeleton: "board-team__skeleton",

	// Left: one card per session, the lead pinned first.
	agents: "board-team__agents",
	agent: "board-team__agent",
	agentHead: "board-team__agent-head",
	monogram: "board-team__monogram",
	agentName: "board-team__agent-name",
	agentChips: "board-team__agent-chips",
	agentState: "board-team__state",
	agentMail: "board-team__mail",
	missions: "board-team__missions",
	mission: "board-team__mission",
	missionBar: "board-team__bar",
	missionRef: "board-team__mission-ref",
	missionLane: "board-team__mission-lane",
	missionAge: "board-team__mission-age",
	agentNone: "board-team__none",
	agentFold: "board-team__agent-fold",

	// Middle: the strip of decisions over three swimlanes.
	decisions: "board-team__decisions",
	decision: "board-team__decision",
	decisionOpen: "board-team__open",
	decisionRef: "board-team__ref",
	decisionTitle: "board-team__title",
	decisionWhy: "board-team__why",
	decisionMore: "board-team__more",
	teamLanes: "board-team__lanes",
	// A swimlane: the Team tab's own head and tray, not the Board tab's `lane*` above.
	teamLane: "board-team__lane",
	teamLaneHead: "board-team__lane-head",
	teamLaneDot: "board-team__lane-dot",
	teamLaneName: "board-team__lane-name",
	teamLaneCount: "board-team__lane-count",
	teamLaneFold: "board-team__lane-fold",
	teamLaneEmpty: "board-team__lane-empty",
	swim: "board-team__swim",
	// A mission card: the one-line face a swimlane holds, with its lane as a bar.
	missionCard: "board-team__card",
	missionCardHead: "board-team__card-head",
	missionCardRef: "board-team__card-ref",
	missionTitle: "board-team__card-title",
	missionMeta: "board-team__card-meta",

	// Right: the mail nobody has read, then what the cards say happened.
	pane: "board-team__pane",
	paneBody: "board-team__pane-body",
	paneCount: "board-team__pane-count",
	waiting: "board-team__waiting",
	mailRow: "board-team__mail-row",
	glyph: "board-team__glyph",
	mailFrom: "board-team__mail-from",
	mailArrow: "board-team__mail-arrow",
	mailTo: "board-team__mail-to",
	recent: "board-team__recent",
	event: "board-team__event",
	eventRef: "board-team__event-ref",
	eventWhat: "board-team__event-what",

	// An age, wherever one is printed: a stamp the ticker keeps honest, pushed to the row's edge.
	stamp: "board-team__stamp",
	// A state dot, shared by an agent's pill and a waiting row's recipient: one vocabulary for
	// live, quiet, gone and no record, whichever column reads it. The kind's own word reuses
	// `kind` above: a decision row and a mission card wear the label a card face wears.
	dot: "board-team__dot",
} as const satisfies Readonly<Record<string, string>>;
