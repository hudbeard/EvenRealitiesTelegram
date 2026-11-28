# Crew Prototype (Archived)

This folder contains the original bot-based crew coordination prototype. It has been archived because the personal Telegram account integration (`src/glasses/` + `server/personal/`) is now the primary app.

## Files

- `index.html` — Original crew app HTML entrypoint
- `main.ts` — Original crew app TypeScript entry
- `style.css` — Original crew app styles
- `server-index.ts` — Bot server entry (originally `server/index.ts`)
- `server-app.ts` — Bot Express app (originally `server/app.ts`)
- `server-telegram.ts` — Bot API integration (originally `server/telegram.ts`)

## Why Archived

The personal account mode is more powerful and doesn't require bot tokens. The crew prototype was kept during development but is no longer part of the default build.

## Original Documentation

See `docs/crew-prototype.md` in the parent directory for the original design and verification.
