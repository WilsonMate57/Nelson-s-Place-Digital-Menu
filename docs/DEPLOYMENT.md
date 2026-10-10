# Deployment

Target: the hotel's existing VPS with Plesk (Node.js extension), behind Plesk's nginx with HTTPS. Nothing has been deployed yet; no domain, server or paid service has been set up as part of this work.

## Requirements

- Node.js **22.9+** (22 LTS or 24 LTS). `better-sqlite3` ships prebuilt binaries for Linux x64/arm64 (glibc and musl); no compiler is needed on those platforms.
- A (sub)domain with a TLS certificate (Plesk → Let's Encrypt), e.g. `menu.<hotel-domain>`.
- Persistent disk for the database (`data/`), uploads (`uploads/`) and backups.
- Outbound HTTPS to `graph.facebook.com` only if using WhatsApp `cloud_api` mode.

## Build

Build on the server or on a build machine:

```bash
npm ci                 # includes dev dependencies needed for the build
npm run check          # typecheck, lint, tests, build
```

Deploy (or keep on the server): `package.json`, `package-lock.json`, `node_modules/` (production deps: `npm ci --omit=dev` after building), `dist/`. **Do not** put `data/`, `uploads/`, `.env` or backups inside the public document root.

## Plesk setup

Follow the step-by-step guide in **[PLESK.md](PLESK.md)**. Key points:

- Startup file `app.cjs` (CommonJS wrapper that Passenger can `require()`); document root `plesk-public` (empty, so every request goes through the app and gets the security headers).
- Database, uploads and backups under the subscription's `private/` folder, configured with absolute paths in the environment variables.
- `NODE_ENV=production`, `TRUST_PROXY=true`, `PUBLIC_BASE_URL`; do not set `PORT`.
- **Run a single application process**: rate limiting is in-memory per process.
- HTTPS enforced; cookies are HTTPS-only in production.

Plain VPS without Plesk: run `npm start` (which starts `app.cjs`) under systemd (or pm2) with the same environment, behind nginx/Caddy terminating TLS and proxying to `127.0.0.1:3000` with `X-Forwarded-For`.

## First administrator

On the server (SSH, in the application root, with the same environment variables):

```bash
npm run admin:create -- --email gerente@<domain> --name "Nome Apelido"
```

The password is asked with a hidden prompt (min. 10 characters). Then sign in at `/admin/` and create accounts for reception/restaurant staff in **Equipa** (one account per person).

## Menu content

Production starts with an **empty menu**. An administrator creates categories and products in **Painel → Menu**. Use only approved prices and real, authorised photographs. (`db:seed-demo` refuses to run in production unless forced; do not use it on the live database.)

## Backups

```bash
# daily, e.g. Plesk → Tools & Settings → Scheduled Tasks, run in the application root:
npm run db:backup -- --dir /var/backups/nelsons-menu --keep 14
```

Also back up `uploads/`, and copy both off the server (Plesk Backup Manager with remote FTP/S3 storage, or similar). **Test a restore** (see docs/DATABASE.md).

## QR codes

Generate one QR code per room/table pointing at:

- Rooms/apartments: `https://menu.<domain>/?t=room&loc=<number>`
- Tables: `https://menu.<domain>/?t=table&loc=<number>`

The location is pre-filled but the guest confirms it at checkout. Test each printed code on Android and iPhone. (QR generation is not part of the app; any reputable generator works, preferably one that does not use redirect URLs.)

## Go-live checklist

- [ ] Hotel confirmed: real menu, prices, options, photos; demo data not present
- [ ] Hotel confirmed: WhatsApp number (set in Definições); test order shows the WhatsApp button
- [ ] Hotel confirmed: rooms and/or tables, required checkout fields, any service/delivery charges (Definições), opening hours process (use "Pedidos pausados" toggle)
- [ ] HTTPS works; HTTP redirects to HTTPS; `/api/health` OK
- [ ] `NODE_ENV=production`, `TRUST_PROXY=true`, `PUBLIC_BASE_URL` set, single process
- [ ] `data/`, `uploads/`, `.env` are not web-accessible (try `https://menu.<domain>/data/nelsons-place.db` → 404)
- [ ] Admin account created with a strong password; staff accounts per person
- [ ] Daily backups scheduled, copied off-site, restore tested
- [ ] Place a test order from a phone on mobile data and on hotel Wi-Fi; process it end to end in the dashboard
- [ ] Reception PC/tablet keeps `/admin/` open with sound alert enabled ("Som ligado")
- [ ] Staff trained: status workflow, sold-out toggle, pausing orders, what "WhatsApp: aberto pelo hóspede" means
- [ ] Privacy: agree on retention of guest names/phones
- [ ] If using WhatsApp Cloud API: template approved, credentials set, supervised test done (docs/WHATSAPP.md)

## Updating

```bash
git pull            # or upload the new build
npm ci && npm run build && npm ci --omit=dev
# back up the database first if the release contains a migration
# restart the app in Plesk (migrations run automatically on start)
```
