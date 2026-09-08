This release removes unnecessary JSON escape backslashes from quoted tool input rows while preserving safe control-character escaping.

## 🐞 Bug fixes

### Readable quotes in tool input rows

Tool input rows now display quotation marks directly instead of prefixing them with JSON escape backslashes. Quoted search terms and other inputs are easier to read while control characters remain safely escaped.

*By @mavam.*
