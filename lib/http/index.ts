/**
 * The served-page kit: the loopback HTTP layer `file-browse`, `plan`, and `board`
 * answer on — the response shape, the header policy, the request-envelope
 * helpers and the guards built on them, the one server entry, the socket seam
 * behind it, and the port band it draws from.
 *
 * Import from here rather than a leaf module, so the layer reads as one kit. This
 * barrel is deliberately *not* on a registration path: it is 978 lines that only
 * a page that is actually served needs, so an extension reaches it from the
 * handler that mounts one, never from its factory. The one exception is the
 * mount contract itself — {@link requestMount} and {@link HTTP_MOUNT_CHANNEL},
 * which live in `./mount.ts` — because asking for a prefix is what a command does
 * before any page exists. `board` and `plan` import that leaf directly; `serve`
 * imports it for the channel and loads this barrel on the first bind; a new
 * `lib/http/` leaf imported from a factory puts the whole kit back on every start,
 * which `test/dependencies.test.ts` fails.
 *
 * Value-only, like the rest of `lib/`: the only state is what a returned closure
 * carries (`createCloser`, `serveHttp`).
 */

export * from "./guard.ts";
export * from "./headers.ts";
export * from "./mount.ts";
export * from "./port.ts";
export * from "./response.ts";
export * from "./router.ts";
export * from "./serve.ts";
export * from "./sink.ts";
export * from "./token.ts";
