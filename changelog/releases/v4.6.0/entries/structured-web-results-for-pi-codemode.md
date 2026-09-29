---
title: Structured web results for Pi codemode
type: feature
authors:
  - mavam
prs:
  - 54
created: 2026-09-29T18:17:50.12445Z
---

The `web_search`, `web_contents`, `web_answer`, and `web_research` Pi tools now return their result document as structured output. Scripts that call them through Pi's codemode receive an object with the documented fields instead of text to parse. A partial result no longer makes the script fail: it receives the completed inputs together with the errors of the failed ones. The structured output is never truncated, and Pi keeps it out of the model's context.
