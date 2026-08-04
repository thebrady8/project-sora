# Sprint 1 Item 3 — Release Pipeline Stabilization

Completed:
- hard-date-only release normalization within a rolling 12-month window
- expired, invalid, beyond-horizon, and duplicate release removal
- deterministic soonest-to-latest ordering
- full-queue forward/backward wrapping through shared rotation logic
- platform filtering without changing queue order
- source/freshness labels retained in the UI and API payload
- authenticated Interested-state persistence with a local offline fallback
- existing authenticated Wishlist persistence retained

Validation:
- focused Item 1–3 regression suite run twice: 17/17 passed on both runs
- complete JavaScript syntax suite passed
- full project suite run twice: 73 passed and 14 unavailable on both runs
- all 14 unavailable tests require better-sqlite3, which is not installed in this artifact environment
