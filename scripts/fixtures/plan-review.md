# Plan: cache the price table between runs

## Goal

Stop paying a provider round trip on every start: keep the last good price table
on disk, serve it for a day, and fall back to the bundled rates when the network
or the provider is down.

## Context

The footer prices a run from a table the process fetches at startup. A cold start
therefore waits on the network before it can draw, and an offline start shows
every model unpriced even when the table has not changed in weeks.

The table is small (under 40 KB), versioned by the provider, and replaced
wholesale rather than patched, so a cache is one file and one timestamp.

## Approach

- Write the fetched table to `<agentDir>/prices.json` with the fetch time.
- Read it before the network call; serve it when it is younger than a day.
- Fetch in the background when it is stale and keep serving the cached copy.
- Fall back to the bundled rates when there is no cache and no network.
> [!REVIEW] Age the cache by the provider's updatedAt field rather than the fetch time, so an unchanged table is not refetched daily.

## Steps

- [x] Add a `PriceCache` module that reads and writes one JSON file
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

## Verification

`bun test` covers the miss, fresh, stale, and corrupt-cache paths, and `doctor`
prints the table's age and the file it read. With the network off, a fresh cache
still prices every model it priced before.
