/**
 * Optional JS rendering via the `playwright` package.
 *
 * Pages that build their content client-side need a browser. `playwright` is
 * loaded lazily and only when rendering is enabled, so the extension stays
 * dependency-free otherwise. Tests inject a renderer through
 * `setRendererForTests`.
 *
 * The browser has its own network stack, so it can bypass the transport SSRF
 * guard. A best-effort `page.route` interceptor aborts obvious internal targets
 * (blocked hostnames and IP literals); DNS-based subresource access remains a
 * residual risk.
 */

import { isIP } from "node:net";
import { isBlockedHostname, isBlockedIp } from "./ssrf.ts";

/** Raised when the optional `playwright` package is missing or unusable. */
export class RenderUnavailableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RenderUnavailableError";
	}
}

export interface RenderOptions {
	timeoutMs: number;
	waitUntil: "load" | "networkidle";
	executablePath: string;
	signal: AbortSignal | undefined;
}

export type Renderer = (url: string, options: RenderOptions) => Promise<{ html: string }>;

/** Minimal shapes for the subset of the Playwright API used here (types are not installed). */
interface PwRoute {
	request(): { url(): string };
	abort(): unknown;
	continue(): unknown;
}
interface PwPage {
	route(pattern: string, handler: (route: PwRoute) => unknown): Promise<unknown>;
	goto(url: string, options: { waitUntil: "load" | "networkidle"; timeout: number }): Promise<unknown>;
	content(): Promise<string>;
}
interface PwBrowser {
	newContext(): Promise<{ newPage(): Promise<PwPage> }>;
	close(): Promise<void>;
}
interface PwChromium {
	launch(options: { headless: boolean; executablePath?: string }): Promise<PwBrowser>;
}

let rendererOverride: Renderer | undefined;

/** Override the JS renderer (tests only). Pass undefined to clear. */
export function setRendererForTests(renderer: Renderer | undefined): void {
	rendererOverride = renderer;
}

/** True for a URL the browser should not load: non-http(s), internal hostnames, or blocked IPs. */
export function isBlockedRenderTarget(raw: string): boolean {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return true;
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") return true;
	const hostname = url.hostname.replace(/^\[|\]$/g, "");
	if (isIP(hostname)) return isBlockedIp(hostname);
	return isBlockedHostname(hostname);
}

/** Render `url` to HTML. Throws `RenderUnavailableError` when playwright is absent. */
export async function renderPage(url: string, options: RenderOptions): Promise<{ html: string }> {
	if (rendererOverride) return rendererOverride(url, options);

	let module: Record<string, unknown>;
	try {
		// A variable specifier keeps `tsc` from resolving the optional package's types.
		const name = "playwright";
		module = (await import(name)) as Record<string, unknown>;
	} catch {
		throw new RenderUnavailableError(
			"JS rendering requires the optional 'playwright' package (npm i playwright && npx playwright install chromium).",
		);
	}

	const chromium = (module.chromium ?? (module.default as Record<string, unknown> | undefined)?.chromium) as
		| PwChromium
		| undefined;
	if (!chromium || typeof chromium.launch !== "function") {
		throw new RenderUnavailableError("The installed 'playwright' package does not export chromium.launch.");
	}

	const browser = await chromium.launch({
		headless: true,
		executablePath: options.executablePath || undefined,
	});
	const onAbort = () => {
		void browser.close().catch(() => {});
	};
	options.signal?.addEventListener("abort", onAbort, { once: true });

	try {
		const context = await browser.newContext();
		const page = await context.newPage();
		await page.route("**", (route) =>
			isBlockedRenderTarget(route.request().url()) ? route.abort() : route.continue(),
		);
		await page.goto(url, { waitUntil: options.waitUntil, timeout: options.timeoutMs });
		return { html: await page.content() };
	} finally {
		options.signal?.removeEventListener("abort", onAbort);
		await browser.close().catch(() => {});
	}
}
