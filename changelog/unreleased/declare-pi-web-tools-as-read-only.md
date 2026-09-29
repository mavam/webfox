---
title: Declare Pi web tools as read-only
type: change
authors:
  - mavam
created: 2026-09-29T17:57:07.53985Z
---

The `web_search`, `web_contents`, `web_answer`, and `web_research` Pi tools now declare themselves as read-only calls that reach the open web. Extensions that gate tool calls, such as permission prompts, can use these hints to decide what needs confirmation. Partial failures are also reported through the tool result itself, so they show as tool errors without a separate event handler. This requires Pi 0.99 or later.
