import { addDays } from "../../shared/schedule";
import type { ReportDto, ReportKpis } from "../../shared/types";
import { describeLocation, STATUS_LABELS_PT } from "../../shared/whatsapp-message";
import { badRequest } from "../http/errors";
import type { Range, ReportRepo } from "../repositories/report-repo";
import { HOTEL_UTC_OFFSET } from "./order-service";

const MAX_DAYS = 366;

/** Inclusive hotel-local day range → UTC ISO bounds. */
export function dayRange(from: string, to: string): Range {
  return {
    fromIso: new Date(`${from}T00:00:00${HOTEL_UTC_OFFSET}`).toISOString(),
    toIso: new Date(`${to}T23:59:59.999${HOTEL_UTC_OFFSET}`).toISOString(),
  };
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/** Statistics for the admin "Relatórios" screen. */
export class ReportService {
  constructor(private readonly reports: ReportRepo) {}

  build(from: string, to: string): ReportDto {
    const days = daysBetween(from, to);
    if (days < 1) throw badRequest("INVALID_RANGE", "A data final deve ser igual ou posterior à inicial.");
    if (days > MAX_DAYS) throw badRequest("INVALID_RANGE", "Escolha um período de até um ano.");
    // The previous period has the same length and ends the day before `from`.
    const previousTo = addDays(from, -1);
    const previousFrom = addDays(previousTo, -(days - 1));
    const range = dayRange(from, to);

    const byDay = new Map(this.reports.daily(range).map((d) => [d.day, d]));
    const daily = Array.from({ length: days }, (_, i) => {
      const day = addDays(from, i);
      return byDay.get(day) ?? { day, orders: 0, revenueCents: 0 };
    });
    const byHour = new Map(this.reports.hourly(range).map((h) => [h.hour, h.orders]));
    const byWeekday = new Map(this.reports.weekday(range).map((w) => [w.weekday, w]));

    return {
      from,
      to,
      previousFrom,
      previousTo,
      kpis: this.kpis(range),
      previous: this.kpis(dayRange(previousFrom, previousTo)),
      daily,
      hourly: Array.from({ length: 24 }, (_, hour) => ({ hour, orders: byHour.get(hour) ?? 0 })),
      topItems: this.reports.topItems(range, 10),
      categories: this.reports.categories(range),
      topOptions: this.reports.topOptions(range, 10),
      byLocation: this.reports.byLocation(range),
      staff: this.reports.staffPerformance(range),
      unsoldItems: this.reports.unsoldItems(range),
      weekday: [1, 2, 3, 4, 5, 6, 0].map((weekday) => byWeekday.get(weekday) ?? { weekday, orders: 0, revenueCents: 0 }),
      customers: this.reports.customers(range, 10),
    };
  }

  /** Orders in the period as CSV for Excel (semicolon separated, comma decimals, UTF-8 BOM). */
  csv(from: string, to: string): string {
    if (daysBetween(from, to) < 1) throw badRequest("INVALID_RANGE", "A data final deve ser igual ou posterior à inicial.");
    const mt = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");
    const local = (iso: string | null) =>
      iso ? new Date(new Date(iso).getTime() + 2 * 3600_000).toISOString().slice(0, 16).replace("T", " ") : "";
    const cell = (v: string | number) => {
      const s = String(v);
      return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ["Referência", "Data", "Estado", "Entrega", "Encomenda para", "Cliente", "Telefone", "Artigos", "Qtd.", "Subtotal (MT)", "Encargos (MT)", "Total (MT)", "Sinal (MT)", "Estado do sinal"];
    const lines = this.reports.exportRows(dayRange(from, to)).map((r) =>
      [
        r.reference,
        local(r.created_at),
        STATUS_LABELS_PT[r.status as keyof typeof STATUS_LABELS_PT] ?? r.status,
        describeLocation(r.location_type, r.location_label),
        local(r.scheduled_for),
        r.guest_name ?? "",
        r.contact_phone ?? "",
        r.items ?? "",
        r.item_count,
        mt(r.subtotal_cents),
        mt(r.charges_cents),
        mt(r.total_cents),
        mt(r.deposit_cents),
        r.deposit_status === "confirmed" ? "Recebido" : r.deposit_status === "pending" ? "Por verificar" : "",
      ]
        .map(cell)
        .join(";"),
    );
    return "\uFEFF" + [header.join(";"), ...lines].join("\r\n") + "\r\n";
  }

  private kpis(range: Range): ReportKpis {
    const t = this.reports.totals(range);
    return {
      ...t,
      avgTicketCents: t.ordersCompleted > 0 ? Math.round(t.revenueCents / t.ordersCompleted) : 0,
      avgMinutesToConfirm: this.reports.averageMinutesTo(range, "CONFIRMED"),
      avgMinutesToComplete: this.reports.averageMinutesTo(range, "COMPLETED"),
    };
  }
}
