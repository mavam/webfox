Webfox now supports Sofya as a search provider, contributed by @yusufgurdogan. Answer and research output now handle empty results consistently and include structured sources.

## 🚀 Features

### Sofya provider

You can now use a Sofya API key for search, page contents, answers, and research through the existing CLI, TypeScript library, and Pi tools. Set `SOFYA_API_KEY` or configure `providers.sofya.credentials.api`, then select it:

```sh
web search "Node.js release notes" --provider sofya --freshness month
web config default search sofya
```

Sofya searches can filter by topic, freshness, and domain. No defaults change unless you select Sofya.

*By @yusufgurdogan.*

## 🔧 Changes

### Consistent empty results and structured sources

Answers and research reports now list their cited sources in a structured `sources` array. Each source has a `url`, a `title`, or both. The `text` field holds only the provider's answer or report; the `Sources:` list in text output is now added by webfox. JSON consumers that parsed sources out of `text` should read `sources` instead. `itemCount` remains and counts these sources.

Empty results now work the same for every provider. When a provider responds successfully with an empty answer, report, or page, the result succeeds instead of failing, and text output shows `No answer returned.`, `No report returned.`, or `No content returned.` instead of provider-specific messages. A URL that a provider leaves out of its response entirely still fails, now with a consistent message.

Search results without a title now omit `title` instead of repeating the URL or showing `Untitled`, and text output labels them by their URL. Gemini answers now list all grounding sources instead of the first five.

Custom provider commands can return `sources` with answers and research reports, may omit search result titles, and may return pages without content. Custom commands' `itemCount` output is no longer used; webfox counts `sources` instead.

*By @mavam.*
