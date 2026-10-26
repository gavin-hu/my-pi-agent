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
	// The shell, the toolbar, and the two panel wrappers.
	toolbar: "board-toolbar",
	controls: "board-controls",
	main: "board-main",
	panel: "board-panel",
	filter: "board-filter",
	picker: "board-picker",
	progress: "board-progress",
	status: "board-status",
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

	// One card, and the two tones its reason line can take.
	card: "board-card",
	cardHead: "board-card__head",
	cardId: "board-card__id",
	cardTitle: "board-card__title",
	cardMeta: "board-card__meta",
	cardPaths: "board-card__paths",
	cardReason: "board-card__reason",
	cardReasonBlocked: "board-card__reason--blocked",
	cardReasonUnplanned: "board-card__reason--unplanned",

	// The card dialog: the record of one card, as a ladder of facts and its notes.
	dialogPanel: "board-dialog__panel",
	dialogHead: "board-dialog__head",
	dialogId: "board-dialog__id",
	dialogState: "board-dialog__state",
	dialogBody: "board-dialog__body",
	dialogSection: "board-dialog__section",
	dialogHeading: "board-dialog__heading",
	dialogCount: "board-dialog__count",
	dialogFacts: "board-dialog__facts",
	dialogPaths: "board-dialog__paths",
	dialogPath: "board-dialog__path",
	dialogValue: "board-dialog__value",
	dialogPlan: "board-dialog__plan",
	dialogNotes: "board-dialog__notes",
	dialogNote: "board-dialog__note",
	dialogNoteFoot: "board-dialog__note-foot",
	dialogNoteBy: "board-dialog__note-by",
	dialogNoteAt: "board-dialog__note-at",
	dialogNoteText: "board-dialog__note-text",

	// The Team tab: the queue of decisions, the roster, and the Done strip.
	team: "board-team",
	teamGrid: "board-team__grid",
	teamGroup: "board-team__group",
	teamCaption: "board-team__caption",
	teamQueue: "board-team__queue",
	teamDecision: "board-team__decision",
	teamOpen: "board-team__open",
	teamRef: "board-team__ref",
	teamTitle: "board-team__title",
	teamFoot: "board-team__foot",
	teamWhy: "board-team__why",
	teamWhyBlocked: "board-team__why--blocked",
	teamRoster: "board-team__roster",
	teamMate: "board-team__mate",
	teamDot: "board-team__dot",
	teamName: "board-team__name",
	teamMets: "board-team__mets",
	teamEmpty: "board-team__empty",
	teamDone: "board-team__done",
	teamId: "board-team__id",
} as const satisfies Readonly<Record<string, string>>;
