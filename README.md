# SiteIntent

SiteIntent is a Next.js app that scans a website, works out what category the site appears to be in, measures whether AI systems are likely to discover it, and then scores how strong the site looks once AI has found it.

The app now runs as a hosted Cloudflare dashboard backed by model-native web search. Production no longer uses Ollama, Groq-style remote model proxies, Playwright-based discovery, Serper, or app-managed DuckDuckGo scraping. Web-dependent stages run through the model providers' built-in search tools only:

- OpenAI Responses API with `web_search`
- Anthropic Messages API with Claude web search
- Gemini Interactions API with Google Search grounding

Each scan now runs three scoring passes in parallel configuration terms: one selected OpenAI model, one selected Anthropic model, and one selected Gemini model. The dashboard stores each provider result separately and also computes a temporary merged scorecard so the current UI can keep working while scoring logic evolves.

The product currently centers on three outputs:

- `Discoverability`: does AI find this site during recommendation-style searches?
- `Rankability`: if AI finds it, how strong is the case for recommending it?
- `AI Search Score`: the blended dashboard score.

```txt
AI Search Score = (Rankability x 0.4) + (Discoverability x 0.6)
```

## Cloudflare Setup

This section is the source of truth for how the hosted app works in Cloudflare. It is written so a future AI agent can understand the production setup, make safe changes, and know which files to inspect before deploying.

### Architecture

SiteIntent has two separate Cloudflare Workers:

- `siteintent-dashboard`
  - Purpose: the real authenticated app
  - Domain: `dash.aisearchauditor.com`
  - Runtime: Next.js on Cloudflare Workers via OpenNext
  - Database: Cloudflare D1 via binding `DB`
- `aisearchauditor-coming-soon`
  - Purpose: simple public holding page
  - Domains: `aisearchauditor.com`, `www.aisearchauditor.com`
  - Runtime: plain Worker script in [workers/coming-soon.ts](/Users/jarvis/Documents/GitHub/SiteIntent/workers/coming-soon.ts)

Production intentionally splits the dashboard and the public site. The dashboard lives only on `dash.aisearchauditor.com`, while the apex domain stays free for the public marketing website.

### Important Files

- [wrangler.jsonc](/Users/jarvis/Documents/GitHub/SiteIntent/wrangler.jsonc)
  - Main production Worker config for `siteintent-dashboard`
  - Declares the Worker name, custom domain, D1 binding, asset binding, and public env vars
- [wrangler-coming-soon.jsonc](/Users/jarvis/Documents/GitHub/SiteIntent/wrangler-coming-soon.jsonc)
  - Separate Worker config for the apex coming-soon page
- [open-next.config.ts](/Users/jarvis/Documents/GitHub/SiteIntent/open-next.config.ts)
  - OpenNext Cloudflare adapter config
- [next.config.ts](/Users/jarvis/Documents/GitHub/SiteIntent/next.config.ts)
  - Calls `initOpenNextCloudflareForDev()` so local dev/preview can access Cloudflare context helpers
- [migrations/0001_initial.sql](/Users/jarvis/Documents/GitHub/SiteIntent/migrations/0001_initial.sql)
  - Canonical D1 schema
- [lib/cloudflare-runtime.ts](/Users/jarvis/Documents/GitHub/SiteIntent/lib/cloudflare-runtime.ts)
  - Reads `getCloudflareContext()` and exposes the D1 binding/env
- [lib/app-state.ts](/Users/jarvis/Documents/GitHub/SiteIntent/lib/app-state.ts)
  - Storage adapter boundary used by the app
- [lib/d1-state.ts](/Users/jarvis/Documents/GitHub/SiteIntent/lib/d1-state.ts)
  - D1 implementation of app persistence
- [lib/sqlite.ts](/Users/jarvis/Documents/GitHub/SiteIntent/lib/sqlite.ts)
  - Local SQLite schema and connection for `npm run dev`
- [lib/auth.ts](/Users/jarvis/Documents/GitHub/SiteIntent/lib/auth.ts)
  - Auth implementation for both D1 and SQLite modes
- [public/_headers](/Users/jarvis/Documents/GitHub/SiteIntent/public/_headers)
  - Cache headers for `/_next/static/*` assets when deployed to Cloudflare

### Production Worker Config

Current dashboard production target:

- Worker name: `siteintent-dashboard`
- Dashboard domain: `dash.aisearchauditor.com`
- D1 database name: `siteintent-dashboard-prod`
- D1 database ID: `c8098b64-7946-469d-845f-cb930cc30ed9`
- D1 binding name in code: `DB`
- Static asset binding name in code: `ASSETS`
- Public env var: `NEXT_PUBLIC_SITE_URL=https://dash.aisearchauditor.com`

Important detail:

- The `assets` block in `wrangler.jsonc` is required.
- It points to `.open-next/assets`.
- Without it, the login page HTML may load but `/_next/static/*` files return `404`, which prevents React hydration and makes forms appear to do nothing.

### Environment And Secrets

These secrets are required in the `siteintent-dashboard` Worker:

```txt
OPENAI_API_KEY
ANTHROPIC_API_KEY
GEMINI_API_KEY
DASH_ADMIN_EMAIL
DASH_ADMIN_PASSWORD
SESSION_SECRET
```

Runtime env keys used by the app:

- `OPENAI_API_KEY`
  - Required for OpenAI-backed page analysis and OpenAI scoring passes
- `ANTHROPIC_API_KEY`
  - Required for Anthropic scoring passes
- `GEMINI_API_KEY`
  - Required for Gemini scoring passes
- `DASH_ADMIN_EMAIL`
  - Bootstrap admin email
- `DASH_ADMIN_PASSWORD`
  - Bootstrap admin password
- `SESSION_SECRET`
  - HMAC secret used to sign the session cookie
- `SITEINTENT_WORKER_MODEL`
  - Optional hosted model override for page analysis fallback
- `SITEINTENT_PAGE_ANALYSIS_MODEL`
  - Optional hosted model override for page analysis
- `SITEINTENT_DISCOVERABILITY_MODEL`
  - Optional default OpenAI model for discoverability when a scan does not send an explicit model selection
- `SITEINTENT_RANKABILITY_MODEL`
  - Optional default OpenAI model for rankability when a scan does not send an explicit model selection
- `SITEINTENT_ANTHROPIC_MODEL`
  - Optional default Anthropic scan model
- `SITEINTENT_GEMINI_MODEL`
  - Optional default Gemini scan model
- `SITEINTENT_COMPETITOR_VALIDATION_MODEL`
  - Optional hosted model override for competitor validation

Current selectable scan model IDs are exposed by `GET /api/local-models`. That endpoint now returns provider-specific dropdown options for OpenAI, Anthropic, and Gemini so the hosted settings page can persist one model choice per provider.

Local preview secrets live in `.dev.vars`, using [.dev.vars.example](/Users/jarvis/Documents/GitHub/SiteIntent/.dev.vars.example) as the template.

### Database Model

Cloudflare production uses D1 as the source of truth. Local `npm run dev` uses SQLite through `better-sqlite3`. The schemas are intentionally kept aligned.

Tables in D1 and SQLite:

- `app_session`
  - Legacy single-row JSON state table
  - Present for compatibility but not the main persistence layer now
- `users`
  - Columns: `id`, `email`, `display_name`, `password_hash`, `password_salt`, `created_at`
  - Stores dashboard users
  - Current product assumption is one bootstrap admin user, not self-signup
- `user_sessions`
  - Columns: `id`, `user_id`, `token_hash`, `expires_at`, `created_at`
  - Stores session records
  - `token_hash` is unique and indexed
  - The raw cookie token is never stored in the database
- `app_ui_state`
  - Columns: `id`, `active_project_id`, `preferences_json`, `scan_progress_json`
  - Stores global UI state and preferences
  - Row shape assumes a single logical app workspace row with `id = 1`
- `projects`
  - Columns: `id`, `sort_order`, `data_json`
  - Stores project records as serialized JSON
- `target_intent_models`
  - Columns: `project_id`, `data_json`
  - Stores the target intent model for each project
- `project_onboarding`
  - Columns: `project_id`, `data_json`
  - Stores onboarding status and derived state for each project
- `scan_runs`
  - Columns: `id`, `project_id`, `sort_order`, `started_at`, `completed_at`, `data_json`
  - Stores metadata for each scan run
  - Indexed on `project_id`
  - `data_json` now includes:
    - the selected model per provider
    - the merged rankability/discoverability scorecards used by the dashboard
    - per-provider raw scorecards and errors for OpenAI, Anthropic, and Gemini
- `scan_pages`
  - Columns: `scan_id`, `page_index`, `data_json`
  - Stores the page-level payloads for a scan
  - Primary key is `(scan_id, page_index)`

How persistence works:

- The route/API layer should call [lib/app-state.ts](/Users/jarvis/Documents/GitHub/SiteIntent/lib/app-state.ts), not D1 or SQLite directly.
- `loadAppState()` chooses D1 when `DB` exists, otherwise SQLite.
- `saveAppState()` rewrites the logical app state into structured rows.
- Scan progress and scan snapshots have dedicated helper functions so long-running scans can update incrementally.

### Auth Model

Auth is implemented in [lib/auth.ts](/Users/jarvis/Documents/GitHub/SiteIntent/lib/auth.ts).

Behavior:

- Login happens through `POST /api/auth/login`
- Logout happens through `POST /api/auth/logout`
- Session inspection happens through `GET /api/auth/session`
- Protected state loading happens through `GET /api/state`

Security model:

- Password hashes use PBKDF2 via Web Crypto so the same implementation works in Workers
- Per-user salts are stored in `users.password_salt`
- Session cookies are:
  - HTTP-only
  - `SameSite=Lax`
  - `Secure` in production / Cloudflare
- The cookie value contains a signed token
- The database stores only a SHA-256 hash of the raw token

Bootstrap behavior:

- On first sign-in, if `users` is empty, the app auto-creates the admin user from `DASH_ADMIN_EMAIL` and `DASH_ADMIN_PASSWORD`
- In local non-production fallback only, `admin@localhost` / `password` may be used if no env secrets are provided
- Cloudflare production should always use explicit secrets instead

### Local Vs Cloudflare Runtime

There are three meaningful execution modes:

- `npm run dev`
  - Standard Next.js local development
  - Uses SQLite
  - Still uses hosted provider APIs for AI work
- `npm run cf:preview`
  - Local Cloudflare Worker preview
  - Uses local D1 through Wrangler
  - Best for testing Worker behavior before production deploy
- Cloudflare production
  - Uses D1 binding `DB`
  - Uses Worker secrets instead of `.env`
  - Should be treated as multi-provider hosted production mode

Rules to remember:

- Do not assume local SQLite data exists in Cloudflare
- Do not read or write directly to SQLite from code that must run in the Worker
- Both preview and production scans use hosted model-native search APIs only
- Do not reintroduce local-model fallbacks, remote proxy providers, or app-managed web search

### Build And Deploy Flow

Scripts:

- `npm run dev`
  - Local Next.js development
- `npm run build`
  - Standard Next.js production build
- `npm run cf:build`
  - Builds the OpenNext Worker output
- `npm run cf:preview`
  - Runs the built Worker locally with Wrangler
- `npm run cf:deploy`
  - Deploys the dashboard Worker
- `npm run cf:deploy:coming-soon`
  - Deploys the apex coming-soon Worker
- `npm run db:migrate:local`
  - Applies D1 migrations to the local Wrangler database
- `npm run db:migrate:remote`
  - Applies D1 migrations to the remote Cloudflare D1 database

Manual deploy sequence:

```bash
npx wrangler login
npm run db:migrate:remote
npm run cf:build
npm run cf:deploy
npm run cf:deploy:coming-soon
```

### Automatic Deploys From GitHub

Cloudflare Workers Builds is configured in the Cloudflare dashboard for the existing `siteintent-dashboard` Worker.

Required settings:

- Production branch: `main`
- Build command: `npm run cf:build`
- Deploy command: `npm run cf:deploy`
- Root directory: repository root, blank, or `.`

Important warning:

- Do not use Cloudflare's default `npx wrangler deploy` deploy command for this app.
- This repo must deploy through the `cf:deploy` package script.
- `cf:deploy` runs `opennextjs-cloudflare deploy --config wrangler.jsonc`.

How to think about Git deploys:

- A push to `main` should trigger a Cloudflare build check in GitHub
- If the check passes, Cloudflare should create a new `siteintent-dashboard` version
- If HTML loads but JS is broken, check the asset binding in `wrangler.jsonc`
- If the build passes but deploy fails, inspect the Cloudflare build log and confirm the deploy command is still `npm run cf:deploy`

### Domain Routing

Domain behavior:

- `dash.aisearchauditor.com`
  - Routed to `siteintent-dashboard`
- `aisearchauditor.com`
  - Routed to `aisearchauditor-coming-soon`
- `www.aisearchauditor.com`
  - Routed to `aisearchauditor-coming-soon`, which redirects to the apex domain

This means:

- Never attach the dashboard Worker to the apex domain
- Public marketing content should eventually replace or evolve the apex Worker, not the dashboard Worker

### Updating The App Safely

If an AI agent is asked to update the hosted app:

1. Read [wrangler.jsonc](/Users/jarvis/Documents/GitHub/SiteIntent/wrangler.jsonc), [package.json](/Users/jarvis/Documents/GitHub/SiteIntent/package.json), and [migrations/0001_initial.sql](/Users/jarvis/Documents/GitHub/SiteIntent/migrations/0001_initial.sql) first.
2. If persistence changes are needed, update both:
   - D1 migration files
   - local SQLite schema in [lib/sqlite.ts](/Users/jarvis/Documents/GitHub/SiteIntent/lib/sqlite.ts)
3. Keep app code using [lib/app-state.ts](/Users/jarvis/Documents/GitHub/SiteIntent/lib/app-state.ts) as the storage boundary.
4. Run local checks:
   - `npm run typecheck`
   - `npm run cf:build`
5. If auth changes are made, verify:
   - `POST /api/auth/login`
   - `GET /api/auth/session`
   - browser login flow
6. If deploy/runtime changes are made, verify:
   - `/_next/static/*` assets return `200`
   - `/login` loads and hydrates
   - authenticated navigation reaches `/dashboard`

### Troubleshooting

Common problems and what they usually mean:

- Login page loads but clicking Sign in appears to do nothing
  - Usually means `/_next/static/*` assets are missing
  - Check `wrangler.jsonc` for the `assets.directory = ".open-next/assets"` binding
- Cloudflare build succeeds but deploy fails with OpenNext config errors
  - Usually means the deploy command is wrong
  - It must be `npm run cf:deploy`, not raw `wrangler deploy`
- API login works in curl but the browser login page does not redirect
  - Usually means frontend assets are not being served
- D1 works locally but not in production
  - Check remote migrations
  - Check the `database_id` and `binding` in `wrangler.jsonc`
- Auth fails immediately in Workers with PBKDF2 iteration errors
  - Cloudflare Workers supports lower iteration counts than some Node defaults
  - The current implementation already uses a Workers-compatible iteration count

### Local Cloudflare Preview

Create a local `.dev.vars` from `.dev.vars.example`, then run:

```bash
npm run db:migrate:local
npm run cf:build
npm run cf:preview
```

The preview runs at `http://localhost:8787` using local D1. This is the best approximation of production without deploying to Cloudflare.

## Scan Overview

The main flow lives in [lib/scan/run-scan.ts](/Users/jarvis/Documents/GitHub/SiteIntent/lib/scan/run-scan.ts).

At a high level, a full scan does this:

1. Crawl the target site and save the crawl snapshot.
2. Run page-level AI analysis on each included page.
3. Build a category model from the analyzed pages.
4. Score `Rankability` for the target website.
5. Run repeated AI discovery searches to score `Discoverability`.
6. Aggregate repeated discovery results into a competitor shortlist.
7. Validate shortlist candidates to keep only real competitors.
8. Score accepted competitors with the same discoverability and rankability pipelines.

Important implementation detail:

- The category model is mostly heuristic code, not a separate AI prompt.
- Rankability uses the saved crawl snapshot, not a fresh scrape of the site.
- Discoverability, discoverability source audit, rankability, and competitor validation use model-native `web_search`.
- The page-analysis stage uses the same hosted OpenAI model family, but it does not attach external tools because it reasons over the stored crawl only.
- The app no longer uses Serper, DuckDuckGo scraping, Playwright, Ollama, or remote OpenAI-compatible proxy providers for production scans.
- Web search user location is derived from the target-intent model when available, otherwise it defaults to the current Australia/Sydney configuration used by the scan code.

## Every AI Prompt Used During A Scan

There are five prompt families in the scan flow.

### 1. Page Analysis Prompt

File: [lib/scan/analyze.ts](/Users/jarvis/Documents/GitHub/SiteIntent/lib/scan/analyze.ts)

This runs once per analyzed page, and usually twice:

- Pass `A`
- Pass `B`
- Pass `C` only if `A` and `B` disagree enough to be considered unstable

So per page, the scan does:

- `2` prompts if the first two passes are stable
- `3` prompts if a tie-break pass is needed

The system instruction is effectively:

```txt
You are an analytical website intent model.
Return only valid JSON.
Identify the real product, audience, and outcome from the page content.
Be concise, specific, and grounded in the page content.
```

The user prompt template is:

```txt
Pass {A|B|C} analysis for Site Intent.
Project: {projectName}
Website: {websiteUrl}
Competitors: {competitorUrls or none}
URL: {page.url}
Page type guess: {pageType}
Page title: {title}
Meta title: {metaTitle}
Meta description: {metaDescription}
H1: {h1}
Headings: {all visible headings}
Content excerpt: {excerpt}
Focus: {only present on pass C}

Return JSON with keys: intent, audience, product, supporting_signals, weakening_signals, confidence.
intent should describe what this page is trying to communicate or help the visitor do.
audience should name the real user group.
product should name the actual offer, not a generic platform.
confidence must be a number from 0 to 1.
```

Example:

```txt
Pass A analysis for Site Intent.
Project: SiteIntent
Website: https://siteintent.com
Competitors: none
URL: https://siteintent.com/
Page type guess: homepage
Page title: SiteIntent
Meta title: AI Search Visibility Platform
Meta description: Measure whether AI can find and recommend your website.
H1: Understand how AI sees your website
Headings: h2:Scan your site | h2:Find competitors | h2:Improve rankability
Content excerpt: SiteIntent scans your website, measures AI discoverability, and explains how to improve recommendation strength.

Return JSON with keys: intent, audience, product, supporting_signals, weakening_signals, confidence.
...
```

What this is used for:

- Merge page-level understanding into a stable record.
- Power the category model.
- Power the stored context later used by Rankability.

Important note:

- This prompt family does not use external web search because it is intentionally constrained to the stored crawl snapshot.
- It still runs on the same hosted model allowlist used by the rest of the app, so production only uses OpenAI models that support native web search when needed elsewhere in the pipeline.

### 2. Discoverability Prompt Set

File: [lib/discoverability/score-site.ts](/Users/jarvis/Documents/GitHub/SiteIntent/lib/discoverability/score-site.ts)

This is the repeated top-10 discovery stage.

It always runs `7` prompts:

- `5` category-first prompt variations
- `2` domain-grounded competitor prompt variations

The exact category-first templates are:

```txt
What are the top 10 {category} websites or providers for {context}?
Recommend the top 10 {category} websites or providers for {context}.
Which 10 {category} websites or providers would you shortlist for {context}?
Give me the top 10 {category} websites or providers for {context}.
If you had to choose 10 {category} websites or providers for {context}, which would you include?
```

The exact domain-grounded templates are:

```txt
Use web search to find the top 10 direct competitors or close alternatives to the website {domain} in the {category} category for {context}.
Using the target website {domain} as grounding, identify the top 10 competitor websites or alternative providers a buyer would realistically compare against for {context}.
```

The system instruction is effectively:

```txt
You are evaluating website discoverability for AI recommendations.
Use web search for current evidence.
Return only JSON matching the provided schema.
Do not invent websites or URLs.
Use official provider websites where possible.
Assess the target website honestly.
Classify SERP-style evidence as search_engine_result.
```

Implementation note:

- In production this stage is executed through the OpenAI Responses API with `tool_choice: "required"` and the `web_search` tool attached.
- The app no longer performs its own search before prompting the model.

Each variation is wrapped in a larger user prompt:

```txt
Question: {one of the 7 questions above}
Target website URL: {scan.websiteUrl}
Target website name: {scan.projectName}
Discovery mode: {category-first discovery search | domain-grounded competitor search}

Return the top candidates and explain which sources led to each inclusion.
Prefer official provider websites rather than listicles or directory pages in the top candidates.
If a search result page, SERP ranking, or search-result snippet led to a candidate or target assessment, classify that source as search_engine_result.
Also assess the target website even if it does not appear in the top candidates.
Do not reward or penalize the target for exact-match keywords in the domain name or URL path.
{mode-specific instruction}

Target website context
Homepage title: ...
Homepage meta title: ...
Homepage H1: ...
Homepage headings: ...
Category: ...
User context: ...
Customer: ...
Problem: ...
Expected concepts: ...
```

Example filled question:

```txt
Question: What are the top 10 visitor management system websites or providers for office managers looking for visitor management system options in Australia?
```

What each run returns:

- top 10 candidates
- target site appeared or not
- target rank if present
- reason the target was found or missed
- per-candidate discovery sources
- common sources used across the run

### 3. Discoverability Source Audit Prompt

File: [lib/discoverability/score-site.ts](/Users/jarvis/Documents/GitHub/SiteIntent/lib/discoverability/score-site.ts)

This runs once after the `7` discoverability runs finish.

Its job is not to ask for another top 10. Its job is to ask:

- which source paths matter most in this category?
- is the target present on them?
- which competitors are present on them?

The system instruction is effectively:

```txt
You are auditing category-level discovery sources for AI recommendations.
Use web search for current evidence.
Return only JSON matching the provided schema.
Focus on external source paths that help AI discover websites in this category.
For each source, state whether the target website appears to be present and which competitors are supported.
Use source_type search_engine_result for SERP-like sources.
```

Implementation note:

- This stage also runs through the OpenAI Responses API with native `web_search`.

The user prompt is effectively:

```txt
Category: {category}
User context: {context}
Target website: {url}
Target website name: {name}

Competitor websites discovered across repeated runs:
{top discovered competitors}

Identify the most valuable source paths for discoverability in this category.
These can include search results/SERPs, review platforms, Google Business Profile, directories, marketplaces, editorial pages, government registers, forums, or social profiles.
Only include official sites if they are clearly acting as a discovery-supporting source beyond the main homepage.
```

What it returns:

- `5` to `12` source opportunities
- source type
- source influence
- whether the target is present
- how many competitors are present
- recommended action

### 4. Rankability Prompt

File: [lib/scoring/score-site.ts](/Users/jarvis/Documents/GitHub/SiteIntent/lib/scoring/score-site.ts)

This runs once for the target website, and once again for each accepted competitor.

This is a single fixed-factor scoring prompt, not a repeated top-10 prompt.

The system instruction is effectively:

```txt
You are scoring website rankability for AI recommendations.
Use web search for current external evidence.
Return only JSON matching the provided schema.
Do not invent URLs or sources.
Score each fixed factor independently.
Do not calculate the final weighted score.
```

Implementation note:

- This stage runs through the OpenAI Responses API with native `web_search`.
- The judge pass that merges multiple independent rankability scorecards does not need external search because it synthesizes already-scored outputs.

The user prompt is built from:

- category
- user context
- website name and URL
- fixed factor definitions and weights
- stored homepage summary
- up to `6` key pages
- up to `6` supporting pages
- category model context
- up to `4` competitor summaries

The prompt structure is:

```txt
Category: {category}
User context: {context}
Website name: {projectName}
Website URL: {websiteUrl}

Score this website for Rankability.
Use the fixed factors exactly as provided.
For each factor return:
- a 0-100 score
- confidence: high, medium, or low
- whether the signal could be verified
- evidence
- source URLs

Fixed factors
- website_content_relevance_completeness: ... Weight 30%.
- reviews_customer_reputation: ... Weight 5%.
- third_party_authority_external_validation: ... Weight 30%.
- on_site_trust_signals: ... Weight 20%.
- location_availability_service_coverage: ... Weight 5%.
- price_value_clarity: ... Weight 10%.

Stored crawl snapshot
Scored pages: {n}

Homepage
{homepage summary}

Key pages
{up to 6 pages}

Supporting pages
{up to 6 pages}

Category context
Customer: ...
Problem: ...
Expected concepts: ...
Expected outcomes: ...
Shared signals: ...

Competitor context
{up to 4 competitors}
```

What it returns:

- one score per fixed factor
- evidence per factor
- source URLs per factor
- warnings
- summary

### 5. Competitor Validation Prompt

File: [lib/scan/run-scan.ts](/Users/jarvis/Documents/GitHub/SiteIntent/lib/scan/run-scan.ts)

This runs only after discoverability has produced a competitor shortlist.

The scan takes the aggregated discovery candidate list, removes the target domain, and keeps the top `10` discovered candidates for validation.

For each of those candidates, it asks whether the candidate is a real competitor.

The system instruction is effectively:

```txt
You are validating whether a website is a true competitor to another website.
Use web search for current evidence.
Return only JSON matching the provided schema.
A true competitor should serve a meaningfully similar product or service to a similar buyer in the same market context.
Focus on whether the candidate is a real direct alternative rather than a directory, review page, marketplace listing, or editorial roundup.
```

Implementation note:

- This stage runs through the OpenAI Responses API with native `web_search`.

The user prompt is effectively:

```txt
Target website: {target url}
Target website name: {target name}
Primary product/service target: {category}
Candidate website: {candidate website}
Candidate name: {candidate name}
Category: {category}
Customer: {customer}
Problem: {problem}
Expected concepts: {concepts}
Why the candidate surfaced: {top discovery reasons}

Decide whether the candidate is truly a competitor to the target website.
Give a confidence score from 0 to 100.
```

Borderline candidates are rechecked:

- accept threshold: `>= 75`
- recheck band: `65` to `74.9`

So a candidate can get:

- `1` validation pass if clearly accepted or rejected
- `2` passes if it lands in the borderline recheck zone

The scan stops once it has accepted `5` validated competitors, or runs out of candidates.

## How Discoverability Is Actually Calculated

The discoverability types and weights live in [lib/discoverability/types.ts](/Users/jarvis/Documents/GitHub/SiteIntent/lib/discoverability/types.ts).

### Step 1. Run 7 Top-10 Discovery Searches

SiteIntent asks AI for the top `10` sites `7` times:

- `5` category-first versions
- `2` domain-grounded versions

This produces up to `70` candidate placements in total.

### Step 2. Aggregate Repeated Candidates

The app groups all returned websites by normalized domain.

For each domain it records:

- `appearanceCount`
- `appearanceRate`
- `averageRank`
- `bestRank`
- `supportingPromptVariations`
- deduped reasons
- deduped discovery sources

The sort order is:

1. Higher `appearanceCount`
2. Better `averageRank`

This means the app does not average each run into a final top 5 directly.
It first builds a cross-run domain-level aggregate table, then sorts that table.

### Step 3. Build The Competitor Shortlist

After aggregation, the app:

1. Removes the target site itself.
2. Takes the top `10` aggregated candidates.
3. Validates them one by one with the competitor-validation prompt.
4. Keeps candidates scoring at least `75` competitor confidence.
5. Rechecks borderline candidates between `65` and `74.9`.
6. Stops after `5` accepted competitors.

So the actual logic is:

```txt
7 repeated top-10 discovery runs
-> aggregate by domain
-> sort by appearance count, then average rank
-> take top 10 non-target candidates
-> validate candidates one by one
-> keep first 5 real competitors
```

### Step 4. Score Discoverability Factors

Discoverability currently has `3` active factors:

- `search_result_presence` = `20`
- `source_path_diversity` = `25`
- `third_party_source_strength` = `25`

These are normalized by the active weight total, which is `70`.

So each weighted contribution is:

```txt
weightedContribution = factorScore x (factorWeight / 70)
```

That means the final discoverability score still lands on a `0-100` scale even though only `70` raw weight points are active.

### Factor 1. Search Result Presence

Question answered:

```txt
Did explicit SERP/search-result evidence help AI become aware of the site?
```

The app only counts explicit search-result-like evidence:

- `search_engine_result`
- source audit items that clearly represent SERP-style sources

If there are no explicit SERP-style sources:

```txt
score = 0
```

If there are some, the score is based on the strength of those sources.

### Factor 2. Source Path Diversity

Question answered:

```txt
How many different discovery source types support the target?
```

If source-audit data exists, the score is:

```txt
sourceTypeCoverageScore = (min(numberOfTargetSourceTypes, 5) / 5) x 100
```

Example:

```txt
4 source types -> (4 / 5) x 100 = 80
```

If no source audit is available, the app falls back to source types seen directly in the target's collected discovery sources.

### Factor 3. Third-Party Source Strength

Question answered:

```txt
How strong is the target's coverage on the highest-value external source paths?
```

If source-audit data exists, the score is:

```txt
highValueSourceCoverageScore = (capturedWeight / totalPossibleWeight) x 100
```

Source opportunity weight is:

```txt
sourceOpportunityWeight = influenceWeight x sourceTypeWeight x 100
```

Influence weights:

- `high = 1.0`
- `medium = 0.7`
- `low = 0.45`

Source-type weights:

- `review_platform = 1.0`
- `google_business_profile = 1.0`
- `government_register = 1.0`
- `editorial_media = 0.95`
- `industry_directory = 0.9`
- `marketplace = 0.85`
- `official_site = 0.75`
- `forum = 0.65`
- `social = 0.5`
- `unknown = 0.45`

If source-audit data is missing, the app falls back to the strength of the target's discovered third-party sources.

### Final Discoverability Formula

```txt
Discoverability Score
= search_result_presence x (20 / 70)
+ source_path_diversity x (25 / 70)
+ third_party_source_strength x (25 / 70)
```

## How Rankability Is Actually Calculated

The rankability types and weights live in [lib/scoring/types.ts](/Users/jarvis/Documents/GitHub/SiteIntent/lib/scoring/types.ts).

Rankability is not based on repeated prompt frequency.
It is a single scoring pass with fixed factors owned by the app.

### Inputs Used

The rankability prompt is built from:

- the stored crawl snapshot
- the homepage summary
- up to `6` key pages
- up to `6` supporting pages
- the category model
- up to `4` competitor summaries
- live web-search evidence

### Fixed Factors And Weights

- `website_content_relevance_completeness` = `30`
- `reviews_customer_reputation` = `5`
- `third_party_authority_external_validation` = `30`
- `on_site_trust_signals` = `20`
- `location_availability_service_coverage` = `5`
- `price_value_clarity` = `10`

### Per-Factor Scoring

The AI returns for each factor:

- `score` from `0` to `100`
- `confidence`
- `could_verify_signal`
- `evidence`
- `sources`

The app then calculates:

```txt
weightedContribution = factorScore x (factorWeight / 100)
```

Example:

```txt
website_content_relevance_completeness = 82
weight = 30
weighted contribution = 82 x 0.30 = 24.6
```

### Final Rankability Formula

```txt
Rankability Score
= website_content_relevance_completeness x 0.30
+ reviews_customer_reputation x 0.05
+ third_party_authority_external_validation x 0.30
+ on_site_trust_signals x 0.20
+ location_availability_service_coverage x 0.05
+ price_value_clarity x 0.10
```

## What The Scan Does Not Do

The current code does not do these things:

- It does not ask AI to invent its own ranking factors.
- It does not calculate Rankability by repeated top-10 frequency.
- It does not directly turn the 7 top-10 discoverability runs into a final top 5 without validation.
- It does not build the category model from a separate category-classification prompt.
- It does not use Serper, DuckDuckGo HTML scraping, Playwright, or any other app-managed search adapter in production.
- It does not use Ollama or an OpenAI-compatible remote proxy provider for the live dashboard.

## Short Plain-English Summary

The current scan is best understood like this:

1. Read each page and ask AI what the page is about.
2. Build a category model from those page summaries.
3. Score the website once for fixed rankability factors.
4. Ask AI for the top 10 in the category `7` different ways.
5. Merge those repeated top-10 lists by domain.
6. Sort domains by how often they appeared, then by average rank.
7. Validate the top `10` non-target candidates one by one.
8. Keep the first `5` that look like real competitors.
9. Run scoring for those competitors too.

If you want, the next step could be a second README section that lists the exact JSON schema returned by each prompt family as well.
