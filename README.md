# Project Sora

Project Sora is a browser-based game library and discovery dashboard for tracking collections, exploring upcoming releases, and managing player profiles.

## Features

- Personal game library management with search and filtering
- Catalog discovery with detail pages and routing
- Wishlist, play queue, and play-next recommendations
- Price history and price alert workflows
- Friends activity feed and privacy controls
- Installable Progressive Web App (PWA) with offline fallback
- Reliability, accessibility, and security-focused automated test coverage

## Installation

1. Install Node.js 20 or newer.
2. Clone the repository.
3. Install dependencies:

```bash
npm install
```

## Local Development

1. Start the app locally:

```bash
npm start
```

2. Open your browser at:

```text
http://localhost:3000
```

3. Run the full verification suite:

```bash
npm run verify
```

## Deployment

1. Ensure verification passes:

```bash
npm run verify
```

2. Set production environment variables as needed.
3. Deploy with your platform process for a Node.js app (entry point: `server.js`).
4. Validate post-deploy endpoints such as `/health` and `/ready`.

## Screenshots

Screenshots coming soon.

- Home dashboard: _placeholder_
- Catalog detail view: _placeholder_
- Mobile navigation: _placeholder_

## License

This project is released under the MIT License. Add a `LICENSE` file if you want to publish with explicit license text.

## Enhanced user profiles

Authenticated users can customize a public-facing profile with a display name, short bio, profile picture URL, banner image URL, and up to five favorite games. Public profiles use shareable hash routes such as `#profile/handle` and continue to respect the existing profile and library privacy controls. Image URLs are limited to HTTPS or safe same-origin paths; direct file uploads are not included because free Render instances do not provide durable upload storage.

## Add-to-Library Autofill and Barcode Scanning

The Add a Game form now supports title suggestions, catalog autofill, manual UPC/EAN lookup, and camera barcode scanning in browsers that implement the Barcode Detection API. Selecting a title suggestion fills available platform, cover, Metacritic score, current catalog price, and MSRP fields.

Barcode lookup is catalog-backed: a scanned code will match when a catalog record contains a `barcode` value or a `barcodes` array. Unsupported browsers can still enter a UPC/EAN manually. MSRP and current value are catalog-provided reference values and should be verified for the exact platform, region, and edition before saving.

## Game catalog

This beta build includes **16,500 game/platform records** for title autocomplete and catalog search. Imported records include title, platform, release year, genre, and publisher when available. MSRP, live prices, cover art, critic scores, and barcode identifiers are intentionally left unavailable unless verified by a licensed data source. See `data/CATALOG_SOURCE.md` for provenance and limitations.

## Open barcode enrichment

Project Sora includes a conservative importer for free, no-account barcode data from Wikidata's GTIN property (P3962):

```bash
npm run import:open-barcodes
```

The importer validates GTIN checksums, requires an exact normalized title match and compatible platform, records provenance, and rejects ambiguous matches. It writes detailed reports to `reports/`. No barcode is generated or guessed.


## Account access
Accounts are created without an email verification-code requirement in this beta build. Users can sign in immediately after registration. Do not add platform passwords, API keys, or other secrets to profile fields or commit them to the repository.

## Verified release discovery

The Upcoming Releases queue now accepts only finite hard launch dates within the next 12 months, sorts them soonest-first, refreshes its public Steam Store feed daily, and excludes undated news posts. The Latest Release Coverage panel refreshes from a rolling seven-day window of IGN, GameSpot, Eurogamer, Polygon, and PC Gamer coverage. Console store APIs are intentionally not labeled as connected until official public access is available.
