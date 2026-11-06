---
title: Consistent empty results and structured sources
type: change
authors:
  - mavam
created: 2026-11-06T08:55:38.837375Z
---

Answers and research reports now list their cited sources in a structured
`sources` array. Each source has a `url`, a `title`, or both. The `text` field
holds only the provider's answer or report; the `Sources:` list in text output
is now added by webfox. JSON consumers that parsed sources out of `text` should
read `sources` instead. `itemCount` remains and counts these sources.

Empty results now work the same for every provider. When a provider responds
successfully with an empty answer, report, or page, the result succeeds instead
of failing, and text output shows `No answer returned.`, `No report returned.`,
or `No content returned.` instead of provider-specific messages. A URL that a
provider leaves out of its response entirely still fails, now with a consistent
message.

Search results without a title now omit `title` instead of repeating the URL or
showing `Untitled`, and text output labels them by their URL. Gemini answers now
list all grounding sources instead of the first five.

Custom provider commands can return `sources` with answers and research
reports, may omit search result titles, and may return pages without content.
Custom commands' `itemCount` output is no longer used; webfox counts `sources`
instead.
