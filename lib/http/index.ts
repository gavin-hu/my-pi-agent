/**
 * The loopback HTTP layer shared by `file-browse`, `plan`, and `board`: the
 * response shape, the header policy, the request-envelope helpers and the
 * guards built on them, the one server entry, and the socket seam behind it.
 *
 * Import from here rather than a leaf module, so the layer reads as one kit. An
 * extension imports {@link serveLoopback} and never `./server.ts`: a hand-built
 * `node:http` server beside this one is how the close path and the idle grace
 * start to differ again. The same rule covers the guards: `plan` and `board` both
 * serve a page that can write, so the `Host`, origin, and JSON rules are
 * {@link envelopeRefusal} and {@link requireJsonBody} rather than two copies, and
 * the credential a page carries is {@link mintToken} / {@link tokenMatches}.
 *
 * Value-only, like the rest of `lib/`: the only state is what a returned closure
 * carries (`createCloser`, `serveLoopback`).
 */

export * from "./guard.ts";
export * from "./headers.ts";
export * from "./port.ts";
export * from "./response.ts";
export * from "./router.ts";
export * from "./serve.ts";
export * from "./sink.ts";
export * from "./token.ts";
