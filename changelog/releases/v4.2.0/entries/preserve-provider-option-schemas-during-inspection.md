---
title: Preserve provider option schemas during inspection
type: bugfix
authors:
  - andrew-kurin
created: 2026-09-08T02:37:30.715356Z
---

Provider option schemas now remain separate from credential redaction. Previously, fields such as Brave maximum_number_of_tokens were replaced with [redacted], which made Pi tool schemas invalid and caused Codex requests to fail. Configured default values still pass through credential redaction.
