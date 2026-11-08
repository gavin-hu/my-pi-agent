# Search and read the web

Two tools let the model look things up while it works: `web_search` for a
question, and `web_fetch` for one page. Neither needs a key, an account, or an
API token to start.

You need Pi and this package installed — see [Install](../install.md).

## You ask, it fetches

There is no command for either tool — say what you want and the model decides
which one to use:

```text
What changed in the latest Pi release? Check the changelog.
```

The model searches, opens the page that matters, and answers from its text. You
see each call in the transcript with its result folded under it. What you should
see is the answer itself: the release notes quoted, a date named, a version —
not a list of links to read yourself.

## Read one page on purpose

Name the URL and the model fetches it rather than searching:

```text
Fetch https://pi.dev/ and tell me the install command.
```

What comes back is readable text, not HTML: links stay as links, an image keeps
its alt text, and a table row reads as `cell | cell`.

## Ask for just the part you need

A long page does not have to arrive whole — ask for the section:

```text
Fetch the configuration page and find the keys for the page cache.
```

The result holds the matching passages with a little context around each, and
says when a cap hid the rest — so "not found" and "not shown" are different
answers.

## Long pages, and pages that changed

A page too big for one result arrives in slices; the model continues from the
offset the result named. A page you already fetched comes from a short cache
within the session, and asking again with `refresh` gets the network copy.

## When search results are thin

The default provider is keyless: it returns a direct answer and related topics,
which is enough for "what is X" and not for "list every release". Two providers
give a full result list, and both are one setting:

- a self-hosted **SearXNG** instance (`search.endpoint`);
- **Brave** search (`search.apiKeyEnv` names an environment variable holding the
  key).

[Configuration](../configuration.md#web-access--search-and-fetch) lists the keys.

## Treat what it reads as data

Fetched text is whatever the page said — including text written to look like an
instruction. The models are told to treat it as data rather than instructions,
but the habit is worth keeping on your side too: if a page tells the agent to do
something, ask why it should.

## Where to go next

- [`web-access`](../extensions/web-access.md) — both tools, their parameters, and
  every setting.
- [Security](../security.md) — private addresses, redirects, and what is refused.
