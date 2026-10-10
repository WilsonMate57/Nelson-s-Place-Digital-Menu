# WhatsApp order forwarding

Every order is **saved in the database first** and appears on the staff dashboard regardless of WhatsApp. WhatsApp is an additional notification channel, implemented in `src/server/whatsapp/` and decoupled from order processing. A WhatsApp failure never changes, duplicates or deletes an order.

The hotel's destination number is set by an administrator in **Painel → Definições → WhatsApp** (international format, digits only, e.g. `2588XXXXXXXX`). It is **not configured yet** — the hotel must confirm the official number.

The mode is chosen on the server with `WHATSAPP_MODE`:

## Mode 1 — `link` (default, no credentials)

After the order is saved, the guest's confirmation screen shows **"Enviar também por WhatsApp (opcional)"**. Tapping it opens WhatsApp on the guest's phone with a prefilled message (built on the server from the stored order) addressed to the hotel's number. The guest must tap **Send** in WhatsApp.

Limitations (shown to guests and staff):
- The server **cannot know whether the message was sent**. It records only `link_ready` (button shown) and `link_opened` (guest tapped it). The dashboard says "Aberto pelo hóspede — envio não confirmado".
- It depends on the guest having WhatsApp and choosing to send.
- No automatic retry is possible. Staff can instead use **Copiar mensagem** or **Encaminhar no WhatsApp** in the order detail to forward the order text themselves (e.g. to a kitchen group).

This is why the dashboard, not WhatsApp, is the primary way staff receive orders.

## Mode 2 — `cloud_api` (automatic, server-side)

The server sends each new order to the hotel's number through the official **WhatsApp Business Platform (Cloud API)**:
`POST https://graph.facebook.com/{WHATSAPP_API_VERSION}/{WHATSAPP_PHONE_NUMBER_ID}/messages` with a Bearer token.

Business-initiated messages must use a **pre-approved message template**, so the server sends a template with 5 body variables.

### Setup (requires the hotel's Meta Business account)

1. Create/verify a Meta Business account and a WhatsApp Business Account (WABA) in Meta's developer dashboard.
2. Register a **sending phone number** for the Cloud API (a number dedicated to the API; check Meta's current rules on using the same number in the WhatsApp Business app). Note its **Phone number ID**.
3. Create a **System User** with a **permanent access token** that has `whatsapp_business_messaging` permission. Store it only in the server environment.
4. In WhatsApp Manager, create a template, category **Utility**, language **Portuguese (Portugal)** (`pt_PT`) or (Brazil) (`pt_BR`), e.g. name `novo_pedido`:

   ```
   Novo pedido {{1}}
   Local: {{2}}
   Artigos: {{3}}
   Total: {{4}}
   {{5}}
   ```
   Variables: `{{1}}` reference, `{{2}}` location + guest name, `{{3}}` items (one line, `;`-separated), `{{4}}` total, `{{5}}` notes and dashboard link (or `-`). Wait for approval.
5. Set the environment variables and restart:

   ```
   WHATSAPP_MODE=cloud_api
   WHATSAPP_CLOUD_API_TOKEN=<permanent token>
   WHATSAPP_PHONE_NUMBER_ID=<phone number id>
   WHATSAPP_API_VERSION=v21.0          # use a currently supported Graph API version
   WHATSAPP_TEMPLATE_NAME=novo_pedido
   WHATSAPP_TEMPLATE_LANGUAGE=pt_PT
   PUBLIC_BASE_URL=https://<menu domain>   # used for the dashboard link
   ```
   The server refuses to start in `cloud_api` mode if the token, phone number ID or template name is missing.
6. Set the hotel's destination number in Definições, place a test order and check the order's WhatsApp status in the dashboard.

### Behaviour

| Status | Meaning |
| --- | --- |
| `pending` | Send in progress (or queued) |
| `sent` | Accepted by the Cloud API (HTTP 2xx, message id stored). Delivery to the phone is not tracked (webhooks not implemented). |
| `failed` | API error or network failure; sanitised error stored (never the token) |
| `not_configured` | No hotel number in Definições |

- One automatic attempt after the order is saved; staff can press **Reenviar automaticamente** for `failed`/`not_configured`.
- Double sending is prevented by an atomic claim on the integration record; a `sent` message is never re-sent. An attempt stuck in `pending` for more than 2 minutes (e.g. process restart) becomes retryable.
- Template variables are flattened (no newlines/tabs, no runs of 5+ spaces, ≤ 900 chars), as Meta requires.

### Costs

Meta charges per delivered template message, with rates that vary by country and category. Check current WhatsApp Business Platform pricing for Mozambique before enabling. Link mode is free.

### Verification status

The Cloud API sender is covered by **automated tests with a mocked HTTP client only** (success, API error, network error, retry, no double-send). It has **not** been tested against Meta's real API because no credentials exist yet. Do a supervised test with real credentials before relying on it.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Guest sees no WhatsApp button | Mode is `link` and a number is set in Definições? |
| Status `not_configured` | Set the hotel number in Definições, then retry (cloud_api) |
| `HTTP 401` / code 190 | Token expired or wrong — use a System User permanent token |
| Code 131030 (recipient not allowed) | The app is in development mode: add the destination number to the allowed list, or go live |
| Code 132001 (template does not exist) | Template name/language mismatch or not approved |
| Code 132000 (parameter count) | Template must have exactly 5 body variables |
| Timeouts | Server's outbound HTTPS to `graph.facebook.com` blocked by firewall |

Error codes above are as documented by Meta at the time of writing; consult Meta's error reference for current meanings.
