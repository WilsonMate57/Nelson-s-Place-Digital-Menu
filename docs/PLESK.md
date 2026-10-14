# Hosting on Plesk — step by step

This guide deploys the app from GitHub to a Plesk server using Plesk's **Git** and **Node.js** features (Node runs under Phusion Passenger). Allow about an hour for the first deployment.

> Menu names and paths below use placeholders: replace `menu.example.co.mz` with your real (sub)domain, and `/var/www/vhosts/example.co.mz` with your domain's folder (shown in Plesk under the domain's *Hosting Settings*).

## 0. Before you start — check these

| Requirement | Where to check |
| --- | --- |
| Plesk with the **Node.js** extension and **Git** extension | Extensions → My Extensions |
| Node.js **22.9 or newer** (22 LTS or 24 LTS) | Tools & Settings → Updates → Add/Remove Components → Node.js support |
| **SSH access** to the subscription (strongly recommended) | Domain → Web Hosting Access → "Access to the server over SSH" = `/bin/bash` (needs a Plesk admin) |
| Linux server, x86-64 or ARM64 | `uname -m` over SSH |

Without SSH, see [Option B](#option-b-no-ssh-access) below.

## 1. Create the (sub)domain and HTTPS

1. **Websites & Domains → Add Subdomain** (e.g. `menu`) or Add Domain.
2. **SSL/TLS Certificates → Let's Encrypt** → issue a certificate (include `www` only if you use it).
3. **Hosting Settings** → tick **Permanent SEO-safe 301 redirect from HTTP to HTTPS**.

## 2. Pull the code from GitHub

1. Domain → **Git** → **Add Repository** → *Remote Git hosting*.
2. Repository URL: `https://github.com/WilsonMate57/Nelson-s-Place-Digital-Menu.git`
   (If the repository is private, use the SSH URL `git@github.com:WilsonMate57/Nelson-s-Place-Digital-Menu.git` and add the public key Plesk shows as a **Deploy key** in GitHub → Settings → Deploy keys, read-only.)
3. Deployment mode: **Manual** for now. Server path: a folder **outside** `httpdocs`, e.g. `/menu-app` → `/var/www/vhosts/example.co.mz/menu-app`.
4. Branch: `main`. Click **OK**, then **Pull now** / **Deploy now**.

## 3. Create the private data folders

Over SSH (or Plesk **File Manager**), create folders that are **not** web-accessible, under the subscription's `private` directory:

```bash
cd /var/www/vhosts/example.co.mz
mkdir -p private/nelsons-menu/data private/nelsons-menu/uploads private/nelsons-menu/backups
```

The database, uploaded photos and backups live here, so a new deployment of the code never touches them.

## 4. Configure the Node.js application

Domain → **Node.js** → **Enable Node.js**, then set:

| Field | Value |
| --- | --- |
| Node.js Version | 22.x (≥ 22.9) or 24.x |
| Package Manager | npm |
| Application Mode | `production` |
| Application Root | `/menu-app` |
| Document Root | `/menu-app/plesk-public` (an intentionally empty folder — every request then goes through the app, which adds the security headers) |
| Application Startup File | `app.cjs` |

**Custom environment variables** (click *specify*), using absolute paths:

| Name | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_PATH` | `/var/www/vhosts/example.co.mz/private/nelsons-menu/data/nelsons-place.db` |
| `UPLOADS_DIR` | `/var/www/vhosts/example.co.mz/private/nelsons-menu/uploads` |
| `STATIC_DIR` | `/var/www/vhosts/example.co.mz/menu-app/dist/client` |
| `PUBLIC_BASE_URL` | `https://menu.example.co.mz` |
| `TRUST_PROXY` | `true` |
| `WHATSAPP_MODE` | `link` |

Do not set `PORT` — Passenger handles it. Click **Apply**.

## 5. Install and build

### Option A — with SSH (recommended)

```bash
cd /var/www/vhosts/example.co.mz/menu-app
export PATH=/opt/plesk/node/22/bin:$PATH     # match the version chosen in step 4
node -v                                       # must print v22.9+ or v24
npm ci                                        # installs build tools too
npm run build
npm prune --omit=dev                          # remove build-only packages
```

`npm run build` must finish without errors. (`npm run check` additionally runs the tests if you want to verify the server itself.)

### Option B — no SSH access

1. In **Git → Repository settings**, enable **Additional deployment actions** (requires Plesk admin permission) with:
   ```bash
   export PATH=/opt/plesk/node/22/bin:$PATH
   npm ci && npm run build && npm prune --omit=dev
   mkdir -p tmp && touch tmp/restart.txt
   ```
   then **Deploy now**.
2. If deployment actions are not available, ask the server administrator for SSH or to run step 5A once. (The Node.js page's *NPM install* button alone is not enough, because the build tools are dev dependencies.)

## 6. Start and check

1. Node.js page → **Restart App**.
2. Open `https://menu.example.co.mz/api/health` → must show `{"ok":true}`.
3. Open `https://menu.example.co.mz/` → the menu loads (empty menu message until products are added).
4. Check that private files are not reachable: `https://menu.example.co.mz/private/nelsons-menu/data/nelsons-place.db` and `/.env` → **404**.

If you see a Passenger error page, see [Troubleshooting](#troubleshooting).

## 7. Create the first administrator

Over SSH, with the **same environment variables** as the app:

```bash
cd /var/www/vhosts/example.co.mz/menu-app
export PATH=/opt/plesk/node/22/bin:$PATH
export DATABASE_PATH=/var/www/vhosts/example.co.mz/private/nelsons-menu/data/nelsons-place.db
export NODE_ENV=production
npm run admin:create -- --email gerente@example.co.mz --name "Nome Apelido"
```

Type a password of at least 10 characters (hidden). Then sign in at `https://menu.example.co.mz/admin/`, and in the dashboard:

0. **Menu**: load the transcribed hotel menu once (empty database only):
   ```bash
   npm run db:import-menu -- --file menu-import/menu-nelsons-place.json
   ```
1. **Definições**: set the hotel's WhatsApp number, rooms/tables, required fields; leave charges empty unless approved.
2. **Menu**: review the imported items, fix pending doubts (menu-import/MENU_REVISAO.md) and add missing items and photos.
3. **Equipa**: create one account per reception/restaurant staff member.

(Without SSH: you can put the same commands in a one-off Git deployment action, using `ADMIN_PASSWORD=...` instead of the prompt — then **remove that action immediately** so the password is not stored.)

## 7b. Alternative: the menu in a sub-folder of the main site (e.g. `example.co.mz/menu`)

Use this instead of steps 1 and 4 when the menu lives at `https://example.co.mz/menu/` and the hotel's existing site stays in `httpdocs`. **Do not enable Node.js on the main domain's Node.js page** — that would hand the whole domain to the app.

1. Steps 2 and 3 as above: code in `/menu-app` (next to `httpdocs`, **not** inside it), data in `nelsons-menu/` next to it.
2. Create `/menu-app/.env` (File Manager → New file) — it is read by `app.cjs` and is not web-accessible:
   ```ini
   NODE_ENV=production
   BASE_PATH=/menu
   PUBLIC_BASE_URL=https://example.co.mz/menu
   TRUST_PROXY=true
   WHATSAPP_MODE=link
   DATABASE_PATH=/var/www/vhosts/example.co.mz/nelsons-menu/data/nelsons-place.db
   UPLOADS_DIR=/var/www/vhosts/example.co.mz/nelsons-menu/uploads
   STATIC_DIR=/var/www/vhosts/example.co.mz/menu-app/dist/client
   ```
3. Step 5 (install and build) as above.
4. Main domain → **Apache & nginx Settings → Additional nginx directives**:
   ```nginx
   location = /menu { return 301 /menu/; }
   location ^~ /menu/ {
       alias /var/www/vhosts/example.co.mz/menu-app/plesk-public/;
       passenger_enabled on;
       passenger_app_type node;
       passenger_startup_file app.cjs;
       passenger_app_root /var/www/vhosts/example.co.mz/menu-app;
       passenger_base_uri /menu;
       passenger_nodejs /opt/plesk/node/22/bin/node;
       client_max_body_size 5m;
   }
   ```
   `^~` stops Plesk's "serve static files directly" rules from looking for `/menu/assets/…` in `httpdocs`. Adjust the Node path to the installed version.
5. Open `https://example.co.mz/menu/api/health` → `{"ok":true}`; then `/menu/` and `/menu/admin/`. To restart the app after an update: `touch /var/www/vhosts/example.co.mz/menu-app/tmp/restart.txt`.
6. CLI commands (`admin:create`, `db:import-menu`, `db:backup`) read the same `.env`, so over SSH only `cd menu-app` and the `PATH` export are needed.
7. QR codes point to `https://example.co.mz/menu/?t=room&loc=<n>` / `?t=table&loc=<n>`.

If Plesk rejects the directives (e.g. `unknown directive "passenger_enabled"`), the server's nginx has no Passenger module; send the exact message to the developer — the fallback is a reverse proxy to the app running on a separate (sub)domain.

**Not verified** on a real Plesk server: the app side was tested locally under `/menu` (pages, API, photos, admin login cookie path, 404 page), the nginx block above was not.

## 8. Daily backups

Tools & Settings (or the subscription) → **Scheduled Tasks** → Add Task → *Run a command*, daily at e.g. 03:00:

```bash
cd /var/www/vhosts/example.co.mz/menu-app && PATH=/opt/plesk/node/22/bin:$PATH DATABASE_PATH=/var/www/vhosts/example.co.mz/private/nelsons-menu/data/nelsons-place.db NODE_ENV=production npm run db:backup -- --dir /var/www/vhosts/example.co.mz/private/nelsons-menu/backups --keep 14
```

Run it once manually and confirm a `.db` file appears in `backups/`. Also configure **Backup Manager** to copy the subscription (including `private/`) to **remote storage**, and test restoring once (docs/DATABASE.md).

## 9. Updating to a new version

1. Push to `main` on GitHub.
2. Back up the database (run the scheduled task manually) if the release changes the database.
3. Git → **Pull now** / **Deploy now** (Option B runs the build automatically).
4. With SSH: repeat step 5A, then **Restart App** (or `touch tmp/restart.txt`).

Optional: Git → *Automatic deployment* with the webhook URL Plesk shows, added in GitHub → Settings → Webhooks, to deploy on every push. Only do this once releases are tested before merging to `main`.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Passenger "Web application could not be started" | Open the details/log (Node.js page → logs, or `/var/www/vhosts/<domain>/logs/`). Usually missing `dist/` (build not run), a wrong startup file (must be `app.cjs`), or Node older than 22.9 (the npm scripts use `--env-file-if-exists`). |
| `Invalid environment configuration` in the log | A variable value is invalid (e.g. `PUBLIC_BASE_URL` must start with `https://`). |
| `Cannot find module 'better-sqlite3'` / `invalid ELF header` | `node_modules` was copied from Windows. Delete it and run `npm ci` on the server. |
| `SQLITE_CANTOPEN` | `DATABASE_PATH` folder missing or not writable by the subscription user. |
| Menu loads but the admin login never sticks | The site is being opened over `http://` — cookies are HTTPS-only in production. Use `https://`. |
| Log warns "Could not determine client IP addresses" | Set `TRUST_PROXY=true` (step 4). |
| Guests get "Demasiados pedidos" during normal use | Several Passenger processes or shared IP: ensure one app process (Apache & nginx Settings → additional nginx directives: `passenger_max_pool_size 1;` if your Plesk exposes Passenger directives). |
| Changes not visible after deploy | Rebuild (`npm run build`) and **Restart App**; hard-refresh the browser. |

## What has and has not been verified

- Verified locally: the build, the `app.cjs` startup file loaded through `require()` as Passenger does, and production mode behind a simulated proxy (`X-Forwarded-For`).
- **Not verified**: an actual Plesk/Passenger server (no access from the development environment). Plesk menu names can vary slightly between Plesk versions; if a field is named differently, follow the meaning in the tables above.
