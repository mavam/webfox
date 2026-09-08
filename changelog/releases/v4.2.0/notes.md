Webfox now keeps Pi usable when configuration is invalid while preserving provider option schemas for reliable tool requests. It also publishes a stable configuration schema URL so editors can track the latest release automatically.

## 🔧 Changes

### Stable configuration schema URLs

Configuration schema URLs now follow the latest published release, so examples no longer need URL updates after every release:

```yaml
$schema: https://unpkg.com/webfox@latest/dist/config.schema.json
```

Editor validation follows the latest schema even when an older Webfox version is installed. Replace `latest` with an exact version if you need validation pinned to that release.

*By @mavam in #41.*

## 🐞 Bug fixes

### Non-blocking Pi startup with invalid configuration

Invalid Webfox configuration no longer interrupts Pi startup. The extension reports the configuration error and registers no web tools, leaving Pi available to use. In print and JSON modes, the diagnostic goes to stderr. After fixing the configuration, restart Pi or run `/reload` to load the extension again.

*By @mavam in #42.*

### Preserve provider option schemas during inspection

Provider option schemas now remain separate from credential redaction. Previously, fields such as Brave maximum_number_of_tokens were replaced with [redacted], which made Pi tool schemas invalid and caused Codex requests to fail. Configured default values still pass through credential redaction.

*By @andrew-kurin.*
