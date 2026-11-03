/**
 * The browser runtime the three page clients splice into their bundles: the element builder,
 * the "is the user typing?" test, the status line, the live chip's painter, the JSON POST,
 * and the event-stream client.
 *
 * Surfaces had written each of these for themselves, and because a bundle is a
 * template literal no type checker and no AST scan ever compared them: the plan's
 * `el(tag, className)` and the board's `el(tag, className, text)` were two builders, and
 * the plan's `typing` compared `INPUT` where the board's lowercased the tag. The stream was
 * the worst of them, with three state machines that disagreed about what a dropped
 * connection means. Each is now one body, written here as real TypeScript, and each client
 * carries the *source* (`CLIENT_RUNTIME_JS`) the same way it carries `plural` and the class
 * table.
 *
 * The functions are plain JavaScript on purpose: their text is spliced into a bundle, so
 * no annotation may survive into the string and no backtick or `${` may appear in a body.
 * The DOM is reached through `globalThis`, because this project compiles without a DOM
 * lib — the cast names the guarantee the page makes: it is a browser, and it has one.
 */

/**
 * The pieces of a DOM node the runtime touches, and the ones a page client needs beyond
 * it. The page supplies the real thing; this is the shape its bundle is typed against.
 */
export interface ClientNode {
	className: string;
	textContent: string | null;
	title: string;
	hidden: boolean;
	href: string;
	id: string;
	style: { width: string };
	type: string;
	scrollTop: number;
	contains(other: ClientNode | null): boolean;
	focus(): void;
	classList: { add(name: string): void; remove(name: string): void; toggle(name: string, on?: boolean): void };
	setAttribute(name: string, value: string): void;
	getAttribute(name: string): string | null;
	removeAttribute(name: string): void;
	appendChild(child: ClientNode): void;
	remove(): void;
	replaceChildren(): void;
	querySelector(selector: string): ClientNode | null;
	querySelectorAll(selector: string): ArrayLike<ClientNode>;
	scrollIntoView?(options?: { block?: string }): void;
	addEventListener(type: string, listener: (event: { target?: unknown }) => void): void;
}

/** What `document.createElement` has to answer for these helpers. */
interface RuntimeDocument {
	createElement(tag: string): ClientNode;
}

/** One frame off a stream, as a listener reads it: the event's name and the server's text. */
export interface StreamEvent {
	type: string;
	data?: string;
}

/** The part of an `EventSource` the stream client uses, and the whole of what it needs. */
interface EventStream {
	onopen: ((event: StreamEvent) => void) | null;
	onerror: ((event: StreamEvent) => void) | null;
	onmessage: ((event: StreamEvent) => void) | null;
	addEventListener(name: string, listener: (event: StreamEvent) => void): void;
	close(): void;
}

/** The states a served page's stream may be in: the one list of them. */
export type LiveState = "connecting" | "live" | "reconnecting" | "dead";

/** What a page tells its stream: where to listen, what a state says, and what a frame is. */
export interface LiveStreamOptions {
	/** Where the stream is served, prefix and token included. */
	url: string;
	/** Named frames the page wants beside the default `message`. */
	events?: readonly string[];
	/**
	 * Failed connects in a row before the stream is dead.
	 *
	 * The browser retries an `EventSource` by itself, so a count is the only thing a page
	 * has to say which retry is no longer a blip. Defaults to three.
	 */
	attempts?: number;
	/** Paint one state in the page's own words: the chip's tone, its word, and its hover. */
	words(state: LiveState): void;
	/** One frame arrived, named or not. */
	frame(event: StreamEvent): void;
}

/** A running stream: the page's one way to end it. */
export interface LiveStream {
	/** Stop listening. A late state is never painted, and the socket is released. */
	close(): void;
}

/**
 * One element with an optional class and text.
 *
 * `text` is set as `textContent`, never parsed: a card title and a plan's prose are both
 * model- or user-written, and the one property that cannot execute is the one to use.
 */
export function el(tag: string, className?: string, text?: string | null): ClientNode {
	// Reached through `globalThis` and cast here, because this project compiles without a
	// DOM lib; the cast names what the page guarantees — it is a browser, and it has one.
	const node = (globalThis as unknown as { document: RuntimeDocument }).document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined && text !== null) node.textContent = String(text);
	return node;
}

/**
 * Whether a key event landed in a field, where every key is text rather than a shortcut.
 *
 * The tag is lowercased once, so a document parsed as XHTML (`tagName` upper case) and a
 * page built by `createElement` (`tagName` lower case) both answer the same.
 */
export function typing(target: { tagName?: string; isContentEditable?: boolean }): boolean {
	if (!target || !target.tagName) return target?.isContentEditable === true;
	const tag = target.tagName.toLowerCase();
	return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable === true;
}

/**
 * Paint a status line: its text, the same text as its tooltip, and its tone's class.
 *
 * The status slot is the page's own id, so the caller passes the node; what is shared is
 * the rule that a tone is a `bf-status--*` class and that the text is also the title (a
 * clamped line has no other way to be read).
 */
export function paintStatus(node: ClientNode, text: string, kind?: string): void {
	node.textContent = text || "";
	node.title = text || "";
	node.className = kind ? "bf-status bf-status--" + kind : "bf-status";
}

/**
 * Paint the live chip: the tone's class, the state's word, and its tooltip.
 *
 * What a state *says* is the page's voice — `live · 3m`, `connecting…`, `offline` — so the
 * caller passes the word and the tooltip, and only the shape is shared. A page that starts
 * its chip hidden shows it here: a painted state is a state the page can stand behind. The
 * tooltip is left alone when the caller has none, since a page may keep a fixed one.
 */
export function paintLive(node: ClientNode, tone: string, label: string, title?: string): void {
	node.className = "bf-chip bf-live" + (tone ? " bf-chip--" + tone : "");
	node.hidden = false;
	if (title) node.title = title;
	const text = node.querySelector(".bf-live__text");
	if (text) text.textContent = label;
}

/**
 * Follow one event stream: connecting, live, reconnecting, or dead.
 *
 * A live page is one of three surfaces, and each had written its own answer to "the stream
 * errored" — one said reconnecting forever, one said offline on the first blip, and the
 * review's kept a settled state while dropping the connection. The states are the same on
 * all three, so they are decided once, here:
 *
 * - `connecting` — no stream has opened yet;
 * - `live` — it is open, which a frame proves as well as an open event;
 * - `reconnecting` — it was live and the connection went, and the browser is retrying;
 * - `dead` — it has failed `attempts` times in a row without opening, so the page it drew
 *   can no longer be trusted.
 *
 * What each state *says* is the page's: the board's word carries the frame's age, browse's
 * hover the server's own accounting, the review's its comment count and a settled state.
 * So `words` paints, and this owns the transitions and nothing else. A page with no
 * `EventSource` gets a handle that closes and paints nothing, which leaves its document as
 * the server drew it.
 */
export function liveStream(options: LiveStreamOptions): LiveStream {
	// Cast for the same reason as `el`: this project compiles without a DOM lib, so the cast
	// names the guarantee the page makes — it is a browser, and it has one.
	const Source = (globalThis as unknown as { EventSource?: new (url: string) => EventStream }).EventSource;
	const attempts = options.attempts === undefined ? 3 : options.attempts;
	const names = options.events === undefined ? [] : options.events;
	let state: LiveState = "connecting";
	let misses = 0;
	let ended = false;
	let source: EventStream | null = null;

	function paint(next: LiveState): void {
		if (ended || next === state) return;
		state = next;
		options.words(next);
	}

	function close(): void {
		ended = true;
		if (source === null) return;
		source.close();
		source = null;
	}

	/** A failed connect or reconnect attempt: one error is a blip, `attempts` of them is not. */
	function failed(): void {
		if (ended) return;
		misses = misses + 1;
		if (misses >= attempts) paint("dead");
		else if (state === "live" || state === "reconnecting") paint("reconnecting");
	}

	function arrived(event: StreamEvent): void {
		if (ended) return;
		misses = 0;
		paint("live");
		options.frame(event);
	}

	try {
		source = Source === undefined ? null : new Source(options.url);
	} catch {
		// A URL the page cannot open is not a stream that may come back.
		paint("dead");
		return { close: close };
	}
	if (source === null) return { close: close };
	const stream = source;
	stream.onopen = function () {
		if (ended) return;
		misses = 0;
		paint("live");
	};
	stream.onerror = failed;
	stream.onmessage = arrived;
	for (const name of names) stream.addEventListener(name, arrived);
	return { close: close };
}

/** One answer from the server: whether it accepted, its status, and its parsed body. */
interface PostResult {
	ok: boolean;
	status: number;
	body: unknown;
}

/**
 * POST JSON and read the reply's body, whatever the status.
 *
 * A page that only honoured the happy path would report `server returned 409` where the
 * server had said *why*, so the body is parsed on both branches and the caller decides.
 */
export function postJson(url: string, payload: unknown): Promise<PostResult> {
	return fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload),
	}).then((response: { ok: boolean; status: number; json(): Promise<unknown> }) =>
		response.json().then(
			(body: unknown): PostResult => ({ ok: response.ok, status: response.status, body }),
			(): PostResult => ({ ok: response.ok, status: response.status, body: null }),
		),
	);
}

/**
 * The prefix this page was served under, as the server wrote it on `<html data-base>`.
 *
 * A session serves several pages on one origin, so a bundle cannot assume it owns the
 * root: `""` at the origin's root, `/files` under a mount. The attribute is read every
 * time rather than cached at load, because a fragment runs in whatever order the bundle
 * lists it and none of them may depend on another having run first.
 */
export function pageBase(): string {
	// Cast for the same reason as `el`: this project compiles without a DOM lib, and the
	// page guarantees a document with a root element.
	const root = (
		globalThis as unknown as { document: { documentElement: { getAttribute(name: string): string | null } } }
	).document.documentElement;
	return root.getAttribute("data-base") ?? "";
}

/**
 * {@link pageBase} on its own, for a bundle to splice at its **outermost** scope.
 *
 * A page's bundle is a stack of fragments, and a fragment's helper is only visible to the
 * ones nested inside it — so this one goes where every fragment can reach it, which is not
 * where the rest of the runtime goes.
 */
export const CLIENT_BASE_JS = String(pageBase);

/**
 * The runtime, as a bundle receives it: the six bodies, in the order a client reads them.
 *
 * `test` holds each to its module body and proves the string is safe to splice.
 */
export const CLIENT_RUNTIME_JS = [el, typing, paintStatus, paintLive, postJson, liveStream].map(String).join("\n\n");
