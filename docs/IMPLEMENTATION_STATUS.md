# Implementation status

_Last updated: 2026-10-10_

## Summary

The functional foundation is built and tested locally: guest menu, cart, validated checkout, persistent orders, staff dashboard with authentication and roles, order workflow, menu management and WhatsApp forwarding (link mode working; Cloud API implemented but unverified against Meta). **It has not been deployed.** Menu content is demo data. Hotel policies, the WhatsApp number and branding are pending.

## Done

| Area | Status |
| --- | --- |
| Project foundation (React + TS + Vite, Node + Hono + SQLite, ESLint, Vitest, Playwright) | Done |
| Design system (tokens, buttons, forms, cards, status badges, dialogs/sheets, toasts) from prototype branding | Done |
| Database schema + migrations, constraints, indexes | Done |
| Guest menu: categories with sticky nav, search (accent-insensitive), product cards, sold-out state, product options with min/max rules, item notes, quantities | Done |
| Persistent cart (localStorage, ids only, revalidated against current menu), estimated totals incl. configured charges | Done |
| Checkout: room/table (pre-filled from QR `?t=&loc=`), optional/required name and phone, notes, client + server validation | Done |
| Order submission: server-side pricing, idempotency, transactions, snapshots, reference `NP-YYMMDD-XXXX` | Done |
| Order confirmation + live status page (private token link; "O meu pedido" shortcut) | Done |
| Staff auth (scrypt, server sessions, logout, password change, admin reset), roles admin/reception/restaurant | Done |
| Order board: status filters with counts, search, date range, 10 s polling, new-order toast + optional chime + tab title count, detail, workflow buttons, cancel with reason, history, print ticket | Done |
| Menu management: categories CRUD, products CRUD/archive/restore, prices, options editor, availability toggle (all staff), photo upload with client-side resize | Done |
| Staff management, settings (hotel name, currency symbol, WhatsApp number, pause ordering, location types, required fields, charges), audit log | Done |
| WhatsApp: message builder, link mode, staff copy/forward, Cloud API template sender with retry and no-double-send | Done (Cloud API unverified — see below) |
| Security: headers/CSP, CSRF header, rate limits, upload validation, safe errors, secrets only server-side | Done |
| CLI: create admin, seed demo, online backup with rotation | Done |
| Docs: README, CLAUDE.md, ARCHITECTURE, DATABASE, WHATSAPP, DEPLOYMENT | Done |

## Test report (2026-10-10, Windows 11, Node 24.19)

| Check | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm run lint` | Pass (0 problems) |
| `npm test` — 60 tests, 6 files (unit + API integration on real in-memory SQLite) | **60 passed** |
| `npm run build` | Pass (guest JS ≈ 11 KB + 70 KB React runtime gzip; admin ≈ 15 KB gzip) |
| `npm run test:e2e` — 8 browser tests in Microsoft Edge against the production build | **8 passed** |
| `npm audit` | 0 vulnerabilities |
| Manual: production server smoke test (status codes, security headers, caching, 404 page, admin redirect) | Pass |
| Manual: client bundle scanned for secrets/server-only strings | None found |
| Manual: CLI tools (seed refuses in production, admin creation, backup) | Pass |
| Manual: dev mode (`tsx` server + Vite proxy) | Pass |

Coverage of the required verification list:

| # | Requirement | Evidence |
| --- | --- | --- |
| 1–2 | App starts; production build completes | smoke test, `npm run build`, e2e web server |
| 3 | Categories/products render | e2e (all viewports) |
| 4 | Unavailable products cannot be ordered | API test (sold-out, archived, inactive category) + e2e |
| 5 | Cart quantities/totals | e2e (1580 MT case, reload persistence) + pricing unit tests |
| 6 | Customisation validated | pricing unit tests (7 rejection cases), API test, e2e (required option) |
| 7 | Invalid checkout rejected | 8 API validation cases + e2e client validation |
| 8 | Server calculates totals | API test ignores client `totalCents`; pricing tests |
| 9 | Order persisted | API + e2e |
| 10 | No duplicates on repeated submissions | concurrent same-key API test; key reuse with other content → 409 |
| 11 | Order appears in dashboard | API + e2e |
| 12 | Unauthorized users blocked | API tests (no session, forged cookie, wrong password, missing CSRF header, non-admin role) + e2e |
| 13 | Status workflow enforced | API tests (full path, invalid skip, stale update) + e2e |
| 14 | WhatsApp message uses correct data | unit tests (message content, Maputo time, link encoding, template params) |
| 15 | WhatsApp failure keeps the order, no duplicates | API tests with **mocked** Cloud API (error, network failure, retry, no double send) |
| 16 | Loading/empty/success/error states | implemented; success/error covered by e2e; loading/empty states reviewed manually |
| 17 | Mobile/tablet/desktop | e2e at 375/768/1280 px: no horizontal overflow; screenshots reviewed |
| 18 | No secrets in client bundle | bundle scan |

**Not tested** (cannot be from this environment): real WhatsApp delivery (link or Cloud API), deployment on Plesk/Passenger, HTTPS/cookie `Secure` behaviour behind the proxy, Safari/iOS and low-end Android devices, real QR codes, backup restore on the server, behaviour under real network loss on phones.

## Real menu (2026-10-12)

The printed menu (9 photos) was transcribed to `menu-import/MENU_REVISAO.md` and `menu-import/menu-nelsons-place.json` (16 categories, 116 items, with side/size/pasta options). Import with `npm run db:import-menu`. **Not imported** (unreadable or uncertain): items hidden on page 1 (Early Bird, "Sc…", a starter, a salad), Red Bull, small water, 1 L soft drinks, juices, sparkling wine, ciders, aperitifs, digestifs, port, rum/tequila, and wines with uncertain names. Prices of imported items still need management confirmation. Corrections can be made in the dashboard.

## Pending business decisions (blockers for go-live)

1. **Real menu**: partially transcribed (see above); management must confirm prices, resolve the doubts in MENU_REVISAO.md and provide dish photos.
2. **WhatsApp number** of the hotel (international format), and whether automatic sending (Cloud API, paid per message, needs Meta Business verification) is wanted or the free link mode is enough.
3. **Ordering scope**: rooms/apartments, restaurant tables, or both; delivery vs. collection.
4. **Required guest data**: name and/or phone required?
5. **Charges and taxes**: service charge, delivery fee, whether prices include VAT (IVA). Currently none are applied.
6. **Opening hours / minimum order**: not implemented as rules; staff use the "Pedidos pausados" toggle. Confirm whether automatic hours are needed.
7. **Branding**: official logo, colours, photography. The "N" monogram and current palette are provisional (from the prototype).
8. **Languages**: PT + EN shipped. FR/ES needed? Provide verified translations.
9. **Hosting**: confirm VPS/Plesk details, domain/subdomain, Node version, backup destination.
10. **Data retention** for guest names/phones.

## Known limitations / technical follow-ups

- Rate limiting is in-memory: run a single process (see DEPLOYMENT.md).
- No WhatsApp delivery webhooks (Cloud API `sent` = accepted by Meta, not "read").
- No automatic opening hours, no table/room whitelist (labels are free text validated by pattern; the prototype's idea of per-location QR tokens is not implemented).
- No data-retention job.
- Admin UI is Portuguese only.

## Next recommended tasks

1. Collect the pending business information above (especially menu, WhatsApp number, rooms/tables).
2. Provision the Plesk Node app on a staging subdomain, follow DEPLOYMENT.md, and run the go-live checklist with a real phone.
3. Enter the real menu through the dashboard; replace the provisional branding when assets arrive.
4. Decide on WhatsApp Cloud API; if yes, set up Meta Business + template and do a supervised test.
5. Train reception/restaurant staff; pilot with a few rooms before printing all QR codes.
