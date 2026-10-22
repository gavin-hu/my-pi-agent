---
name: parallel-dev
description: "Coordinate parallel development across independent Pi sessions by partitioning work into contract-bound workstreams: establish a walking skeleton, name one integrator and one owner per workstream, claim paths, evolve the contract, integrate continuously, and verify independently. Use when splitting a feature across multiple sessions or agents; not for ordinary single-session edits or work with no stable boundary."
---

# Parallel development

This is a coordination protocol, not a spawning tool. Read the project's
instructions first; they win. It coordinates sessions the user starts (or
explicitly created subagents); it does not create sessions or run work by itself.

It relies on the `session` tool from `session-bus` for status, inbox, events, and
path claims. If that tool is absent or disabled, stop and use a manual contract
and ownership note; do not invent bus commands.

## 1. Decide whether parallel is warranted

Parallel work costs coordination. Use it only when all of these hold:

- at least two workstreams can deliver independent outcomes;
- their owned paths are disjoint enough to merge without daily conflict;
- a contract or walking skeleton can stabilize the boundary;
- one session can be accountable for integration;
- someone other than the implementer can verify the result.

Do not split only by layer (UI / backend / tests). That maximizes handoffs and
late integration. Prefer vertical outcome slices, a contract/foundation
workstream with implementers, or independent modules/migrations with explicit
interfaces. A layer split is acceptable only when the layer boundary is the
contract and every layer has its own acceptance test.

If the change is small or tightly coupled, do it serially and say why.

## 2. Start from a walking skeleton

The contract is not frozen up front; it is the smallest stable interface,
validated by tests and evolved deliberately.

- If the boundary is uncertain, build one thin end-to-end path or run a timeboxed
  spike first. That exposes the real interface before other sessions depend on it.
- Write the contract (schema, shared types/messages, event or file protocol,
  migration boundary) at v1, with contract tests.
- Evolve it with versioned, backward-compatible changes. For a breaking change,
  use expand/contract: add the new shape, migrate consumers, remove the old one.
- Do not require a complete design before the first line of code. A contract that
  is never exercised is a guess.

## 3. Partition into workstreams

For each workstream record:

- a neutral **workstream id** named by outcome (`billing-core`, `billing-report`,
  `billing-migration`), not by technology role;
- one owner session;
- owned paths;
- contract dependency;
- acceptance test;
- merge point and dependency edges.

Build a dependency graph with no cycles: contract/foundation first, independent
workstreams overlapping, integration and verification last. If two workstreams
need the same path, the split is wrong; combine or serialize them.

Shared files (`package.json`, lockfile, shared types, migrations, generated
clients) belong to the integrator's protocol. An owner proposes a small change;
the integrator accounts for it. The integrator is not the sole author of every
shared file.

## 4. Name the team

Use session labels as workstream ids, or for the two responsibilities:

- `integrator` — accountable for the contract, shared-file decisions, merge
  order, and the integrated check.
- `<workstream>` — one owner per workstream, responsible for its paths, tests,
  and completion report.
- `verify-<name>` — optional independent verifier, read-only.

Do not label sessions `frontend`, `backend`, or `tester`; those are not a model.
One session may hold two responsibilities in a small change, but an implementer
cannot be the independent verifier. Claim paths before editing; claims are
advisory signals, not locks. Git conflicts and path ownership still decide.

## 5. Run continuously

- Use one short-lived branch/worktree per workstream. Rebase or merge the shared
  baseline frequently; land small increments. A long-lived branch waiting for a
  final integration is the failure mode this model must avoid.
- Hide incomplete user-visible work behind a feature flag rather than keeping it
  out of the baseline for days.
- Claim a path, work, test at the workstream boundary, and release the claim when
  the work merges.
- A contract change is an `interface-changed` event, a version bump, updated
  contract tests, and a pause for dependent work until it acknowledges the new
  version.
- Pull the inbox at setup, after a contract change, before a merge, and when
  blocked. The bus never wakes a session; a pull-based bus with no pull is not
  coordination.

Use `event` for a broadcast contract/build/test change, `ask` for a decision, and
`handoff` for a structured summary. Keep messages short. Never send secrets, full
transcripts, or another workstream's context.

## 6. Integrate and verify

- The integrator runs the merge queue in dependency order, resolves shared-file
  conflicts once, and keeps the baseline green. Owners may land their own small,
  reviewed increments; accountability is not a tollbooth for every line.
- Every increment runs contract tests, its workstream tests, and the project's
  full check on the integrated baseline. A workstream's “done” is a claim; CI and
  acceptance tests are proof.
- The verifier checks the integrated behavior against acceptance tests and the
  contract, reports exact failures, and never approves work it implemented.
- Release claims after merge. The integrated branch is the source of truth.

## 7. Definition of done

- The contract version matches the implementation, and contract tests pass.
- Every workstream has an owner, acceptance test, and released claims.
- The full check passes on the integrated baseline; no agent self-report is
  accepted in place of it.
- Docs, changelog, and plan/todo steps are updated by the responsible session.
- Incomplete work is behind a flag or explicitly out of scope; rollback is known.

## 8. Anti-patterns and stop conditions

Stop and ask when:

- there is no stable contract or no integrator;
- two workstreams need one path;
- the bus is unavailable, or nobody will check the inbox;
- the change is small enough to do serially;
- the dependency graph has a cycle.

The anti-patterns this skill exists to prevent:

- **Contract freeze**: a complete design before any working path.
- **Layer-only split**: UI / backend / tests as the default partition.
- **Big-bang integration**: branches first meeting at the end.
- **Claims as locks**: believing a claim prevents conflicts.
- **Verifier as the only QA**: owners do not own their tests.
- **Full-context sharing**: dumping transcripts instead of a contract/event.

## Example

A billing change can be split into `billing-core`, `billing-report`, and
`billing-migration`, with `integrator` and `verify-billing`:

```text
/sessions name integrator
/sessions name billing-core
/sessions name billing-report
/sessions name verify-billing

session({action:"status"})
session({action:"claim", paths:["src/billing/core"]})
session({action:"send", to:"*", kind:"event", text:"contract billing-events v2: refunded_at added"})
session({action:"inbox"})
```

The contract test is the first shared artifact. Each owner rebases on the
baseline, lands small increments, and releases its claim after merge; the
verifier checks the integrated behavior, not the owners' self-reports.
