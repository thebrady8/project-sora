# Project Sora Integration Skeleton

## Active beta sources

| Source | Type | Current use | Update policy |
|---|---|---|---|
| Steam Store | Public structured storefront endpoints | Upcoming PC releases with hard dates | Daily cache; timeout/retry; stale cache fallback |
| Google News RSS | Public RSS aggregation | Links to recent coverage from named outlets | Six-hour cache; seven-day rolling window |
| Local catalog | Imported static dataset | Search, library autocomplete, discovery metadata | Updated by controlled imports |
| Open barcode records | Open structured data | UPC/EAN lookup with provenance | Updated by explicit import command |

## Partner integration placeholders

Xbox, PlayStation, and Nintendo are represented in `/api/integrations/status`, but remain disabled until approved official access and credentials are available. Project Sora must not label these placeholders as connected or verified.

## Rules

1. HTML scraping is disabled.
2. Every external feature must state its source type.
3. Static catalog values must not be labeled live or current.
4. Missing prices, artwork, and barcodes remain unavailable rather than guessed.
5. External requests use timeouts and limited retries.
6. Cached data may be served during provider outages and must be labeled with its update time.
7. Private APIs are same-origin by default.
8. Camera permission is same-origin only and requires HTTPS on mobile.
