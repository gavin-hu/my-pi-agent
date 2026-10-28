# Plan: cache the price table between runs

## Goal

Stop paying a provider round trip on every start: keep the last good price table
on disk, serve it for a day, and fall back to the bundled rates when the network
or the provider is down.

## Context

- The footer prices a run from a table the process fetches at startup, so a cold
  start waits on the network before it can draw.
- The table is under 40 KB, versioned by the provider, and replaced wholesale
  rather than patched, so a cache is one file and one timestamp.

## Approach

- Write the fetched table to `<agent-dir>/prices.json` with the provider's
  `updatedAt` and the fetch time.
- Read it before the network call; serve it when it is younger than a day.
- Fetch in the background when it is stale and keep serving the cached copy.
- Rejected: patching rows into the cached table, because the provider replaces
  the whole table and a merge would invent rates that were never published.
> [!REVIEW] Age the cache by the provider's updatedAt field rather than the fetch time, so an unchanged table is not refetched daily.

## Visual

What `doctor` reports once the cache exists:

```bash
$ pi doctor
prices   cached 2h ago   /Users/u/.pi/prices.json   1,204 models
```

## Steps

- [x] Add a `PriceCache` module that reads and writes one JSON file
  - `lib/env.ts` already resolves `<agent-dir>`, so the module takes that path.
- [x] Stamp the fetch time next to the table
- [x] Serve the cache when it is fresh
- [x] Keep the bundled rates as the last fallback
- [ ] Refresh in the background when the cache is stale
- [ ] Surface the table's age in `doctor`
- [ ] Cover the offline and stale paths in the tests
- [ ] Document the file under `Configuration`

## Risks

- A cache written by an older version could lack a field the new one needs, so
  the parser must treat a missing field as a miss, not as a default.
- A clock that jumps backwards makes the cache look fresh forever; age it by the
  timestamp inside the file rather than by the file's mtime.
> [!REVIEW] The stale refresh has to be cancellable, or a slow provider keeps the process alive after the reply is already on screen.
> [!REVIEW] @priya: A cache written by an unknown version should be discarded outright; treating it as a miss leaves a half-parsed table on disk for the next start.

## Verification

```bash
bun test lib/price-cache.test.ts
bun run check
```
