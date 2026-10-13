import type { OrderDto } from "../../shared/types";
import { describeLocation, formatOrderDateTime } from "../../shared/whatsapp-message";
import { formatMoney } from "../../shared/money";

/**
 * Server-side delivery through the official WhatsApp Business Platform (Cloud API).
 *
 * Business-initiated messages must use a pre-approved message template, so this
 * sender fills the template's body variables. Endpoint and payload follow Meta's
 * documented `POST /{version}/{phone-number-id}/messages` API.
 *
 * NOT verified against the real API in this repository (no credentials available);
 * covered only by tests with a mocked `fetch`. See docs/WHATSAPP.md.
 */

export interface CloudApiConfig {
  token: string;
  phoneNumberId: string;
  apiVersion: string;
  templateName: string;
  templateLanguage: string;
}

export interface SendResult {
  ok: boolean;
  externalId: string | null;
  /** Sanitised error safe to store and show to staff. Never contains the token. */
  error: string | null;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Template variables cannot contain newlines/tabs or more than 4 consecutive spaces. */
export function sanitiseTemplateParam(value: string, maxLength = 900): string {
  const flat = value.replace(/[\r\n\t]+/g, " · ").replace(/ {2,}/g, " ").trim();
  return flat.length > maxLength ? `${flat.slice(0, maxLength - 1)}…` : flat;
}

/**
 * Body variables, in order, for the template documented in docs/WHATSAPP.md:
 * {{1}} reference, {{2}} location, {{3}} items, {{4}} total, {{5}} notes / dashboard link.
 */
export function templateParameters(order: OrderDto, currencySymbol: string, dashboardUrl: string | null): string[] {
  const items = order.items
    .map((i) => {
      const opts = i.options.length ? ` (${i.options.map((o) => o.name).join(", ")})` : "";
      return `${i.quantity}× ${i.productName}${opts}`;
    })
    .join("; ");
  const location = `${describeLocation(order.locationType, order.locationLabel)}${order.guestName ? ` — ${order.guestName}` : ""}`;
  const extra =
    [
      order.scheduledFor ? `ENCOMENDA PARA ${formatOrderDateTime(order.scheduledFor)}` : null,
      order.depositCents > 0 ? `Sinal ${formatMoney(order.depositCents, { symbol: currencySymbol })} (${order.depositStatus === "confirmed" ? "confirmado" : "por verificar"})` : null,
      order.notes ? `Obs.: ${order.notes}` : null,
      dashboardUrl,
    ]
      .filter(Boolean)
      .join(" · ") || "-";
  return [order.reference, location, items, formatMoney(order.totalCents, { symbol: currencySymbol }), extra].map((v) =>
    sanitiseTemplateParam(v),
  );
}

export class CloudApiSender {
  constructor(
    private readonly config: CloudApiConfig,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly timeoutMs = 10_000,
  ) {}

  async send(to: string, parameters: string[]): Promise<SendResult> {
    const url = `https://graph.facebook.com/${this.config.apiVersion}/${encodeURIComponent(this.config.phoneNumberId)}/messages`;
    const body = {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: this.config.templateName,
        language: { code: this.config.templateLanguage },
        components: [{ type: "body", parameters: parameters.map((text) => ({ type: "text", text })) }],
      },
    };
    try {
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.config.token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const payload = (await response.json().catch(() => null)) as
        | { messages?: { id?: string }[]; error?: { code?: number; message?: string } }
        | null;
      if (!response.ok) {
        const code = payload?.error?.code ?? response.status;
        const message = (payload?.error?.message ?? response.statusText).slice(0, 300);
        return { ok: false, externalId: null, error: `HTTP ${response.status} (código ${code}): ${message}` };
      }
      return { ok: true, externalId: payload?.messages?.[0]?.id ?? null, error: null };
    } catch (err) {
      const name = err instanceof Error ? err.name : "Error";
      const reason = name === "TimeoutError" || name === "AbortError" ? "tempo de resposta excedido" : "falha de rede";
      return { ok: false, externalId: null, error: `Erro ao contactar a API do WhatsApp: ${reason}` };
    }
  }
}
