# Architecture

## 1. Context

A small apart-hotel needs guests (on their own phones, via QR codes in rooms/tables) to browse the menu and order, and staff (reception/restaurant) to receive and process those orders. Traffic is low (tens to a few hundred orders a day at most). Priorities: reliability, low and predictable cost, security, simple maintenance, good performance on modest phones and unstable mobile data.

The original prototype (`legacy/prototype/`) was static HTML + Bootstrap with demo data and a Firebase plan that was never implemented. Its visual identity (dark green / gold / cream, Playfair Display + DM Sans), copy, data model ideas and business rules were carried over.

## 2. Decision: Node + SQLite on the hotel's VPS/Plesk

Decided with the project owner on 2026-10-09. Options considered:

| | **Node + SQLite on existing VPS (chosen)** | Supabase (managed Postgres) | Firebase (Firestore + Functions) |
| --- | --- | --- | --- |
| Monthly cost | No additional cost if the VPS/Plesk already exists | Free tier pauses after 7 days of inactivity and has no backups; Pro ≈ US$25/month | Functions require the pay-as-you-go plan (card on file); likely near US$0 at this volume |
| Server-side order validation | Plain TypeScript in the API | Postgres function or Edge Function | Cloud Function |
| Testable locally here | Fully (Node only) | Needs Docker | Needs Java (emulator) |
| Backups | Our responsibility (`npm run db:backup` + off-site copy) | Included on Pro | Managed export (paid storage) |
| Vendor lock-in | None (single SQLite file, standard SQL) | Low–medium | High (Firestore model) |
| Ops burden | We patch Node/OS and watch the process | Low | Low |
| Real-time | Polling (sufficient) | Built-in | Built-in |

Prices are approximate; check current pricing before relying on them.

Reasoning: the planning documents already pointed at a VPS/Plesk, the volume fits SQLite comfortably (one writer at a time; each order is a sub-millisecond transaction), and it keeps the hotel independent of third-party free-tier policies. The trade-off is that **backups and server upkeep are on us** — see docs/DEPLOYMENT.md.

Migration path if the hotel outgrows this: the data layer is isolated in `src/server/repositories/`; moving to PostgreSQL means rewriting those classes and the migrations, not the business logic.

## 3. System overview

```
 Guest phone ──HTTPS──┐                         ┌── SQLite file (data/*.db, WAL)
 (QR → /?t=room&loc=12)│   Plesk nginx (TLS)    │
                       ├──► Node process ───────┼── uploads/products/*.webp
 Staff browser ──HTTPS─┘   Hono app             │
 (/admin/, polls 10 s)     • static dist/client └── WhatsApp Cloud API (optional,
                           • /api/* JSON              server-side, HTTPS)
 Guest's WhatsApp ◄── wa.me link (link mode, opened by the guest)
```

One Node process serves the built frontend, the JSON API and uploaded images.

### Module boundaries

| Concern | Location |
| --- | --- |
| Presentation | `src/client/guest`, `src/client/admin`, `src/client/components` |
| Shared business rules | `src/shared/` (zod schemas, `priceOrder`, status transitions, WhatsApp message) |
| HTTP, auth, CSRF, rate limits, errors | `src/server/http/`, `src/server/routes/` |
| Business logic | `src/server/services/` (orders, auth, image storage) |
| Data access | `src/server/repositories/` (the only place with SQL) |
| WhatsApp integration | `src/server/whatsapp/` |
| Configuration | `src/server/config.ts` (env vars) + `settings` table (admin-editable) |

### Order flow

1. Guest builds a cart (stored in `localStorage` as product/option **ids only**; prices are always recomputed from the current menu).
2. Checkout `POST /api/orders` with an `idempotencyKey` (UUID generated per distinct submission content and reused on retries).
3. Server, in **one transaction**: idempotency check → settings checks (ordering paused, location type, required fields) → load orderable products → `priceOrder()` (availability, option rules, totals, charges) → insert order, item snapshots, status history, WhatsApp integration record.
4. After commit: in `cloud_api` mode the WhatsApp send runs asynchronously and records its result; in `link` mode the response carries a `wa.me` URL built from the stored order.
5. Guest sees the confirmation with reference and live status (polls `GET /api/orders/track/:token` every 15 s; the token is a random 144-bit secret).
6. Staff dashboard polls every 10 s, highlights new orders (toast, optional chime, tab title count), and moves the order through `PENDING → CONFIRMED → PREPARING → READY → COMPLETED` (or `CANCELLED`). Updates use compare-and-set on the expected status so two staff members cannot overwrite each other.

### Why polling instead of WebSockets/SSE

Plesk usually runs Node behind nginx + Passenger, where long-lived connections need extra proxy configuration and are fragile. A 10-second poll of a small indexed query is cheap, robust on bad networks, and resumes immediately when a tab becomes visible again. SSE can be added later if needed.

## 4. Security model

- **Authoritative server**: prices, totals, availability, option rules and roles are enforced on the server. The client's cart total is an estimate.
- **Authentication**: scrypt password hashes (N=16384); constant-time comparison; a dummy hash keeps response time the same for unknown emails. Sessions are 256-bit random tokens; only their SHA-256 is stored. Cookie: `HttpOnly; SameSite=Strict; Path=/api; Secure` (production). Sessions expire (default 12 h), are revoked on logout and when a user is deactivated, and other sessions are revoked on password change.
- **Authorization**: `requireStaff` on every `/api/admin/*` route plus a named permission (`requirePermission`). Permissions (`src/shared/permissions.ts`) are grouped into editable access profiles (roles table); defaults: Administrador (all, locked), Gerente, Recepção, Cozinha. Price changes require `menu.prices` even within a product edit; cancelling requires `orders.cancel` separately from advancing the status. Any change that would leave no active user able to manage staff is rolled back.
- **CSRF**: SameSite=Strict cookie, plus a required custom header (`X-NP-Request: 1`) on authenticated state-changing requests (cross-site forms cannot set it; CORS is not enabled).
- **Abuse protection**: in-memory rate limits — orders 30 per 10 min per IP (generous because guests share the hotel Wi-Fi), status tracking 300 per 10 min, login 30 per 15 min per IP and 8 per 15 min per account. Body size limits on all endpoints.
- **Input**: zod validation of every request; control characters stripped; location labels restricted to letters/digits/space/`._-/#`. All SQL is parameterised. React escapes output.
- **Uploads**: admin-only, ≤ 3 MB, type detected by magic bytes (JPEG/PNG/WebP), random UUID filename, served with `nosniff`. Images are downscaled in the browser before upload.
- **Headers**: strict CSP (`script-src 'self'`, no third-party origins; fonts are self-hosted), `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, HSTS in production, `Cache-Control: no-store` on the API.
- **Secrets**: only in env vars on the server. The client bundle is checked for secrets in testing.
- **Errors**: clients receive safe messages and codes; stack traces are only logged on the server.
- **Audit**: price/menu/staff/settings changes, logins and WhatsApp retries are written to `audit_log`.

SQLite has no row-level security; access control is enforced in the API, and the database file must not be reachable from the web (it lives outside `dist/client`, see DEPLOYMENT.md).

## 5. Localisation and time

- Guest UI: Portuguese (Mozambique) by default; English built in; French, Spanish, German, Russian, Afrikaans and isiZulu in `src/client/guest/locales/`, downloaded only when chosen (machine-assisted, pending native review). Product/category content has `pt` (required) and optional fields for every language; untranslated content falls back to English, then Portuguese.
- Admin UI and WhatsApp messages: Portuguese (read by staff). Item names are snapshotted in Portuguese.
- Currency: MZN, stored as integer centavos, displayed as `650 MT` (symbol configurable).
- Time: stored as UTC ISO-8601; displayed in `Africa/Maputo` (UTC+2, no DST). Order references use the Maputo date: `NP-YYMMDD-XXXX`.

## 6. Performance

- Guest page: ~11 KB gzip app code + ~70 KB gzip React runtime; admin code is a separate bundle (~15 KB gzip) never loaded by guests. Hashed assets are cached for a year.
- Fonts self-hosted (Latin subset only), no CDN dependency.
- Product images are lazy-loaded and resized to ≤ 1200 px WebP at upload.
- SQLite queries are indexed for the dashboard's status/date filters.
