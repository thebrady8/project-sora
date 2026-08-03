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
