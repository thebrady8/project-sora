# Sprint 3 Item 1 — Verified Release & News Trust Foundation

## Completed
- Added release-source trust metadata and stale-cache detection.
- Added `/api/releases/status` for release and coverage freshness, count, source type, and disclosure.
- Added per-release provenance fields and hard-date confidence labels.
- Added weekly article freshness and HTTPS validation on the client.
- Added a visible Data Source Trust panel in the release coverage area.
- Clearly distinguishes public structured endpoints and RSS aggregation from official provider APIs.

## Validation
- Focused tests: 8 passed twice.
- Full non-SQLite suite: 136 passed twice.
- Syntax checks passed.
- Native SQLite tests require `better-sqlite3` in Codespaces or Render.
