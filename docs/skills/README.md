# Skills

Three packaged workflows. Each skill is one `SKILL.md` under `skills/` whose
`name` and `description` are advertised to the model; the instructions behind them
load only when a request matches, so a skill costs a sentence of context until it
is used. `/skill:<name>` forces one, which is also the only way to start a skill
that declares `disable-model-invocation`.

- [`init`](./init.md) — create or refresh the project's agent instructions through
  an interview and a plan you approve.
- [`next`](./next.md) — suggest what to do next from this conversation, or from the
  tree when the conversation is empty.
- [`refactor`](./refactor.md) — audit for duplication, oversized modules, coupling,
  and drift, then carry the refactor you pick.

Discovery is read-only in both of the auditing skills: they report and ask, and
nothing is edited, committed, or started before you pick an item.

[`/bytefly`](../extensions/bytefly.md) lists every packaged skill with a checkbox:
switching one off removes it from the model's roster and from `/skill:<name>` for
the next session.
