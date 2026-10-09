Webfox now identifies its requests to the public Perplexity API with a dedicated integration header. Custom endpoints retain their existing SDK attribution, and caller-supplied attribution remains unchanged.

## 🔧 Changes

### Identify webfox to the Perplexity API

Requests from the Perplexity provider to `api.perplexity.ai` now include an `X-Pplx-Integration: webfox` header so Perplexity can attribute API traffic to webfox. Custom base URLs and a caller-supplied `X-Pplx-Integration` in `PERPLEXITY_CUSTOM_HEADERS` are left unchanged.

*By @qirh.*
