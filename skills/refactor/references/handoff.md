# After a candidate is chosen

The audit is over; this is execution, and its only promise is that behavior does not
change. These are the rules that keep that promise — the rest is ordinary work.

## Before the first edit

- **State the behaviour contract.** One paragraph: what must stay true, which callers
  rely on it, and which parts are explicitly free to change. If the contract is
  ambiguous, ask now rather than discovering it in the diff.
- **Record a baseline.** Run the project's documented check and keep the result. A
  pre-existing failure is not this refactor's to fix, and a refactor that turns one
  test from red to green has changed something nobody asked about.
- **Add characterisation tests first when the behaviour is untested.** They capture
  what the code does today, including the parts you consider wrong, because that is
  the only net under a structural change.

## While it moves

- **One structural change per step**, each with its own verification. A rename, an
  extraction, and a move are three steps, not one; a step that cannot be verified on
  its own is too large.
- **Never mix in** formatting, a bug fix, a dependency bump, or unrelated cleanup. If
  the new structure makes one of those obvious, finish, report it, and do it as its
  own change.
- **Ceremony by size**: plan mode for a change that spans files, touches a public
  surface, or has a step list you cannot write down up front; a todo list for the rest.
- **Stop if it turns into a behaviour change.** Say so, and treat it as the design
  change it now is, rather than smuggling it through under the old name.

## Finishing

- Run the full check, not only the narrow command, and compare against the baseline.
- Report the diff's shape, what the check said, and what is still risky or unverified.
- Do not commit unless the user asks.
