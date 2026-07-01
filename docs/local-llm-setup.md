# Local LLM Setup

SiteIntent can now run its local scoring flow without `OPENAI_API_KEY`.

## Installed on this machine

- `LM Studio.app` at `/Applications/LM Studio.app`
- `llama3.1:8b` in `Ollama`
- existing fallback model: `qwen2.5:14b`

## Local provider behavior

When `SITEINTENT_AI_PROVIDER=local`, the app now does this for scoring:

1. crawls and stores the website snapshot
2. runs local page analysis with `Ollama`
3. collects live web search evidence with the built-in DuckDuckGo HTML search adapter
4. feeds the stored snapshot plus search evidence into the local model for:
   - discoverability scoring
   - rankability scoring
   - competitor validation

This mirrors the hosted pattern more closely than the old OpenAI-only `web_search` dependency because the search step is now explicit in app code.

## Suggested env

```bash
SITEINTENT_AI_PROVIDER=local
OLLAMA_MODEL=llama3.1:8b
SITEINTENT_PAGE_ANALYSIS_LOCAL_MODEL=llama3.1:8b
SITEINTENT_DISCOVERABILITY_LOCAL_MODEL=llama3.1:8b
SITEINTENT_RANKABILITY_LOCAL_MODEL=llama3.1:8b
SITEINTENT_COMPETITOR_VALIDATION_LOCAL_MODEL=llama3.1:8b
```

## Notes

- If `SITEINTENT_AI_PROVIDER` is unset, the app now defaults to `local`.
- Set `SITEINTENT_AI_PROVIDER=openai` only when you explicitly want the hosted OpenAI scoring path.
- The local search adapter currently uses DuckDuckGo's HTML results with Australia region bias (`au-en`).
- `llama3.1:8b` is the default fast Llama-family model.
- `qwen2.5:14b` remains available as a stronger fallback if the requested Llama model is unavailable.
