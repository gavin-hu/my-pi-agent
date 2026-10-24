/**
 * The channel contract appended to every WeChat peer session's system prompt.
 *
 * The reader is on a phone, not at this machine, and the model otherwise
 * answers the way it would in a terminal: wide tables and long code fences that
 * `toWechatText` has to flatten, and instructions the reader cannot carry out
 * ("run `bun test`", "see `src/foo.ts`"). This text names the medium once, in the
 * system prompt, so it is static per session and prompt-cache friendly.
 *
 * It deliberately says nothing about individual tools: their own descriptions
 * and guidelines already cover how to use them, and the repository budget rule
 * is one channel, one job. It also states no length cap — the reply pipeline
 * already splits long answers — and no per-peer facts, which would make the
 * text dynamic for no benefit.
 */

/** The phone-chat contract appended to a peer session's system prompt. */
export const WECHAT_CHANNEL_PROMPT = `## This conversation is on WeChat

The reader is on a phone, not at the terminal.
- Answer in their language: conclusion first, then a few short points; prefer a
  list over a wide table and keep code to the key lines.
- They cannot see the terminal, tool output, files, or this machine: quote what
  matters, skip absolute paths and ids, and never ask them to run a command.
- When a decision is needed, give the options and your recommendation.
- If you attach a file or plan, summarize it in the message; never rely on the
  attachment being opened.
- Ask one question at a time. Project instructions still apply: change the
  presentation, not the rigor.`;
