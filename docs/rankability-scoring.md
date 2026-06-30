# SiteIntent Rankability Scoring

This document defines the current Rankability scoring setup for SiteIntent.

Rankability answers one question:

> If AI discovers this website as a candidate, does it have enough evidence to be recommended highly?

This is separate from Discoverability, which answers whether AI finds the website in the first place.

## Current Status

This scoring model was validated in the research runner:

`scripts/run-factor-validation-pilot.mjs`

The best-performing active profile from the pilot is:

`external_validation_v2`

It was tested against GPT-5.5 and GPT-5.4 mini using web-search-enabled scoring. The model consistently separated the AI-recommended top 5 from ranks 6-10 across the tested categories.

For the live app, use GPT-5.1 mini by default, but keep the model configurable so it can be changed to GPT-5.5 later.

Recommended environment variable:

```txt
SITEINTENT_RANKABILITY_MODEL=gpt-5.1-mini
```

Fallback default:

```txt
gpt-5.1-mini
```

## Scoring Philosophy

Rankability should not ask the model to invent its own ranking factors.

The app owns the fixed factor list and the weightings. The AI only scores each isolated factor from 0-100 and provides evidence.

The weighted total is calculated in SiteIntent code, not by the AI.

This is important because:

- The scoring model stays consistent between users.
- Weightings can be tuned without rewriting prompts.
- The AI cannot move evidence between categories to justify a result.
- Product fit, features, menus, service range, materials, and compliance are treated as website-content signals, not separate ranking factors.

## Active Scoring Profile

Use this profile in the live app:

```json
{
  "id": "external_validation_v2",
  "label": "External validation weighted model v2",
  "weights": {
    "website_content_relevance_completeness": 30,
    "reviews_customer_reputation": 5,
    "third_party_authority_external_validation": 30,
    "on_site_trust_signals": 20,
    "location_availability_service_coverage": 5,
    "price_value_clarity": 10
  }
}
```

The total must always equal 100.

## Fixed Factors

### 1. Website Content Relevance And Completeness

ID:

```txt
website_content_relevance_completeness
```

Weight:

```txt
30%
```

Definition:

Score only how well the website's own content proves relevance and completeness for the target category and user intent.

Include:

- Product or service fit
- Features
- Product materials
- Menus
- Service range
- Compliance
- Coverage details
- Pricing pages
- Booking paths
- Category-specific information

Do not include:

- External reviews
- Third-party directory presence
- Awards or editorial mentions, unless they are only being assessed as on-site claims

### 2. Reviews And Customer Reputation

ID:

```txt
reviews_customer_reputation
```

Weight:

```txt
5%
```

Definition:

Score only customer review and reputation signals.

Include:

- Review volume
- Review quality
- Review recency
- Rating consistency
- Customer sentiment
- Complaints
- Platform credibility

Do not score website content here except testimonials/review evidence.

This factor has a low weighting because the pilot showed that generic review score alone was not enough to explain AI recommendations. Reviews matter, but they are better treated as one part of the wider external validation picture.

### 3. Third-Party Authority And External Validation

ID:

```txt
third_party_authority_external_validation
```

Weight:

```txt
30%
```

Definition:

Score only independent external validation.

Include:

- Editorial lists
- Awards
- Government or industry registers
- Reputable directories
- Marketplace rankings
- Expert reviews
- Forum consensus
- Credible media mentions
- Category-specific third-party comparison pages

This is one of the two highest-weighted factors because the research showed AI recommendations depend heavily on whether the website can be independently validated outside its own site.

### 4. On-Site Trust Signals

ID:

```txt
on_site_trust_signals
```

Weight:

```txt
20%
```

Definition:

Score only trust signals visible on the website itself.

Include:

- Clear contact details
- ABN/company details
- Security/privacy pages
- Guarantees
- Insurance
- Certifications
- Policies
- Case studies
- Testimonials
- Client logos
- Team/about pages
- Professional presentation

This factor is separate from content relevance. A site can explain its offer well but still look weak from a trust perspective.

### 5. Location, Availability And Service Coverage

ID:

```txt
location_availability_service_coverage
```

Weight:

```txt
5%
```

Definition:

Score only how well the website/provider fits the user's geography and availability needs.

For local services, include:

- Sydney service area
- Suburb/location coverage
- Proximity
- Booking availability
- Opening hours
- Delivery/service logistics

For national products/software, include:

- Australian availability
- Australian support
- Shipping or service coverage
- Currency/local buying fit

### 6. Price And Value Clarity

ID:

```txt
price_value_clarity
```

Weight:

```txt
10%
```

Definition:

Score only pricing and value clarity.

Include:

- Visible pricing
- Plan/product comparison
- Inclusions
- Value for money
- Free trials
- Quote paths
- Shipping/extra fees
- Whether a buyer can judge affordability

## Recommended Live-App Flow

The research runner scores an AI-generated top 10. In the live app, Rankability should score a known website and its known competitor set.

Recommended flow:

1. User has a target website and category/intent context.
2. SiteIntent has a stored crawl snapshot for the target website.
3. SiteIntent has competitor websites, either user-provided or discovered by a separate Discoverability process.
4. Rankability scoring runs once per website.
5. Each factor is scored independently.
6. Each factor can be repeated 3 times for higher confidence, or once for a lower-cost live plan.
7. SiteIntent averages repeated scores per factor.
8. SiteIntent applies the fixed weights locally.
9. SiteIntent returns:
   - total Rankability score
   - factor scores
   - evidence
   - sources
   - confidence
   - recommendations for improvement

## Cost Modes

Use a configurable scoring depth.

### Standard Mode

Use one scoring call per website that returns all six factor scores.

Best for:

- Live app default
- Lower cost
- Faster feedback

Tradeoff:

- Less factor isolation than the research runner.

### Validation Mode

Use one scoring call per factor, repeated 3 times.

Best for:

- Internal research
- High-value audits
- Validating changes to the scoring model

Tradeoff:

- More expensive
- Slower

### Recommended Initial Live Mode

Start with Standard Mode, but keep the code structured so Validation Mode can be enabled later.

The Standard Mode prompt must still require isolated scores for all six fixed factors.

## OpenAI Responses API Setup

Use the OpenAI Responses API.

Default model:

```txt
gpt-5.1-mini
```

Configurable via:

```txt
SITEINTENT_RANKABILITY_MODEL
```

For current evidence, use the hosted web search tool.

Recommended Sydney/Australia default location:

```json
{
  "type": "web_search",
  "user_location": {
    "type": "approximate",
    "country": "AU",
    "region": "New South Wales",
    "city": "Sydney",
    "timezone": "Australia/Sydney"
  }
}
```

For a user outside Sydney, replace the approximate location with the user's configured market/location.

## Standard Mode Prompt Shape

System prompt:

```txt
You are scoring website rankability for AI recommendations.
Use web search for current external evidence.
Return only JSON matching the provided schema.
Do not invent URLs or sources.
Score each fixed factor independently.
Do not reward a website for the same evidence in multiple factors unless it genuinely applies to both.
The app will calculate weighted totals; do not calculate the final weighted score.
```

User prompt:

```txt
Category: {category}
User context: {context}
Website name: {website_name}
Website URL: {website_url}

Score this website for Rankability.

Use the fixed factors exactly as provided.
For each factor:
- Return a 0-100 score.
- Explain the evidence.
- Include source URLs where available.
- State confidence: high, medium, or low.
- State whether the signal could be verified.

Treat product fit, materials, features, menus, service range, compliance, and category-specific details as part of website_content_relevance_completeness.
Do not create new factor categories.
```

## Standard Mode Response Schema

The response should follow this shape:

```json
{
  "website": {
    "name": "",
    "url": ""
  },
  "category": "",
  "context": "",
  "factor_scores": {
    "website_content_relevance_completeness": {
      "score": 0,
      "confidence": "high",
      "could_verify_signal": true,
      "evidence": "",
      "sources": []
    },
    "reviews_customer_reputation": {
      "score": 0,
      "confidence": "medium",
      "could_verify_signal": true,
      "evidence": "",
      "sources": []
    },
    "third_party_authority_external_validation": {
      "score": 0,
      "confidence": "medium",
      "could_verify_signal": true,
      "evidence": "",
      "sources": []
    },
    "on_site_trust_signals": {
      "score": 0,
      "confidence": "medium",
      "could_verify_signal": true,
      "evidence": "",
      "sources": []
    },
    "location_availability_service_coverage": {
      "score": 0,
      "confidence": "medium",
      "could_verify_signal": true,
      "evidence": "",
      "sources": []
    },
    "price_value_clarity": {
      "score": 0,
      "confidence": "medium",
      "could_verify_signal": true,
      "evidence": "",
      "sources": []
    }
  },
  "summary": "",
  "warnings": []
}
```

The app should clamp every score to 0-100 before calculation.

## Validation Mode Prompt Shape

Validation Mode should use the same pattern as the research runner:

- One factor per API call
- Score the same website or website set for that factor only
- Repeat each factor 3 times
- Average the repeated scores

Prompt:

```txt
Category: {category}
User context: {context}
Factor to score: {factor_id} ({factor_label})
Factor definition: {factor_instruction}

Score only this factor for the website below.
Use web search to verify evidence.
Return a 0-100 score.
A score of 100 means unusually strong evidence for this factor.
A score of 0 means no relevant evidence found.
If evidence is weak or not found, use a lower score and set could_verify_signal to false.

Website:
{website_name} - {website_url}
```

## Score Calculation

For Standard Mode:

```txt
weighted_total =
  website_content_relevance_completeness * 0.30 +
  reviews_customer_reputation * 0.05 +
  third_party_authority_external_validation * 0.30 +
  on_site_trust_signals * 0.20 +
  location_availability_service_coverage * 0.05 +
  price_value_clarity * 0.10
```

For Validation Mode:

1. Average the repeated scores for each factor.
2. Apply the same weighted formula.

Example:

```json
{
  "factor_scores": {
    "website_content_relevance_completeness": {
      "repeat_scores": [82, 85, 84],
      "average_score": 83.7
    },
    "third_party_authority_external_validation": {
      "repeat_scores": [76, 80, 78],
      "average_score": 78
    }
  }
}
```

## Recommended Output Stored By SiteIntent

For each website scoring run:

```json
{
  "id": "",
  "website_id": "",
  "scan_id": "",
  "category": "",
  "context": "",
  "model": "gpt-5.1-mini",
  "scoring_profile_id": "external_validation_v2",
  "uses_web_search": true,
  "factor_scores": {
    "website_content_relevance_completeness": {
      "score": 0,
      "weight": 30,
      "weighted_contribution": 0,
      "confidence": "medium",
      "could_verify_signal": true,
      "evidence": "",
      "sources": []
    }
  },
  "weighted_total_score": 0,
  "summary": "",
  "warnings": [],
  "raw_response": {},
  "created_at": ""
}
```

## Recommended UI Interpretation

Suggested bands:

```txt
85-100: Very strong Rankability
70-84: Strong, but improvable
55-69: Moderate
40-54: Weak
0-39: Very weak
```

Suggested labels:

- Website content
- Reviews
- External validation
- Trust signals
- Location/availability
- Price/value clarity

The UI should make it clear that Rankability is not the same as Discoverability.

Example:

```txt
Your website has strong Rankability, but may still fail to appear in AI recommendations if AI does not discover enough evidence about it across trusted sources.
```

## Improvement Recommendations

The live app can translate low factor scores into recommendations.

### Low Website Content Score

Recommend:

- Create or improve category landing pages.
- Make product/service fit explicit.
- Add service range, features, use cases, FAQs, and comparison content.
- Improve headings, meta titles, and crawlable page copy.

### Low Reviews Score

Recommend:

- Increase review volume on relevant platforms.
- Improve recency of reviews.
- Add review/testimonial evidence on-site.
- Resolve recurring complaints where visible.

### Low External Validation Score

Recommend:

- Get listed in category-relevant directories.
- Earn mentions in reputable comparison articles.
- Build presence on marketplaces or software review sites where relevant.
- Add awards, certifications, partnerships, and media coverage where legitimate.

### Low On-Site Trust Score

Recommend:

- Add clear contact details.
- Add ABN/company details where relevant.
- Add policies, guarantees, insurance, certifications, case studies, team/about pages, and client logos.

### Low Location/Availability Score

Recommend:

- Add clear service-area pages.
- Mention suburbs/regions served.
- Add opening hours, booking details, delivery coverage, shipping information, and local support details.

### Low Price/Value Score

Recommend:

- Add pricing or quote guidance.
- Clarify inclusions.
- Add plan/product comparisons.
- Explain shipping, extras, free trials, or consultation paths.

## Engineering Notes

- Keep factors and weights in application config, not prompts.
- Keep the model name in config/environment.
- Store the raw response for audit/debugging.
- Store API web sources separately from model-written evidence where available.
- Clamp all AI scores to 0-100.
- Do not let missing evidence become a neutral score. Missing or unverifiable evidence should reduce the score.
- Use structured JSON output with a strict schema where supported.
- Retry transient OpenAI/API errors with exponential backoff.
- Never calculate the final weighted score inside the model response.
- Keep Discoverability as a separate module.

## Open Questions For Live Implementation

- Whether Standard Mode is sufficient for all paid tiers, or whether high-tier audits should use Validation Mode.
- Whether competitor comparison should be shown alongside the target website immediately, or only after Discoverability is built.
- Whether industry-specific source weighting should be added later.
- Whether the app should use GPT-5.5 by default once cost and quality are acceptable.

