import { formatMoney } from "./money";
import type { ReportDto } from "./types";

/**
 * Plain-text summary of a report period, for WhatsApp/email to the manager
 * (Portuguese; *bold* is WhatsApp formatting and harmless in email).
 */

const LOCATION_PT = { table: "Mesa", room: "Apartamento", takeaway: "Levantar" } as const;

export const dayLabel = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;

export function periodLabel(report: Pick<ReportDto, "from" | "to">): string {
  return report.from === report.to ? dayLabel(report.from) : `${dayLabel(report.from)} a ${dayLabel(report.to)}`;
}

function change(current: number, previous: number): string {
  if (previous === 0) return "";
  const pct = Math.round(((current - previous) / previous) * 100);
  return pct === 0 ? " (= anterior)" : ` (${pct > 0 ? "▲" : "▼"} ${Math.abs(pct)}% vs período anterior)`;
}

export function buildDailySummary(report: ReportDto, ctx: { hotelName: string; currencySymbol: string }): string {
  const money = (c: number) => formatMoney(c, { symbol: ctx.currencySymbol });
  const k = report.kpis;
  const title = report.from === report.to ? "Resumo do dia" : "Resumo do período";
  const lines: string[] = [
    `*${ctx.hotelName} — ${title} ${periodLabel(report)}*`,
    "",
    `Vendas: *${money(k.revenueCents)}*${change(k.revenueCents, report.previous.revenueCents)}`,
    `Pedidos entregues: ${k.ordersCompleted} · recebidos: ${k.ordersReceived} · cancelados: ${k.ordersCancelled} · por entregar: ${k.ordersOpen}`,
    `Valor médio por pedido: ${money(k.avgTicketCents)} · artigos vendidos: ${k.itemsSold}`,
  ];
  if (k.scheduledOrders || k.depositsConfirmedCents) {
    lines.push(`Encomendas: ${k.scheduledOrders} · sinais recebidos: ${money(k.depositsConfirmedCents)}`);
  }
  if (k.avgMinutesToConfirm !== null) lines.push(`Tempo médio até confirmar: ${k.avgMinutesToConfirm} min`);
  if (k.avgRating !== null) lines.push(`Avaliação dos clientes: ${k.avgRating.toLocaleString("pt-PT")}/5 (${k.reviewCount})`);

  if (report.topItems.length) {
    lines.push("", "*Mais pedidos*");
    report.topItems.slice(0, 5).forEach((i, n) => lines.push(`${n + 1}. ${i.name} — ${i.quantity}× (${money(i.revenueCents)})`));
  }
  const mix = report.byLocation.filter((l) => l.orders > 0);
  if (mix.length) lines.push("", `Entrega: ${mix.map((l) => `${LOCATION_PT[l.type]} ${l.orders}`).join(" · ")}`);
  if (report.staff.length) {
    lines.push("", "*Equipa*");
    for (const s of report.staff) lines.push(`${s.name}: ${s.confirmed} confirmados · ${s.completed} concluídos${s.cancelled ? ` · ${s.cancelled} cancelados` : ""}`);
  }
  if (k.ordersReceived === 0) lines.push("", "Sem pedidos neste período.");
  else lines.push("", "Só os pedidos entregues contam nas vendas.");
  return lines.join("\n");
}
