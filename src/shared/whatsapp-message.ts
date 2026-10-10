import { HOTEL_TIME_ZONE } from "./constants";
import type { LocationType, OrderStatus } from "./constants";
import { formatMoney } from "./money";
import type { OrderDto } from "./types";

/**
 * Builds the plain-text order message sent to the hotel's WhatsApp.
 * Always in Portuguese, because it is read by hotel staff.
 */

export const STATUS_LABELS_PT: Record<OrderStatus, string> = {
  PENDING: "Pendente",
  CONFIRMED: "Confirmado",
  PREPARING: "Em preparação",
  READY: "Pronto",
  COMPLETED: "Concluído",
  CANCELLED: "Cancelado",
};

export const LOCATION_LABELS_PT: Record<LocationType, string> = {
  room: "Apartamento",
  table: "Mesa",
};

export interface MessageContext {
  hotelName: string;
  currencySymbol: string;
  timeZone?: string;
  /** Optional absolute link to the order in the staff dashboard. */
  dashboardUrl?: string | null;
}

export function formatOrderDateTime(iso: string, timeZone: string = HOTEL_TIME_ZONE): string {
  return new Intl.DateTimeFormat("pt-PT", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function buildOrderMessage(order: OrderDto, ctx: MessageContext): string {
  const money = (cents: number) => formatMoney(cents, { symbol: ctx.currencySymbol });
  const lines: string[] = [];

  lines.push(`*${ctx.hotelName} — Novo pedido*`);
  lines.push(`Ref.: *${order.reference}*`);
  lines.push(`Data: ${formatOrderDateTime(order.createdAt, ctx.timeZone)}`);
  lines.push(`${LOCATION_LABELS_PT[order.locationType]}: ${order.locationLabel}`);
  if (order.guestName) lines.push(`Hóspede: ${order.guestName}`);
  if (order.contactPhone) lines.push(`Contacto: ${order.contactPhone}`);
  lines.push(`Estado: ${STATUS_LABELS_PT[order.status]}`);
  lines.push("");

  for (const item of order.items) {
    lines.push(`• ${item.quantity} × ${item.productName} — ${money(item.lineTotalCents)}`);
    for (const option of item.options) {
      const extra = option.priceDeltaCents > 0 ? ` (+${money(option.priceDeltaCents)})` : "";
      lines.push(`   ◦ ${option.groupName}: ${option.name}${extra}`);
    }
    if (item.notes) lines.push(`   ✎ ${item.notes}`);
  }

  lines.push("");
  lines.push(`Subtotal: ${money(order.subtotalCents)}`);
  for (const charge of order.charges) lines.push(`${charge.label}: ${money(charge.amountCents)}`);
  lines.push(`*Total: ${money(order.totalCents)}*`);

  if (order.notes) {
    lines.push("");
    lines.push(`Observações: ${order.notes}`);
  }
  if (ctx.dashboardUrl) {
    lines.push("");
    lines.push(`Painel: ${ctx.dashboardUrl}`);
  }
  return lines.join("\n");
}

/** Builds a wa.me click-to-chat link. Without a number, WhatsApp lets the user pick a chat. */
export function buildWhatsAppLink(number: string | null, message: string): string {
  const base = number ? `https://wa.me/${number}` : "https://wa.me/";
  return `${base}?text=${encodeURIComponent(message)}`;
}
