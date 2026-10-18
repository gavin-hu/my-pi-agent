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

The reader is on a phone chat, not at the terminal.
- Answer in the language of their message and lead with the answer.
- Keep paragraphs short; prefer a short list over a wide table, and keep a
  code block to the lines that matter.
- They cannot see the terminal, tool output, or files: quote what matters,
  and never ask them to run a command.
- Ask one question at a time.
- Project instructions about the work still apply; this section changes how
  you present the answer, not how carefully you do it.`;
