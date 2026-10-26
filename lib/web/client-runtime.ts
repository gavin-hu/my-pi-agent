/**
 * The browser runtime both page clients splice into their bundles: the element builder,
 * the "is the user typing?" test, the status line, and the JSON POST.
 *
 * Two surfaces had written each of these for themselves, and because a bundle is a
 * template literal no type checker and no AST scan ever compared them: the plan's
 * `el(tag, className)` and the board's `el(tag, className, text)` were two builders, and
 * the plan's `typing` compared `INPUT` where the board's lowercased the tag. Both are
 * now one body, written here as real TypeScript, and each client carries the *source*
 * (`CLIENT_RUNTIME_JS`) the same way it carries `plural` and the class table.
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
 * The runtime, as a bundle receives it: four bodies, in the order a client reads them.
 *
 * `test` holds each to its module body and proves the string is safe to splice.
 */
export const CLIENT_RUNTIME_JS = [el, typing, paintStatus, postJson].map(String).join("\n\n");
