# AYJ Chess

A school chess tournament manager with weekly sessions, Swiss tournaments, club Elo ratings and public standings.

Live website: [ayjchess.vercel.app](https://ayjchess.vercel.app/)

## Features

- Separate admin and tournament manager accounts with username/password sign-in.
- Paste new and returning players, import starting ratings, and add late arrivals.
- Weekly pairings and multi-round Swiss tournaments with editable unplayed boards, waiting players and byes.
- Results, standings and automatic tie-breaks: direct encounter, BH-C1, Buchholz, Sonneborn-Berger and played wins.
- Club Elo ratings, configurable K, and current-rating corrections that preserve past games.
- Read-only public standings and pairings for sessions the admin publishes.
- Admin activity logs and a Google Sheets mirror showing names and current ratings.

## Architecture

The React interface and API bridge run on Vercel. A private Vinext/Cloudflare Worker backend stores club data and password accounts in D1. The browser never receives the backend service credentials. The optional bound Google Apps Script polls a read-only ratings feed about once per minute.

This is a clean source snapshot. Production player data, accounts, passwords, tokens, database files, local backups and private Git history are not included. Personal email addresses and production spreadsheet/deployment identifiers have been replaced or removed. Existing production configuration and hosting remain separate.

## Local development

Use Node.js 22.13 or newer. The tests use Node's built-in SQLite support; Node.js 24 is recommended.

```sh
npm ci
npm run dev
```

The backend development server uses local D1 data, not the live club database. For a frontend-only preview, run `npm run dev:vercel`; account and tournament requests still require a configured API backend.

## Checks and builds

```sh
node --experimental-strip-types --test tests/*.test.mjs
npx tsc --noEmit
npm run build:vercel
npm run build
```

The `*-api-integration.mjs` scripts are separate local QA flows that require disposable local accounts and data. They are not production tests. The explicitly named `security-live.mjs` script performs bounded, non-destructive checks against the live website and is not part of the unit test command.

## Deployment configuration

Configure these only in your hosting provider's server-side environment settings:

| Vercel | Private backend |
| --- | --- |
| `CLUB_BACKEND_URL` | `OWNER_SETUP_KEY_HASH` |
| `CLUB_BACKEND_TOKEN` | `OWNER_SETUP_KEY_EXPIRES_AT` |
| `CLUB_PROXY_KEY` | `PROXY_KEY_HASH` |
| | `SHEETS_SYNC_KEY_HASH` (optional) |

The Vercel build is `npm run build:vercel`, with output in `vercel-dist`. The backend build is `npm run build`. Before publishing a backend, link the appropriate Sites project and configure its D1 binding. The exported `.openai/hosting.json` keeps only the binding declarations and has no production project identity.

Before setting up a new deployment, replace `admin@example.com` in `lib/server-config.ts` with the intended admin identifier. For the optional Sheets connection, replace `YOUR_SPREADSHEET_ID` in the integration configuration and follow `integrations/google-sheets/README.md`. Never commit actual credentials, setup links, database backups or spreadsheet access tokens.

See [CLUB_GUIDE.md](CLUB_GUIDE.md) for tournament controls, [SECURITY.md](SECURITY.md) for security boundaries, and [docs/FRAMEWORK.md](docs/FRAMEWORK.md) for framework details. Pairings are club Swiss-style pairings, not a FIDE-certified pairing engine.
