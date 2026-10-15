/**
 * Ordered, append-only schema migrations. Never edit a migration that has
 * shipped; add a new one instead. The applied version is stored in
 * SQLite's `PRAGMA user_version`.
 */

const NOW = "(strftime('%Y-%m-%dT%H:%M:%fZ','now'))";

export const MIGRATIONS: readonly string[] = [
  /* 1 — initial schema */ `
  CREATE TABLE staff (
    id             INTEGER PRIMARY KEY,
    email          TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    display_name   TEXT    NOT NULL,
    role           TEXT    NOT NULL CHECK (role IN ('admin','reception','restaurant')),
    password_hash  TEXT    NOT NULL,
    is_active      INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
    last_login_at  TEXT,
    created_by     INTEGER REFERENCES staff(id) ON DELETE SET NULL,
    created_at     TEXT    NOT NULL DEFAULT ${NOW},
    updated_at     TEXT    NOT NULL DEFAULT ${NOW}
  );

  CREATE TABLE sessions (
    token_hash    TEXT    PRIMARY KEY,
    staff_id      INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    created_at    TEXT    NOT NULL DEFAULT ${NOW},
    expires_at    TEXT    NOT NULL,
    last_seen_at  TEXT    NOT NULL DEFAULT ${NOW}
  );
  CREATE INDEX idx_sessions_staff ON sessions(staff_id);
  CREATE INDEX idx_sessions_expires ON sessions(expires_at);

  CREATE TABLE categories (
    id           INTEGER PRIMARY KEY,
    name         TEXT    NOT NULL CHECK (json_valid(name)),
    description  TEXT    CHECK (description IS NULL OR json_valid(description)),
    sort_order   INTEGER NOT NULL DEFAULT 0,
    is_active    INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
    created_at   TEXT    NOT NULL DEFAULT ${NOW},
    updated_at   TEXT    NOT NULL DEFAULT ${NOW}
  );

  CREATE TABLE products (
    id            INTEGER PRIMARY KEY,
    category_id   INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
    name          TEXT    NOT NULL CHECK (json_valid(name)),
    description   TEXT    CHECK (description IS NULL OR json_valid(description)),
    image_path    TEXT,
    price_cents   INTEGER NOT NULL CHECK (price_cents >= 0),
    currency      TEXT    NOT NULL DEFAULT 'MZN',
    is_available  INTEGER NOT NULL DEFAULT 1 CHECK (is_available IN (0,1)),
    is_archived   INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0,1)),
    sort_order    INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT    NOT NULL DEFAULT ${NOW},
    updated_at    TEXT    NOT NULL DEFAULT ${NOW}
  );
  CREATE INDEX idx_products_category ON products(category_id, sort_order);

  CREATE TABLE option_groups (
    id          INTEGER PRIMARY KEY,
    product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    name        TEXT    NOT NULL CHECK (json_valid(name)),
    min_select  INTEGER NOT NULL DEFAULT 0 CHECK (min_select >= 0),
    max_select  INTEGER NOT NULL DEFAULT 1 CHECK (max_select >= 1 AND max_select >= min_select),
    sort_order  INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_option_groups_product ON option_groups(product_id);

  CREATE TABLE options (
    id                 INTEGER PRIMARY KEY,
    group_id           INTEGER NOT NULL REFERENCES option_groups(id) ON DELETE CASCADE,
    name               TEXT    NOT NULL CHECK (json_valid(name)),
    price_delta_cents  INTEGER NOT NULL DEFAULT 0 CHECK (price_delta_cents >= 0),
    is_available       INTEGER NOT NULL DEFAULT 1 CHECK (is_available IN (0,1)),
    sort_order         INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_options_group ON options(group_id);

  CREATE TABLE orders (
    id               INTEGER PRIMARY KEY,
    reference        TEXT    NOT NULL UNIQUE,
    public_token     TEXT    NOT NULL UNIQUE,
    idempotency_key  TEXT    NOT NULL UNIQUE,
    request_hash     TEXT    NOT NULL,
    status           TEXT    NOT NULL CHECK (status IN ('PENDING','CONFIRMED','PREPARING','READY','COMPLETED','CANCELLED')),
    location_type    TEXT    NOT NULL CHECK (location_type IN ('room','table')),
    location_label   TEXT    NOT NULL,
    guest_name       TEXT,
    contact_phone    TEXT,
    notes            TEXT,
    language         TEXT    NOT NULL,
    currency         TEXT    NOT NULL,
    subtotal_cents   INTEGER NOT NULL CHECK (subtotal_cents >= 0),
    charges_cents    INTEGER NOT NULL DEFAULT 0 CHECK (charges_cents >= 0),
    charges_json     TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(charges_json)),
    total_cents      INTEGER NOT NULL CHECK (total_cents = subtotal_cents + charges_cents),
    created_at       TEXT    NOT NULL DEFAULT ${NOW},
    updated_at       TEXT    NOT NULL DEFAULT ${NOW}
  );
  CREATE INDEX idx_orders_status_created ON orders(status, created_at);
  CREATE INDEX idx_orders_created ON orders(created_at);

  CREATE TABLE order_items (
    id                INTEGER PRIMARY KEY,
    order_id          INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id        INTEGER REFERENCES products(id) ON DELETE SET NULL,
    product_name      TEXT    NOT NULL,
    unit_price_cents  INTEGER NOT NULL CHECK (unit_price_cents >= 0),
    quantity          INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 100),
    options_json      TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(options_json)),
    notes             TEXT,
    line_total_cents  INTEGER NOT NULL CHECK (line_total_cents = unit_price_cents * quantity)
  );
  CREATE INDEX idx_order_items_order ON order_items(order_id);

  CREATE TABLE order_status_history (
    id           INTEGER PRIMARY KEY,
    order_id     INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    from_status  TEXT,
    to_status    TEXT    NOT NULL,
    staff_id     INTEGER REFERENCES staff(id) ON DELETE SET NULL,
    note         TEXT,
    created_at   TEXT    NOT NULL DEFAULT ${NOW}
  );
  CREATE INDEX idx_status_history_order ON order_status_history(order_id);

  CREATE TABLE integration_events (
    id           INTEGER PRIMARY KEY,
    order_id     INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    integration  TEXT    NOT NULL,
    channel      TEXT    NOT NULL CHECK (channel IN ('link','cloud_api')),
    status       TEXT    NOT NULL CHECK (status IN ('pending','link_ready','link_opened','sent','failed','not_configured')),
    attempts     INTEGER NOT NULL DEFAULT 0,
    last_error   TEXT,
    external_id  TEXT,
    created_at   TEXT    NOT NULL DEFAULT ${NOW},
    updated_at   TEXT    NOT NULL DEFAULT ${NOW},
    UNIQUE (order_id, integration)
  );

  CREATE TABLE settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL CHECK (json_valid(value)),
    updated_at  TEXT NOT NULL DEFAULT ${NOW},
    updated_by  INTEGER REFERENCES staff(id) ON DELETE SET NULL
  );

  CREATE TABLE audit_log (
    id           INTEGER PRIMARY KEY,
    staff_id     INTEGER REFERENCES staff(id) ON DELETE SET NULL,
    action       TEXT    NOT NULL,
    entity_type  TEXT    NOT NULL,
    entity_id    TEXT,
    details      TEXT    CHECK (details IS NULL OR json_valid(details)),
    created_at   TEXT    NOT NULL DEFAULT ${NOW}
  );
  CREATE INDEX idx_audit_created ON audit_log(created_at);
  `,

  /* 2 — "Encomendar": scheduled orders, take-away with deposit, category availability windows.
     SQLite cannot alter a CHECK constraint, so the orders table is rebuilt
     (foreign keys are switched off around migrations by migrate()). */ `
  CREATE TABLE orders_v2 (
    id                    INTEGER PRIMARY KEY,
    reference             TEXT    NOT NULL UNIQUE,
    public_token          TEXT    NOT NULL UNIQUE,
    idempotency_key       TEXT    NOT NULL UNIQUE,
    request_hash          TEXT    NOT NULL,
    status                TEXT    NOT NULL CHECK (status IN ('PENDING','CONFIRMED','PREPARING','READY','COMPLETED','CANCELLED')),
    location_type         TEXT    NOT NULL CHECK (location_type IN ('room','table','takeaway')),
    location_label        TEXT    NOT NULL,
    scheduled_for         TEXT,
    guest_name            TEXT,
    contact_phone         TEXT,
    notes                 TEXT,
    language              TEXT    NOT NULL,
    currency              TEXT    NOT NULL,
    subtotal_cents        INTEGER NOT NULL CHECK (subtotal_cents >= 0),
    charges_cents         INTEGER NOT NULL DEFAULT 0 CHECK (charges_cents >= 0),
    charges_json          TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(charges_json)),
    total_cents           INTEGER NOT NULL CHECK (total_cents = subtotal_cents + charges_cents),
    deposit_cents         INTEGER NOT NULL DEFAULT 0 CHECK (deposit_cents >= 0 AND deposit_cents <= total_cents),
    deposit_status        TEXT    NOT NULL DEFAULT 'not_required' CHECK (deposit_status IN ('not_required','pending','confirmed')),
    payment_reference     TEXT,
    deposit_confirmed_at  TEXT,
    deposit_confirmed_by  INTEGER REFERENCES staff(id) ON DELETE SET NULL,
    created_at            TEXT    NOT NULL DEFAULT ${NOW},
    updated_at            TEXT    NOT NULL DEFAULT ${NOW}
  );
  INSERT INTO orders_v2 (id, reference, public_token, idempotency_key, request_hash, status, location_type, location_label,
    guest_name, contact_phone, notes, language, currency, subtotal_cents, charges_cents, charges_json, total_cents, created_at, updated_at)
  SELECT id, reference, public_token, idempotency_key, request_hash, status, location_type, location_label,
    guest_name, contact_phone, notes, language, currency, subtotal_cents, charges_cents, charges_json, total_cents, created_at, updated_at
  FROM orders;
  DROP TABLE orders;
  ALTER TABLE orders_v2 RENAME TO orders;
  CREATE INDEX idx_orders_status_created ON orders(status, created_at);
  CREATE INDEX idx_orders_created ON orders(created_at);
  CREATE INDEX idx_orders_scheduled ON orders(scheduled_for) WHERE scheduled_for IS NOT NULL;

  ALTER TABLE categories ADD COLUMN available_from TEXT;
  ALTER TABLE categories ADD COLUMN available_until TEXT;
  `,

  /* 3 — chat between guest and staff (per order) and the daily summary log. */ `
  CREATE TABLE order_messages (
    id          INTEGER PRIMARY KEY,
    order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    sender      TEXT    NOT NULL CHECK (sender IN ('guest','staff')),
    staff_id    INTEGER REFERENCES staff(id) ON DELETE SET NULL,
    body        TEXT    NOT NULL CHECK (length(body) BETWEEN 1 AND 1000),
    created_at  TEXT    NOT NULL DEFAULT ${NOW},
    -- When the other side read it (staff for guest messages, guest for staff messages).
    read_at     TEXT
  );
  CREATE INDEX idx_messages_order ON order_messages(order_id, id);
  CREATE INDEX idx_messages_unread ON order_messages(sender, read_at);

  CREATE TABLE daily_summaries (
    day         TEXT    PRIMARY KEY,
    status      TEXT    NOT NULL CHECK (status IN ('pending','sent','failed','skipped')),
    channels    TEXT,
    attempts    INTEGER NOT NULL DEFAULT 0,
    last_error  TEXT,
    created_at  TEXT    NOT NULL DEFAULT ${NOW},
    updated_at  TEXT    NOT NULL DEFAULT ${NOW}
  );
  `,

  /* 4 — access profiles (roles with editable permissions). Staff are moved
     from the fixed admin/reception/restaurant roles to role rows. */ `
  CREATE TABLE roles (
    id           INTEGER PRIMARY KEY,
    name         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    description  TEXT,
    permissions  TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(permissions)),
    is_system    INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0,1)),
    created_at   TEXT    NOT NULL DEFAULT ${NOW},
    updated_at   TEXT    NOT NULL DEFAULT ${NOW}
  );
  INSERT INTO roles (id, name, description, permissions, is_system) VALUES
    (1, 'Administrador', 'Acesso total ao sistema', '["*"]', 1),
    (2, 'Gerente', 'Tudo excepto equipa, definições e registo',
      '["orders.view","orders.status","orders.cancel","orders.deposit","chat.reply","orders.pause","menu.availability","menu.edit","menu.prices","reports.view","reports.export"]', 0),
    (3, 'Recepção', 'Pedidos, chat, menu, preços e relatórios',
      '["orders.view","orders.status","orders.cancel","orders.deposit","chat.reply","orders.pause","menu.availability","menu.edit","menu.prices","reports.view"]', 0),
    (4, 'Cozinha', 'Igual à recepção',
      '["orders.view","orders.status","orders.cancel","orders.deposit","chat.reply","orders.pause","menu.availability","menu.edit","menu.prices","reports.view"]', 0);

  CREATE TABLE staff_v2 (
    id             INTEGER PRIMARY KEY,
    email          TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    display_name   TEXT    NOT NULL,
    role_id        INTEGER NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    password_hash  TEXT    NOT NULL,
    is_active      INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
    last_login_at  TEXT,
    created_by     INTEGER REFERENCES staff(id) ON DELETE SET NULL,
    created_at     TEXT    NOT NULL DEFAULT ${NOW},
    updated_at     TEXT    NOT NULL DEFAULT ${NOW}
  );
  INSERT INTO staff_v2 (id, email, display_name, role_id, password_hash, is_active, last_login_at, created_by, created_at, updated_at)
  SELECT id, email, display_name, CASE role WHEN 'admin' THEN 1 WHEN 'reception' THEN 3 ELSE 4 END,
    password_hash, is_active, last_login_at, created_by, created_at, updated_at
  FROM staff;
  DROP TABLE staff;
  ALTER TABLE staff_v2 RENAME TO staff;
  CREATE INDEX idx_staff_role ON staff(role_id);
  `,

  /* 5 — simple stock: optional quantity per product (NULL = not tracked), and
     how much each order line took from it so a cancellation can give it back. */ `
  ALTER TABLE products ADD COLUMN stock_qty INTEGER CHECK (stock_qty IS NULL OR stock_qty >= 0);
  ALTER TABLE order_items ADD COLUMN stock_taken INTEGER NOT NULL DEFAULT 0 CHECK (stock_taken >= 0);
  `,
];
