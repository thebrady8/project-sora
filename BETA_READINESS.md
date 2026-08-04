# Project Sora Beta Readiness

This consolidated build includes the current profile, Game Finder, barcode/title autofill, 16,500-entry catalog, loading skeletons, mobile/PWA improvements, no-email-verification registration flow, cache refresh handling, and friendly API errors.

## Pre-deploy checks

- Run `npm install`
- Run `npm run verify`
- Confirm no nested `project-sora/` folder is staged
- Confirm ZIP files, databases, `.env`, and `node_modules/` are not staged
- Push to `main` and deploy the latest commit on Render

## Live smoke test

1. Create an account and confirm automatic login.
2. Open and edit the profile.
3. Test title autocomplete, barcode lookup, and Add to Library.
4. Test Game Finder pass/like/strong-interest actions and animations.
5. Confirm Upcoming Releases, search, wishlist, play queue, and statistics load.
6. Refresh normally and confirm the latest build loads without a hard refresh.
7. Check the browser console for Project Sora errors.
