# CLAUDE.md — Nelson's Place Digital Menu

Durable instructions for AI-assisted work on this repository. Read README.md and docs/ before large changes.

## Commands

- `npm run check` — typecheck + lint + unit/integration tests + build. Run before declaring work done.
- `npm test` — Vitest (tests/). `npm run test:e2e` — Playwright in installed Edge (needs `npm run build` first).
- `npm run dev` — API (tsx watch, :3000) + Vite (:5173). CLI tools (`admin:create`, `db:seed-demo`, `db:backup`) run from `dist/`, so build first.
- Windows note: do not leave a shell `cd`'d inside `dist/` — Vite cannot empty the folder (EPERM).

## Architecture rules

- **Stack is decided**: React + TS + Vite frontend; Node + Hono + SQLite (better-sqlite3) backend, single process on the hotel's VPS/Plesk. Do not introduce Firebase/Supabase or another DB without an explicit decision (see docs/ARCHITECTURE.md).
- `src/shared/` holds business rules used by both sides (schemas, pricing, status workflow, WhatsApp message). Never duplicate these rules elsewhere.
- SQL only in `src/server/repositories/`. Business logic in `src/server/services/`. HTTP concerns in `src/server/http` and `routes/`.
- WhatsApp code stays in `src/server/whatsapp/`, decoupled from order creation. The order is always committed first.
- Schema changes: append a new entry to `src/server/db/migrations.ts`; never edit a shipped migration. Update docs/DATABASE.md.

## Security invariants (do not weaken)

- The server recalculates every price/total from the database (`priceOrder`); never trust client prices, totals, availability or roles.
- Orders are idempotent via `idempotencyKey` (unique). Same key + different content → 409.
- Admin routes require a session (`requireStaff`) and the `x-np-request: 1` header (CSRF defence); menu structure/prices/staff/settings require `admin` role. Enforcement is server-side; hiding UI is not security.
- Secrets only in env vars read by `src/server/config.ts`. Nothing secret in `src/client` or `src/shared`.
- Uploaded images are validated by magic bytes, stored with random names; SVG is not accepted.
- Never store more personal data than needed (name/phone are optional by default).

## Honesty rules

- Never claim a WhatsApp message was delivered unless the Cloud API accepted it (`sent`). In link mode the strongest state is `link_opened` ("opened by guest, delivery unconfirmed").
- The Cloud API sender is tested only with a mocked `fetch`; it has not been verified against Meta's API.
- Do not invent hotel policies (fees, taxes, hours, minimum order), contact numbers, logos or product photos. Demo data is clearly labelled "Artigo de demonstração".

## Conventions

- Money: integer centavos everywhere (`priceCents`, `totalCents`); format with `formatMoney`.
- Time: store UTC ISO strings; display in `Africa/Maputo` (UTC+2, no DST).
- Status codes are uppercase English constants (`PENDING`…); only labels are translated.
- Guest UI strings: `src/client/guest/i18n.ts` (pt reference + en). Admin UI is Portuguese.
- Match existing code style: small focused modules, explicit types, comments only where intent is non-obvious.
- Keep docs/IMPLEMENTATION_STATUS.md current when finishing a feature.
