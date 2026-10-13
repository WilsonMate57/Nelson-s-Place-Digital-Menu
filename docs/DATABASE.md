# Database

SQLite 3 (via `better-sqlite3`), one file at `DATABASE_PATH` (default `data/nelsons-place.db`). Opened with `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`, `synchronous=NORMAL`.

## Migrations

- Defined in `src/server/db/migrations.ts` as an ordered, **append-only** array of SQL scripts.
- The applied version is stored in `PRAGMA user_version`; pending migrations run automatically (each in its own transaction) whenever the server or a CLI tool opens the database.
- To change the schema: append a new script; never edit one that has already run in production. Back up before deploying a migration.

## Migration history

1. Initial schema.
2. "Encomendar" (2026-10-13): `orders` rebuilt to allow `location_type = 'takeaway'` and to add `scheduled_for`, `deposit_cents`, `deposit_status` (`not_required | pending | confirmed`), `payment_reference`, `deposit_confirmed_at`, `deposit_confirmed_by`; `categories` gained `available_from` / `available_until` (daily window, e.g. breakfast). Existing orders are copied unchanged. Foreign keys are switched off during each migration and checked with `foreign_key_check` before commit.

3. Chat and daily summary (2026-10-13): `order_messages` (one thread per order: `sender` guest/staff, `staff_id`, `body` ≤ 1000 chars, `read_at` = read by the other side) and `daily_summaries` (one row per hotel-local day: `status` pending/sent/failed/skipped, `channels`, `attempts`, `last_error`).

## Entity overview

```
categories 1─* products 1─* option_groups 1─* options
orders 1─* order_items         (product_id → products, ON DELETE SET NULL; snapshots kept)
orders 1─* order_status_history (staff_id → staff)
orders 1─* integration_events   (one row per order per integration, e.g. 'whatsapp')
staff  1─* sessions
settings (key/value JSON)        audit_log (staff_id → staff)
```

## Tables

All timestamps are UTC ISO-8601 text (`2026-10-09T10:30:00.000Z`). Booleans are `0/1` with CHECK constraints. Money is integer **centavos**.

### `categories`
| Column | Notes |
| --- | --- |
| `id` | PK |
| `name`, `description` | JSON `{pt, en?, fr?, es?}` (`pt` required; `json_valid` CHECK) |
| `sort_order`, `is_active` | Inactive categories (and their products) are hidden from guests and cannot be ordered |
| `created_at`, `updated_at` | |

A category can be deleted only if it has no products at all (`ON DELETE RESTRICT` + API check); otherwise deactivate it.

### `products`
| Column | Notes |
| --- | --- |
| `category_id` | FK → categories (RESTRICT) |
| `name`, `description` | Localised JSON |
| `image_path` | Relative path under `UPLOADS_DIR`, e.g. `products/<uuid>.webp`; served at `/uploads/...` |
| `price_cents` | ≥ 0 |
| `currency` | `MZN` |
| `is_available` | Sold-out toggle (any staff role) |
| `is_archived` | Soft delete; archived products disappear from the menu but past orders keep their snapshots |
| `sort_order`, timestamps | Index `(category_id, sort_order)` |

### `option_groups` / `options`
Per-product customisation. `option_groups.min_select` / `max_select` (CHECK `max ≥ min`, `max ≥ 1`); a group with `min_select ≥ 1` is required. `options.price_delta_cents ≥ 0` is added to the base price. Both cascade-delete with their product/group. Editing a product keeps the ids of groups/options that still exist, so carts referencing them remain valid.

### `orders`
| Column | Notes |
| --- | --- |
| `reference` | Unique, human-friendly: `NP-YYMMDD-XXXX` (Maputo date + 4 unambiguous chars) |
| `public_token` | Unique random secret (18 bytes, base64url) for the guest status page |
| `idempotency_key` | Unique UUID sent by the client; duplicates return the existing order |
| `request_hash` | SHA-256 of the submission content; same key with different content → 409 |
| `status` | `PENDING, CONFIRMED, PREPARING, READY, COMPLETED, CANCELLED` (CHECK) |
| `location_type`, `location_label` | `room`/`table` + label (e.g. `12`) |
| `guest_name`, `contact_phone`, `notes` | Optional by default (configurable as required) |
| `language`, `currency` | |
| `subtotal_cents`, `charges_cents`, `charges_json`, `total_cents` | CHECK `total = subtotal + charges`; `charges_json` snapshots applied surcharges |
| timestamps | Indexes `(status, created_at)`, `(created_at)` |

Orders are never deleted by the application.

### `order_items`
Snapshot per line: `product_id` (nullable, SET NULL if the product is ever hard-deleted), `product_name` (Portuguese), `unit_price_cents` (base + options), `quantity` (1–100), `options_json` (`[{optionId, groupName, name, priceDeltaCents}]`), `notes`, `line_total_cents` (CHECK `= unit × quantity`).

### `order_status_history`
Every transition with `from_status`, `to_status`, `staff_id` (NULL = created by the guest), optional `note` (e.g. cancellation reason).

### `integration_events`
One row per `(order_id, integration)` (UNIQUE). `channel` = `link` | `cloud_api`; `status` = `pending | link_ready | link_opened | sent | failed | not_configured`; `attempts`, sanitised `last_error`, `external_id` (WhatsApp message id). See docs/WHATSAPP.md for the state machine.

### `staff` / `sessions`
`staff.email` unique (case-insensitive), `role` ∈ `admin | reception | restaurant`, scrypt `password_hash`, `is_active`, `last_login_at`, `created_by`. `sessions.token_hash` is the SHA-256 of the cookie token (the token itself is never stored), with `expires_at`; expired sessions are purged at login.

### `settings`
Single row `key='general'` with validated JSON: `hotelName, currency, currencySymbol, whatsappNumber, ordersEnabled, ordersPausedMessage, locationTypes, requireGuestName, requireContactPhone, charges[]`. Re-validated on every read; invalid content falls back to safe defaults.

### `audit_log`
Append-only: `staff_id`, `action`, `entity_type`, `entity_id`, `details` JSON, `created_at`.

## Access control

SQLite has no users or row-level security. Protection comes from:
1. The database file is outside the web root and only the Node process can read it (file permissions on the server).
2. All access goes through the API, which enforces authentication, roles, validation and server-side pricing (see ARCHITECTURE.md §4).
3. Every query is parameterised.

## Backups and restore

- `npm run db:backup -- --dir backups --keep 14` uses SQLite's online backup API (consistent while the server is running) and keeps the newest N files.
- Schedule daily (Plesk → Scheduled Tasks, or cron) **and copy the backup folder off the server** (e.g. Plesk Backup Manager to remote storage). Back up `uploads/` too.
- Restore: stop the app, replace `DATABASE_PATH` with the backup file (delete stale `-wal`/`-shm` files next to it), start the app. Test a restore before go-live.

## Personal data

Only what is needed to fulfil an order: optional name, optional phone, room/table, notes. No payment data. Define a retention period with the hotel (e.g. anonymise guest name/phone after N months); not yet implemented.
