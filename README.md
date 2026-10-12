# Nelson's Place — Digital Menu & Ordering

Interactive QR-code menu and ordering system for **Nelson's Place Apart Hotel** (Mozambique), with an internal staff dashboard and WhatsApp order forwarding.

- **Guest menu** (`/`): mobile-first, Portuguese by default (English available), categories, search, product options, persistent cart, checkout, order status tracking.
- **Staff dashboard** (`/admin/`): login, live order board (auto-refresh + sound alert), status workflow, menu/price/availability management, photo upload, staff accounts, settings, audit log.
- **WhatsApp**: every order is stored in the database first; it is then forwarded via a prefilled `wa.me` link (default) or the official WhatsApp Business Cloud API (optional). See [docs/WHATSAPP.md](docs/WHATSAPP.md).

> **Status:** functional foundation, tested locally (see [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md)). The menu content is **demo data**; the hotel's real menu, prices, WhatsApp number, policies and branding are still pending.

## Stack

| Layer | Choice |
| --- | --- |
| Frontend | React 19 + TypeScript, Vite (two entry points: guest and admin), hand-written CSS design system, self-hosted fonts |
| Backend | Node.js (≥ 22.9) + [Hono](https://hono.dev), single process |
| Database | SQLite via `better-sqlite3` (WAL mode), versioned migrations |
| Validation | `zod` schemas shared by browser and server |
| Auth | Email + password (scrypt), opaque server-side sessions in an HttpOnly cookie |
| Tests | Vitest (unit + API integration), Playwright (browser, uses installed Microsoft Edge) |

Why this stack, and the hosting comparison: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Quick start (development)

```bash
npm install
cp .env.example .env          # then set NODE_ENV=development and COOKIE_SECURE=false
npm run build                 # builds frontend + server + CLI tools
npm run db:seed-demo          # optional: loads the DEMO menu into data/nelsons-place.db
npm run admin:create -- --email you@example.com --name "Your Name"
npm run dev                   # API on :3000 + Vite on :5173 (proxying /api)
```

Open http://localhost:5173 (menu) and http://localhost:5173/admin/ (dashboard).

QR codes encode the location, e.g. `https://<domain>/?t=room&loc=12` or `?t=table&loc=4`.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | API server (auto-reload) + Vite dev server |
| `npm run build` | Production build → `dist/client` (static) and `dist/server` (server + CLI) |
| `npm start` | Run the production server (`app.cjs` → `dist/server/index.js`) |
| `npm run admin:create -- --email E --name "N" [--role admin\|reception\|restaurant]` | Create a staff account (hidden password prompt, or `ADMIN_PASSWORD` env var) |
| `npm run db:seed-demo` | Load demo menu into an **empty** database (refuses in production without `--force-production`) |
| `npm run db:import-menu -- --file menu-import/menu-nelsons-place.json` | Import the hotel's menu (transcribed from the printed menu) into an **empty** database |
| `npm run db:backup -- [--dir backups] [--keep 14]` | Consistent online SQLite backup with rotation |
| `npm run typecheck` / `npm run lint` | TypeScript and ESLint |
| `npm test` | Unit + API integration tests (in-memory SQLite) |
| `npm run test:e2e` | Browser tests against the built app (run `npm run build` first) |
| `npm run check` | typecheck + lint + tests + build |

CLI tools run from `dist/`, so run `npm run build` (or `npm run build:server`) first.

## Project structure

```
src/
  shared/        Domain code used by browser AND server: constants, zod schemas,
                 pricing, order-status workflow, WhatsApp message builder, money
  server/
    config.ts    Environment parsing (all secrets live here, server-side only)
    db/          SQLite connection + append-only migrations
    repositories/ Data access (SQL only here)
    services/    Business logic: orders, auth, images
    whatsapp/    WhatsApp integration (separate from order processing)
    http/        Middleware: security headers, auth, CSRF, rate limiting, errors
    routes/      public (guest), auth, admin
    cli/         create-admin, seed-demo, backup
  client/
    guest/       Guest menu app
    admin/       Staff dashboard app
    components/, lib/, styles/   Shared UI, API client, design tokens
tests/           Vitest unit + integration tests
e2e/             Playwright browser tests
docs/            Architecture, database, WhatsApp, deployment, status
legacy/prototype Original HTML/Bootstrap prototype (kept for reference)
```

## Configuration

All server configuration is via environment variables — see [.env.example](.env.example). Operational settings (hotel name, WhatsApp number, accepted location types, required checkout fields, extra charges, pausing orders) are edited by an administrator in **Painel → Definições**.

Never commit `.env`, the `data/` database, `uploads/` or backups (all are git-ignored).

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — design decisions, security model, hosting comparison
- [docs/DATABASE.md](docs/DATABASE.md) — schema, migrations, access control, backups
- [docs/WHATSAPP.md](docs/WHATSAPP.md) — link vs. Cloud API, setup, limitations
- [docs/PLESK.md](docs/PLESK.md) — step-by-step hosting on Plesk
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — deployment overview and go-live checklist
- [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md) — done, tested, pending, blockers
